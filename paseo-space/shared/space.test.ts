import { describe, expect, test } from "vitest";
import { formatKb, parseDu, parseGitWorktrees, sectionsByProject, totals, type Entry } from "./space";

describe("parseGitWorktrees", () => {
  test("reads branch, detached and prunable stanzas", () => {
    const out = parseGitWorktrees(
      [
        "worktree /repo",
        "HEAD abc",
        "branch refs/heads/main",
        "",
        "worktree /wt/detached",
        "HEAD def",
        "detached",
        "",
        "worktree /wt/gone",
        "HEAD 123",
        "branch refs/heads/old",
        "prunable gitdir file points to non-existent location",
        "",
      ].join("\n"),
    );
    expect(out).toEqual([
      { path: "/repo", branch: "main", prunable: false },
      { path: "/wt/detached", branch: null, prunable: false },
      { path: "/wt/gone", branch: "old", prunable: true },
    ]);
  });

  test("empty output yields nothing", () => {
    expect(parseGitWorktrees("")).toEqual([]);
  });
});

describe("parseDu", () => {
  const dir = "/wt/a";
  test("root total, caches by basename, nested caches folded into their parent", () => {
    const out = parseDu(
      [
        "10\t/wt/a/node_modules/x/node_modules",
        "100\t/wt/a/node_modules/x",
        "500\t/wt/a/node_modules",
        "40\t/wt/a/packages/api/node_modules",
        "60\t/wt/a/packages/api",
        "60\t/wt/a/packages",
        "7\t/wt/a/src",
        "600\t/wt/a",
      ].join("\n"),
      dir,
    );
    expect(out.totalKb).toBe(600);
    expect(out.caches).toEqual([
      { path: "/wt/a/node_modules", kb: 500 },
      { path: "/wt/a/packages/api/node_modules", kb: 40 },
    ]);
  });

  test("ignores lines for other directories, garbage lines and a missing root", () => {
    const out = parseDu(["12\t/wt/b/node_modules", "du: cannot read", "x\t/wt/a/node_modules"].join("\n"), dir);
    expect(out).toEqual({ totalKb: null, caches: [] });
  });

  test("a directory that merely starts with the root prefix is not inside it", () => {
    const out = parseDu(["9\t/wt/ab/node_modules", "9\t/wt/ab"].join("\n"), dir);
    expect(out.caches).toEqual([]);
  });
});

describe("formatKb", () => {
  test("picks a unit and precision by size", () => {
    expect(formatKb(0)).toBe("0 KB");
    expect(formatKb(1023)).toBe("1023 KB");
    expect(formatKb(1536)).toBe("1.5 MB");
    expect(formatKb(20 * 1024)).toBe("20 MB");
    expect(formatKb(1.5 * 1024 * 1024)).toBe("1.50 GB");
    expect(formatKb(12.34 * 1024 * 1024)).toBe("12.3 GB");
  });
});

function entry(partial: Partial<Entry> & Pick<Entry, "directory" | "projectId" | "kind">): Entry {
  return {
    projectName: partial.projectId,
    projectRootPath: `/p/${partial.projectId}`,
    workspaceId: null,
    name: partial.directory,
    branch: null,
    dirty: null,
    activityAt: null,
    totalKb: null,
    caches: [],
    sizedAt: null,
    error: null,
    ...partial,
  };
}

describe("sectionsByProject and totals", () => {
  test("groups biggest project first, unsized entries last, and counts orphans", () => {
    const entries = [
      entry({ directory: "/a/1", projectId: "a", kind: "workspace", totalKb: 100, caches: [{ path: "/a/1/node_modules", kb: 60 }] }),
      entry({ directory: "/a/2", projectId: "a", kind: "orphan", totalKb: null }),
      entry({ directory: "/a/3", projectId: "a", kind: "prunable" }),
      entry({ directory: "/b", projectId: "b", kind: "main", totalKb: 900 }),
    ];
    const sections = sectionsByProject(entries);
    expect(sections.map((section) => section.projectId)).toEqual(["b", "a"]);
    expect(sections[1]?.entries.map((e) => e.directory)).toEqual(["/a/1", "/a/2", "/a/3"]);
    expect(sections[1]?.cacheKb).toBe(60);
    expect(totals(entries)).toEqual({ totalKb: 1000, cacheKb: 60, worktrees: 2, orphans: 2 });
  });
});
