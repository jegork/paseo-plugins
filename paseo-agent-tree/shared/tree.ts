export const PARENT_AGENT_ID_LABEL = "paseo.parent-agent-id";
const OPEN_AGENT_TAB_LABEL_PREFIX = "paseo.open-agent-tab.";

export type AgentLabels = Readonly<Record<string, string>>;

export interface AgentFields {
  readonly id: string;
  readonly title: string | null;
  readonly provider: string;
  readonly model: string | null;
  readonly status: string;
  readonly cwd: string;
  readonly workspaceId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly labels?: AgentLabels;
  readonly requiresAttention?: boolean;
  readonly attentionReason?: string | null;
  readonly attentionTimestamp?: string | null;
  readonly pendingPermissions?: readonly unknown[];
  readonly lastError?: string;
  readonly archivedAt?: string | null;
}

export interface ProjectFields {
  readonly projectKey: string;
  readonly projectName: string;
  readonly workspaceName?: string | null;
  readonly checkout?: { readonly isGit?: boolean; readonly currentBranch?: string | null } | null;
}

export interface AgentEntry {
  readonly agent: AgentFields;
  readonly project: ProjectFields;
}

/** What the daemon knows about a workspace, which agent rows alone do not carry. */
export interface WorkspaceInfo {
  readonly id: string;
  readonly name: string;
  readonly projectName: string;
  readonly additions: number;
  readonly deletions: number;
  readonly pinned: boolean;
}

export type Bucket = "attention" | "running" | "idle" | "closed";

export const BUCKETS: readonly Bucket[] = ["attention", "running", "idle", "closed"];

const BUCKET_RANK: Record<Bucket, number> = { attention: 0, running: 1, idle: 2, closed: 3 };

export interface TreeNode {
  readonly id: string;
  readonly agent: AgentFields;
  readonly project: ProjectFields;
  readonly openTab: boolean;
  /** the row itself passes the query and bucket, rather than only carrying a match below it */
  readonly matched: boolean;
  readonly descendants: number;
  readonly children: TreeNode[];
}

export interface WorkspaceGroup {
  readonly key: string;
  readonly workspaceId: string | null;
  readonly name: string;
  readonly branch: string | null;
  readonly additions: number;
  readonly deletions: number;
  readonly pinned: boolean;
  readonly nodes: TreeNode[];
  readonly count: number;
}

export interface ProjectGroup {
  readonly key: string;
  readonly name: string;
  readonly workspaces: WorkspaceGroup[];
  readonly count: number;
}

export function parentAgentId(labels: AgentLabels | undefined): string | null {
  const value = labels?.[PARENT_AGENT_ID_LABEL];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** Paseo marks an agent with one label per client that currently has its tab open. */
export function hasOpenTab(labels: AgentLabels | undefined): boolean {
  return Object.entries(labels ?? {}).some(
    ([label, value]) => label.startsWith(OPEN_AGENT_TAB_LABEL_PREFIX) && value === "true",
  );
}

export function isLive(entry: AgentEntry): boolean {
  return (entry.agent.archivedAt ?? null) === null;
}

export function isRunning(status: string): boolean {
  return status === "running" || status === "initializing";
}

export function bucketOf(agent: AgentFields): Bucket {
  if (agent.status === "closed") return "closed";
  if (
    agent.requiresAttention === true ||
    agent.status === "error" ||
    (agent.pendingPermissions?.length ?? 0) > 0
  ) {
    return "attention";
  }
  return isRunning(agent.status) ? "running" : "idle";
}

export function needsAttention(agent: AgentFields): boolean {
  return bucketOf(agent) === "attention";
}

/** The short word on the right rail: what the agent is waiting on, else its status. */
export function stateLabel(agent: AgentFields): string {
  const permissions = agent.pendingPermissions?.length ?? 0;
  if (permissions > 0) return permissions === 1 ? "permission" : `${permissions} permissions`;
  if (agent.status === "error") return "error";
  if (agent.requiresAttention === true) return agent.attentionReason ?? "attention";
  return agent.status === "initializing" ? "starting" : agent.status;
}

/** Attention started the wait; updatedAt is the fallback heartbeat. */
export function waitingSince(agent: AgentFields): number {
  return Date.parse(agent.attentionTimestamp ?? agent.updatedAt);
}

export function directoryName(cwd: string): string {
  const segments = cwd.split("/").filter((segment) => segment !== "");
  return segments[segments.length - 1] ?? cwd;
}

export function agentTitle(agent: AgentFields): string {
  const title = (agent.title ?? "").trim();
  return title !== "" ? title : `Untitled ${agent.id.slice(0, 7)}`;
}

/** Drops the vendor prefix so a row reads "claude-opus-5" rather than the full provider path. */
export function modelLabel(agent: AgentFields): string {
  const model = (agent.model ?? "").trim();
  if (model !== "") return model.split("/").at(-1) ?? model;
  const provider = typeof agent.provider === "string" ? agent.provider : "";
  return provider.split("/").at(-1) ?? provider;
}

export function formatAge(since: number, now: number): string {
  if (Number.isNaN(since)) return "";
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function relativeTime(iso: string, now: number): string {
  return formatAge(Date.parse(iso), now);
}

export function matchesQuery(entry: AgentEntry, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  const haystack = [
    entry.agent.title ?? "",
    entry.agent.cwd,
    typeof entry.agent.provider === "string" ? entry.agent.provider : "",
    entry.agent.model ?? "",
    entry.project.projectName,
    entry.project.workspaceName ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return needle.split(/\s+/).every((term) => haystack.includes(term));
}

export function countByBucket(entries: readonly AgentEntry[]): Record<Bucket | "all", number> {
  const counts: Record<Bucket | "all", number> = {
    all: 0,
    attention: 0,
    running: 0,
    idle: 0,
    closed: 0,
  };
  for (const entry of entries) {
    if (!isLive(entry)) continue;
    counts.all += 1;
    counts[bucketOf(entry.agent)] += 1;
  }
  return counts;
}

export const SWEEP_AGE_DAYS = ["1", "3", "7", "30"] as const;

export type SweepAge = (typeof SWEEP_AGE_DAYS)[number];

const DAY_MS = 86_400_000;

/**
 * Closed agents old enough to archive in bulk. A closed agent is only one the daemon
 * has no live session for, so age is what separates abandoned work from a thread that
 * went dormant an hour ago. An unreadable timestamp is left out rather than swept.
 */
export function sweepableAgentIds(
  entries: readonly AgentEntry[],
  options: { readonly now: number; readonly minAgeDays: number },
): string[] {
  const cutoff = options.now - options.minAgeDays * DAY_MS;
  const swept: string[] = [];
  for (const entry of entries) {
    if (!isLive(entry) || bucketOf(entry.agent) !== "closed") continue;
    const updated = Date.parse(entry.agent.updatedAt);
    if (Number.isNaN(updated) || updated >= cutoff) continue;
    swept.push(entry.agent.id);
  }
  return swept;
}

function workspaceKey(entry: AgentEntry): string {
  return entry.agent.workspaceId ?? entry.agent.cwd;
}

function activityOf(agent: AgentFields): number {
  const updated = Date.parse(agent.updatedAt);
  return Number.isNaN(updated) ? 0 : updated;
}

function compareNodes(left: TreeNode, right: TreeNode): number {
  const rank = BUCKET_RANK[bucketOf(left.agent)] - BUCKET_RANK[bucketOf(right.agent)];
  if (rank !== 0) return rank;
  return activityOf(right.agent) - activityOf(left.agent);
}

/** A parent that is missing, archived, or part of a label cycle makes its child a root. */
function resolveParent(entry: AgentEntry, byId: ReadonlyMap<string, AgentEntry>): string | null {
  const parentId = parentAgentId(entry.agent.labels);
  if (parentId === null || parentId === entry.agent.id || !byId.has(parentId)) return null;
  const seen = new Set<string>([entry.agent.id]);
  let current: string | null = parentId;
  while (current !== null) {
    if (seen.has(current)) return null;
    seen.add(current);
    const ancestor = byId.get(current);
    if (ancestor === undefined) break;
    current = parentAgentId(ancestor.agent.labels);
  }
  return parentId;
}

export interface BuildTreeOptions {
  readonly query?: string;
  readonly bucket?: Bucket | null;
  /** with no bucket selected, closed agents stay out of the way unless asked for */
  readonly hideClosed?: boolean;
  readonly workspaces?: ReadonlyMap<string, WorkspaceInfo>;
  readonly projects?: ReadonlyMap<string, string>;
}

/**
 * Groups agents by project and workspace, nesting handoff children under the
 * parent that spawned them even when the child lives in another workspace.
 * Filtering keeps an ancestor whose descendant matches, so the path stays visible.
 */
export function buildTree(
  entries: readonly AgentEntry[],
  options: BuildTreeOptions = {},
): ProjectGroup[] {
  const bucket = options.bucket ?? null;
  const hideClosed = options.hideClosed ?? false;
  const query = options.query ?? "";
  const workspaces = options.workspaces;
  const projects = options.projects;
  const live = entries.filter(isLive);
  const byId = new Map(live.map((entry) => [entry.agent.id, entry] as const));
  const childrenOf = new Map<string, AgentEntry[]>();
  const roots: AgentEntry[] = [];

  for (const entry of live) {
    const parent = resolveParent(entry, byId);
    if (parent === null) {
      roots.push(entry);
      continue;
    }
    const siblings = childrenOf.get(parent);
    if (siblings === undefined) childrenOf.set(parent, [entry]);
    else siblings.push(entry);
  }

  function keeps(agent: AgentFields): boolean {
    if (bucket !== null) return bucketOf(agent) === bucket;
    return !hideClosed || bucketOf(agent) !== "closed";
  }

  function toNode(entry: AgentEntry): TreeNode | null {
    const children = (childrenOf.get(entry.agent.id) ?? [])
      .map(toNode)
      .filter((node): node is TreeNode => node !== null)
      .sort(compareNodes);
    const matched = keeps(entry.agent) && matchesQuery(entry, query);
    if (!matched && children.length === 0) return null;
    return {
      id: entry.agent.id,
      agent: entry.agent,
      project: entry.project,
      openTab: hasOpenTab(entry.agent.labels),
      matched,
      descendants: children.reduce((total, node) => total + 1 + node.descendants, 0),
      children,
    };
  }

  function workspaceName(entry: AgentEntry): string {
    const known = entry.agent.workspaceId === undefined ? undefined : workspaces?.get(entry.agent.workspaceId);
    const name = (known?.name ?? entry.project.workspaceName ?? "").trim();
    return name !== "" ? name : directoryName(entry.agent.cwd);
  }

  function projectName(entry: AgentEntry): string {
    const custom = projects?.get(entry.project.projectKey);
    if (custom !== undefined && custom.trim() !== "") return custom;
    const known = entry.agent.workspaceId === undefined ? undefined : workspaces?.get(entry.agent.workspaceId);
    return known?.projectName ?? entry.project.projectName;
  }

  const grouped = new Map<string, { name: string; workspaces: Map<string, WorkspaceGroup> }>();
  for (const entry of roots) {
    const node = toNode(entry);
    if (node === null) continue;
    let project = grouped.get(entry.project.projectKey);
    if (project === undefined) {
      project = { name: projectName(entry), workspaces: new Map() };
      grouped.set(entry.project.projectKey, project);
    }
    const key = workspaceKey(entry);
    const existing = project.workspaces.get(key);
    if (existing !== undefined) {
      existing.nodes.push(node);
      continue;
    }
    const info = entry.agent.workspaceId === undefined ? undefined : workspaces?.get(entry.agent.workspaceId);
    const branch = entry.project.checkout?.isGit === true ? (entry.project.checkout.currentBranch ?? null) : null;
    project.workspaces.set(key, {
      key,
      workspaceId: entry.agent.workspaceId ?? null,
      name: workspaceName(entry),
      branch,
      additions: info?.additions ?? 0,
      deletions: info?.deletions ?? 0,
      pinned: info?.pinned ?? false,
      nodes: [node],
      count: 0,
    });
  }

  function rank(nodes: readonly TreeNode[]): number {
    return nodes.reduce(
      (best, node) => Math.min(best, BUCKET_RANK[bucketOf(node.agent)], rank(node.children)),
      BUCKET_RANK.closed,
    );
  }

  return [...grouped.entries()]
    .map(([key, project]) => {
      const workspaceGroups = [...project.workspaces.values()]
        .map((workspace) => ({
          ...workspace,
          nodes: [...workspace.nodes].sort(compareNodes),
          count: workspace.nodes.reduce((total, node) => total + 1 + node.descendants, 0),
        }))
        .sort((left, right) => {
          const pinned = Number(right.pinned) - Number(left.pinned);
          if (pinned !== 0) return pinned;
          const buckets = rank(left.nodes) - rank(right.nodes);
          if (buckets !== 0) return buckets;
          return activityOf(right.nodes[0]!.agent) - activityOf(left.nodes[0]!.agent);
        });
      return {
        key,
        name: project.name,
        workspaces: workspaceGroups,
        count: workspaceGroups.reduce((total, workspace) => total + workspace.count, 0),
      };
    })
    .sort((left, right) => {
      const pinned =
        Number(right.workspaces.some((workspace) => workspace.pinned)) -
        Number(left.workspaces.some((workspace) => workspace.pinned));
      if (pinned !== 0) return pinned;
      const buckets = rank(left.workspaces[0]!.nodes) - rank(right.workspaces[0]!.nodes);
      if (buckets !== 0) return buckets;
      return (
        activityOf(right.workspaces[0]!.nodes[0]!.agent) -
        activityOf(left.workspaces[0]!.nodes[0]!.agent)
      );
    });
}
