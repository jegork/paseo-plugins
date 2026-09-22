import { describe, expect, test } from "vitest";
import {
  agentTitle,
  bucketOf,
  buildTree,
  sweepableAgentIds,
  countByBucket,
  directoryName,
  hasOpenTab,
  matchesQuery,
  modelLabel,
  parentAgentId,
  relativeTime,
  stateLabel,
  waitingSince,
  type AgentEntry,
  type AgentFields,
  type WorkspaceInfo,
} from "./tree";

const NOW = Date.parse("2026-09-22T12:00:00Z");

function entry(overrides: Partial<AgentFields> & { id: string }, project?: Partial<AgentEntry["project"]>): AgentEntry {
  return {
    agent: {
      title: overrides.id,
      provider: "claude/claude-opus-5",
      model: "claude-opus-5",
      status: "idle",
      cwd: "/Users/me/projects/app",
      workspaceId: "wks_main",
      createdAt: "2026-09-22T10:00:00Z",
      updatedAt: "2026-09-22T11:00:00Z",
      labels: {},
      ...overrides,
    },
    project: { projectKey: "app", projectName: "app", workspaceName: "main", ...project },
  };
}

function child(id: string, parent: string, overrides: Partial<AgentFields> = {}, project?: Partial<AgentEntry["project"]>): AgentEntry {
  return entry({ id, labels: { "paseo.parent-agent-id": parent }, ...overrides }, project);
}

describe("labels", () => {
  test("a blank or whitespace parent label is no parent", () => {
    expect(parentAgentId({ "paseo.parent-agent-id": "  parent \n" })).toBe("parent");
    expect(parentAgentId({ "paseo.parent-agent-id": "   " })).toBeNull();
    expect(parentAgentId(undefined)).toBeNull();
  });

  test("an open tab needs the label value to be true, not merely present", () => {
    expect(hasOpenTab({ "paseo.open-agent-tab.desktop": "true" })).toBe(true);
    expect(hasOpenTab({ "paseo.open-agent-tab.desktop": "false" })).toBe(false);
    expect(hasOpenTab({ "paseo.parent-agent-id": "true" })).toBe(false);
    expect(hasOpenTab({})).toBe(false);
  });
});

describe("row labels", () => {
  test("falls back when the title, model, or path is empty", () => {
    expect(agentTitle({ title: "   ", id: "abcdefgh-1" } as AgentFields)).toBe("Untitled abcdefg");
    expect(modelLabel({ model: null, provider: "omp/openai-codex/gpt-6" } as AgentFields)).toBe("gpt-6");
    expect(modelLabel({ model: "anthropic/claude-opus-5" } as AgentFields)).toBe("claude-opus-5");
    expect(directoryName("/Users/me/projects/app/")).toBe("app");
  });

  test("relative time rounds down and never reads negative", () => {
    expect(relativeTime("2026-09-22T11:59:30Z", NOW)).toBe("now");
    expect(relativeTime("2026-09-22T11:00:00Z", NOW)).toBe("1h");
    expect(relativeTime("2026-09-22T11:01:00Z", NOW)).toBe("59m");
    expect(relativeTime("2026-09-22T09:00:00Z", NOW)).toBe("3h");
    expect(relativeTime("2026-09-19T12:00:00Z", NOW)).toBe("3d");
    expect(relativeTime("2026-09-22T12:05:00Z", NOW)).toBe("now");
    expect(relativeTime("not a date", NOW)).toBe("");
  });
});

describe("buildTree", () => {
  test("nests a child under its parent even when the child sits in another workspace", () => {
    const tree = buildTree([
      entry({ id: "parent" }),
      child("worker", "parent", { workspaceId: "wks_worktree", cwd: "/Users/me/.paseo/worktrees/ab/fish" }, { workspaceName: "fish" }),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.workspaces).toHaveLength(1);
    const root = tree[0]!.workspaces[0]!.nodes[0]!;
    expect(root.id).toBe("parent");
    expect(root.children.map((node) => node.id)).toEqual(["worker"]);
    expect(tree[0]!.count).toBe(2);
  });

  test("an agent whose parent is absent or archived becomes a root", () => {
    const tree = buildTree([
      child("orphan", "gone"),
      entry({ id: "dead", archivedAt: "2026-09-22T11:30:00Z" }),
      child("bereaved", "dead"),
    ]);
    const ids = tree[0]!.workspaces[0]!.nodes.map((node) => node.id);
    expect(ids).toContain("orphan");
    expect(ids).toContain("bereaved");
    expect(ids).not.toContain("dead");
  });

  test("a parent cycle does not swallow the agents", () => {
    const tree = buildTree([child("a", "b"), child("b", "a"), entry({ id: "self", labels: { "paseo.parent-agent-id": "self" } })]);
    const ids = tree[0]!.workspaces[0]!.nodes.map((node) => node.id).sort();
    expect(ids).toEqual(["a", "b", "self"]);
  });

  test("keeps an unmatched ancestor when a descendant matches, flagged as context", () => {
    const tree = buildTree(
      [entry({ id: "parent", title: "boring parent" }), child("worker", "parent", { title: "fix the memory erasure" })],
      { query: "erasure" },
    );
    const root = tree[0]!.workspaces[0]!.nodes[0]!;
    expect(root.id).toBe("parent");
    expect(root.matched).toBe(false);
    expect(root.children[0]!.matched).toBe(true);
  });

  test("drops a branch where nothing matches", () => {
    expect(buildTree([entry({ id: "a", title: "alpha" }), child("b", "a", { title: "beta" })], { query: "zeta" })).toEqual([]);
  });

  test("the attention bucket keeps an erroring agent and its parent chain", () => {
    const tree = buildTree(
      [entry({ id: "parent" }), child("worker", "parent", { status: "error" }), entry({ id: "calm" })],
      { bucket: "attention" },
    );
    const ids = tree[0]!.workspaces[0]!.nodes.map((node) => node.id);
    expect(ids).toEqual(["parent"]);
    expect(tree[0]!.workspaces[0]!.nodes[0]!.children[0]!.id).toBe("worker");
  });

  test("orders agents needing attention first, then by most recent activity", () => {
    const tree = buildTree([
      entry({ id: "old", updatedAt: "2026-09-22T09:00:00Z" }),
      entry({ id: "recent", updatedAt: "2026-09-22T11:59:00Z" }),
      entry({ id: "stuck", updatedAt: "2026-09-20T09:00:00Z", requiresAttention: true }),
    ]);
    expect(tree[0]!.workspaces[0]!.nodes.map((node) => node.id)).toEqual(["stuck", "recent", "old"]);
  });

  test("splits workspaces inside a project and groups by workspace id, not name", () => {
    const tree = buildTree([
      entry({ id: "a" }),
      entry({ id: "b", workspaceId: "wks_two", cwd: "/Users/me/.paseo/worktrees/x/main" }, { workspaceName: "main" }),
    ]);
    expect(tree[0]!.workspaces.map((workspace) => workspace.workspaceId).sort()).toEqual(["wks_main", "wks_two"]);
  });

  test("a query matches across title, project, and path, requiring every term", () => {
    const row = entry({ id: "a", title: "review queue" }, { projectName: "cynthai" });
    expect(matchesQuery(row, "queue cynthai")).toBe(true);
    expect(matchesQuery(row, "queue missing")).toBe(false);
    expect(matchesQuery(row, "   ")).toBe(true);
  });
});

describe("buckets", () => {
  test("closed wins over everything, and a pending permission counts as attention", () => {
    expect(bucketOf({ status: "closed", requiresAttention: true } as AgentFields)).toBe("closed");
    expect(bucketOf({ status: "idle", pendingPermissions: [{}] } as unknown as AgentFields)).toBe("attention");
    expect(bucketOf({ status: "error" } as AgentFields)).toBe("attention");
    expect(bucketOf({ status: "initializing" } as AgentFields)).toBe("running");
    expect(bucketOf({ status: "idle" } as AgentFields)).toBe("idle");
  });

  test("the state label names what the agent waits on before its status", () => {
    expect(stateLabel({ status: "idle", pendingPermissions: [{}, {}] } as unknown as AgentFields)).toBe("2 permissions");
    expect(stateLabel({ status: "idle", pendingPermissions: [{}] } as unknown as AgentFields)).toBe("permission");
    expect(stateLabel({ status: "error" } as AgentFields)).toBe("error");
    expect(stateLabel({ status: "idle", requiresAttention: true, attentionReason: "finished" } as AgentFields)).toBe("finished");
    expect(stateLabel({ status: "initializing" } as AgentFields)).toBe("starting");
  });

  test("the wait starts when attention began, not at the last heartbeat", () => {
    const agent = { updatedAt: "2026-09-22T11:59:00Z", attentionTimestamp: "2026-09-22T09:00:00Z" } as AgentFields;
    expect(waitingSince(agent)).toBe(Date.parse("2026-09-22T09:00:00Z"));
    expect(waitingSince({ updatedAt: "2026-09-22T09:00:00Z" } as AgentFields)).toBe(Date.parse("2026-09-22T09:00:00Z"));
  });

  test("counts ignore archived agents", () => {
    const rows = [
      entry({ id: "a", status: "closed" }),
      entry({ id: "b", status: "running" }),
      entry({ id: "c", status: "closed", archivedAt: "2026-09-22T10:00:00Z" }),
      entry({ id: "d", requiresAttention: true }),
    ];
    expect(countByBucket(rows)).toEqual({ all: 3, attention: 1, running: 1, idle: 0, closed: 1 });
  });
});

describe("the bulk sweep", () => {
  const rows = [
    entry({ id: "stale", status: "closed", updatedAt: "2026-09-01T12:00:00Z" }),
    entry({ id: "dormant-2d", status: "closed", updatedAt: "2026-09-20T09:00:00Z" }),
    entry({ id: "quiet-3h", status: "closed", updatedAt: "2026-09-22T09:00:00Z" }),
    entry({ id: "archived", status: "closed", updatedAt: "2026-01-01T12:00:00Z", archivedAt: "2026-02-01T12:00:00Z" }),
    entry({ id: "idle", updatedAt: "2026-01-01T12:00:00Z" }),
    entry({ id: "undated", status: "closed", updatedAt: "not a date" }),
  ];

  test("offers only closed agents older than the age, never today's dormant thread", () => {
    expect(sweepableAgentIds(rows, { now: NOW, minAgeDays: 7 })).toEqual(["stale"]);
  });

  test("a shorter age reaches older threads but never one that went quiet hours ago", () => {
    const swept = sweepableAgentIds(rows, { now: NOW, minAgeDays: 1 }).sort();
    expect(swept).toEqual(["dormant-2d", "stale"]);
    expect(swept).not.toContain("quiet-3h");
  });

  test("skips archived agents, live agents, and unreadable timestamps", () => {
    const swept = sweepableAgentIds(rows, { now: NOW, minAgeDays: 0 });
    expect(swept).not.toContain("archived");
    expect(swept).not.toContain("idle");
    expect(swept).not.toContain("undated");
    expect(swept).toContain("quiet-3h");
  });
});

describe("closed agents", () => {
  test("hideClosed removes them from All but the Closed bucket still shows them", () => {
    const rows = [entry({ id: "open" }), entry({ id: "done", status: "closed" })];
    expect(buildTree(rows, { hideClosed: true })[0]!.workspaces[0]!.nodes.map((n) => n.id)).toEqual(["open"]);
    expect(buildTree(rows, { hideClosed: false })[0]!.count).toBe(2);
    expect(buildTree(rows, { bucket: "closed", hideClosed: true })[0]!.workspaces[0]!.nodes.map((n) => n.id)).toEqual(["done"]);
  });

  test("a closed parent stays as context when a live child survives the filter", () => {
    const tree = buildTree([entry({ id: "parent", status: "closed" }), child("worker", "parent", { status: "running" })], {
      hideClosed: true,
    });
    const root = tree[0]!.workspaces[0]!.nodes[0]!;
    expect(root.id).toBe("parent");
    expect(root.matched).toBe(false);
    expect(root.descendants).toBe(1);
  });
});

describe("workspace directory", () => {
  const workspaces = new Map<string, WorkspaceInfo>([
    ["wks_main", { id: "wks_main", name: "Add review queue filtering", projectName: "cynthai-backend", additions: 1599, deletions: 18, pinned: true }],
  ]);

  test("takes the name, project, diff stats, and pin from the workspace row", () => {
    const tree = buildTree([entry({ id: "a" }, { projectName: "fallback", workspaceName: "main" })], { workspaces });
    const group = tree[0]!.workspaces[0]!;
    expect(group.name).toBe("Add review queue filtering");
    expect(tree[0]!.name).toBe("cynthai-backend");
    expect([group.additions, group.deletions, group.pinned]).toEqual([1599, 18, true]);
  });

  test("a custom project name overrides both the workspace row and the agent row", () => {
    const tree = buildTree([entry({ id: "a" })], { workspaces, projects: new Map([["app", "Renamed"]]) });
    expect(tree[0]!.name).toBe("Renamed");
  });

  test("keeps the git branch only for a git checkout", () => {
    const withBranch = buildTree([entry({ id: "a" }, { checkout: { isGit: true, currentBranch: "feat/x" } })]);
    const withoutGit = buildTree([entry({ id: "b" }, { checkout: { isGit: false, currentBranch: "feat/x" } })]);
    expect(withBranch[0]!.workspaces[0]!.branch).toBe("feat/x");
    expect(withoutGit[0]!.workspaces[0]!.branch).toBeNull();
  });

  test("a pinned workspace floats above a busier one", () => {
    const rows = [
      entry({ id: "busy", requiresAttention: true, workspaceId: "wks_other", cwd: "/x/other" }, { workspaceName: "other" }),
      entry({ id: "calm" }),
    ];
    expect(buildTree(rows, { workspaces })[0]!.workspaces[0]!.workspaceId).toBe("wks_main");
  });
});
