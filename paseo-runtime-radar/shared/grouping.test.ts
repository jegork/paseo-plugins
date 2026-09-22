import { describe, expect, test } from "vitest";
import { groupSnapshot, scopeLabel } from "./grouping";
import type { RuntimeSnapshot } from "./runtime";

const snapshot: RuntimeSnapshot = {
  workspaces: [
    { id: "w1", name: "feature", directory: "/p/app/.wt/feature" },
    { id: "w2", name: "idle", directory: "/p/other" },
  ],
  projects: [
    { id: "p1", name: "app", rootPath: "/p/app" },
    { id: "p2", name: "other", rootPath: "/p/other" },
    { id: "p3", name: "quiet", rootPath: "/p/quiet" },
  ],
  listeners: [
    { port: 3000, address: "*", pid: 1, command: "node", cwd: "/p/app/.wt/feature", workspaceId: "w1", projectId: "p1" },
    { port: 5173, address: "*", pid: 2, command: "vite", cwd: "/p/app", workspaceId: null, projectId: "p1" },
    { port: 9999, address: "*", pid: 3, command: "stray", cwd: "/tmp", workspaceId: null, projectId: null },
  ],
  containers: [
    { id: "c1", name: "db", image: "pg", status: "Up", ports: [], project: "app", workingDir: "/p/app", workspaceId: null, projectId: "p1" },
  ],
  errors: [],
  takenAt: "2026-09-13T00:00:00Z",
};

describe("groupSnapshot", () => {
  test("workspace view lists open workspaces, then projects without one, then the rest", () => {
    const sections = groupSnapshot(snapshot, "workspace");
    expect(sections.map((s) => s.key)).toEqual(["ws:w1", "proj:p1", "unassigned"]);
    expect(sections[1]?.listeners.map((l) => l.port)).toEqual([5173]);
    expect(sections[1]?.containers.map((c) => c.name)).toEqual(["db"]);
    expect(sections[0]?.workspaceId).toBe("w1");
  });

  test("project view folds a project's worktree into its project", () => {
    const sections = groupSnapshot(snapshot, "project");
    expect(sections.map((s) => s.key)).toEqual(["proj:p1", "unassigned"]);
    expect(sections[0]?.listeners.map((l) => l.port)).toEqual([3000, 5173]);
  });

  test("kind view is two flat lists and drops an empty one", () => {
    const sections = groupSnapshot(snapshot, "kind");
    expect(sections.map((s) => [s.key, s.listeners.length, s.containers.length])).toEqual([
      ["ports", 3, 0],
      ["containers", 0, 1],
    ]);
    expect(groupSnapshot({ ...snapshot, containers: [] }, "kind").map((s) => s.key)).toEqual(["ports"]);
  });

  test("empty sections never render, including idle workspaces and quiet projects", () => {
    const keys = groupSnapshot(snapshot, "workspace").map((s) => s.key);
    expect(keys).not.toContain("ws:w2");
    expect(keys).not.toContain("proj:p3");
  });
});

describe("scopeLabel", () => {
  test("prefers the workspace, then the project, then nothing", () => {
    expect(scopeLabel(snapshot.listeners[0]!, snapshot)).toBe("feature");
    expect(scopeLabel(snapshot.listeners[1]!, snapshot)).toBe("app");
    expect(scopeLabel(snapshot.listeners[2]!, snapshot)).toBeNull();
  });
});
