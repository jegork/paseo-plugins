import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { cleanCaches, pruneWorktrees, removeWorktree, snapshotSpace } from "./space.server";

let base: string;
let root: string;
let tracked: string;
let orphan: string;
let gone: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
}

async function fill(dir: string, kb = 64) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "blob"), Buffer.alloc(kb * 1024, 1));
}

type WorkspaceEntry = {
  id: string;
  projectId: string;
  projectDisplayName: string;
  projectCustomName?: string | null;
  projectRootPath: string;
  workspaceDirectory?: string;
  name: string;
  title?: string | null;
  archivingAt: string | null;
  activityAt: string | null;
};

function context(entries: WorkspaceEntry[]): PluginHandlerContext {
  return {
    paseo: {
      workspaces: { list: async () => ({ entries }) },
      projects: { list: async () => ({ projects: [] }) },
    },
  } as unknown as PluginHandlerContext;
}

function workspace(id: string, directory: string, extra: Partial<WorkspaceEntry> = {}): WorkspaceEntry {
  return { id, projectId: "proj", projectDisplayName: "demo", projectRootPath: root, workspaceDirectory: directory, name: id, archivingAt: null, activityAt: null, ...extra };
}

beforeAll(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "paseo-space-")));
  root = path.join(base, "repo");
  tracked = path.join(base, "tracked");
  orphan = path.join(base, "orphan");
  gone = path.join(base, "gone");
  await fs.mkdir(root);
  git(root, "init", "-q", "-b", "main");
  await fs.writeFile(path.join(root, ".gitignore"), "node_modules\n.venv\n");
  await fs.writeFile(path.join(root, "README.md"), "hi\n");
  await fs.mkdir(path.join(root, "target"));
  await fs.writeFile(path.join(root, "target", "keep.txt"), "committed build output\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "init");
  git(root, "worktree", "add", "-q", "-b", "feat/tracked", tracked);
  git(root, "worktree", "add", "-q", "-b", "feat/orphan", orphan);
  git(root, "worktree", "add", "-q", "-b", "feat/gone", gone);
  await fs.rm(gone, { recursive: true });
  await fill(path.join(tracked, "node_modules", "pkg"), 256);
  await fill(path.join(tracked, "packages", "api", "node_modules"), 32);
  await fill(path.join(tracked, "target"), 16);
  await fill(path.join(orphan, "node_modules"), 8);
  await fs.writeFile(path.join(orphan, "README.md"), "changed\n");
});

afterAll(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

describe("snapshotSpace", () => {
  test("classifies main, workspace, orphan and prunable checkouts and only offers gitignored caches", async () => {
    const snapshot = await snapshotSpace({ refresh: true }, context([workspace("ws-main", root), workspace("ws-tracked", tracked, { title: "Tracked work" })]));
    expect(snapshot.errors).toEqual([]);
    const byDir = new Map(snapshot.entries.map((entry) => [entry.directory, entry]));
    expect([...byDir.keys()].sort()).toEqual([gone, orphan, root, tracked].sort());

    const main = byDir.get(root);
    expect(main).toMatchObject({ kind: "main", workspaceId: "ws-main", branch: "main", dirty: false, name: "main checkout" });
    expect(main?.caches).toEqual([]);
    expect(main?.totalKb).toBeGreaterThan(0);

    const ws = byDir.get(tracked);
    expect(ws).toMatchObject({ kind: "workspace", workspaceId: "ws-tracked", branch: "feat/tracked", name: "Tracked work", dirty: false });
    expect(ws?.caches.map((cache) => path.relative(tracked, cache.path))).toEqual(["node_modules", path.join("packages", "api", "node_modules")]);
    expect(ws?.caches[0]?.kb).toBeGreaterThanOrEqual(256);

    expect(byDir.get(orphan)).toMatchObject({ kind: "orphan", workspaceId: null, branch: "feat/orphan", dirty: true, name: "orphan" });
    expect(byDir.get(gone)).toMatchObject({ kind: "prunable", totalKb: null, caches: [], dirty: null });
    expect(snapshot.disk?.freeKb).toBeGreaterThan(0);
  });

  test("an archived workspace no longer claims its worktree", async () => {
    const snapshot = await snapshotSpace({ refresh: false }, context([workspace("ws-orphan", orphan, { archivingAt: "2026-09-14T00:00:00Z" })]));
    expect(snapshot.entries.find((entry) => entry.directory === orphan)).toMatchObject({ kind: "orphan", workspaceId: null });
  });

  test("a workspace whose directory git does not know is still listed", async () => {
    const loose = path.join(base, "loose");
    await fill(loose, 4);
    const snapshot = await snapshotSpace({ refresh: true }, context([workspace("ws-loose", loose)]));
    expect(snapshot.entries.find((entry) => entry.directory === loose)).toMatchObject({ kind: "workspace", workspaceId: "ws-loose", branch: null });
  });
});

describe("cleanCaches", () => {
  test("refuses paths outside the worktree, non-cache names, symlinks and unknown worktrees", async () => {
    const ctx = context([workspace("ws-tracked", tracked)]);
    expect(await cleanCaches({ directory: tracked, paths: [path.join(orphan, "node_modules")] }, ctx)).toMatchObject({ ok: false });
    expect(await cleanCaches({ directory: tracked, paths: [path.join(tracked, "packages")] }, ctx)).toMatchObject({ ok: false });
    expect(await cleanCaches({ directory: tracked, paths: [path.join(tracked, "..", "orphan", "node_modules")] }, ctx)).toMatchObject({ ok: false });
    await fs.symlink(root, path.join(tracked, ".venv"));
    expect(await cleanCaches({ directory: tracked, paths: [path.join(tracked, ".venv")] }, ctx)).toMatchObject({ ok: false });
    expect(await cleanCaches({ directory: path.join(base, "nowhere"), paths: [path.join(base, "nowhere", "node_modules")] }, ctx)).toMatchObject({ ok: false });
    await expect(fs.stat(path.join(tracked, "node_modules"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(orphan, "node_modules"))).resolves.toBeTruthy();
  });

  test("removes the listed cache directories and reports the freed size", async () => {
    const ctx = context([workspace("ws-tracked", tracked)]);
    await snapshotSpace({ refresh: true }, ctx);
    const result = await cleanCaches({ directory: tracked, paths: [path.join(tracked, "node_modules"), path.join(tracked, "packages", "api", "node_modules")] }, ctx);
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/Removed 2 directories, about \d+ KB/);
    await expect(fs.stat(path.join(tracked, "node_modules"))).rejects.toThrow();
    await expect(fs.stat(path.join(tracked, "target"))).resolves.toBeTruthy();
  });
});

describe("removeWorktree and pruneWorktrees", () => {
  test("refuses the main checkout and Paseo workspaces", async () => {
    const ctx = context([workspace("ws-tracked", tracked)]);
    expect(await removeWorktree({ rootPath: root, directory: root, force: false }, ctx)).toMatchObject({ ok: false });
    expect(await removeWorktree({ rootPath: root, directory: tracked, force: false }, ctx)).toMatchObject({ ok: false });
    expect(await removeWorktree({ rootPath: path.join(base, "other"), directory: orphan, force: false }, ctx)).toMatchObject({ ok: false });
    await expect(fs.stat(tracked)).resolves.toBeTruthy();
  });

  test("a dirty orphan needs force", async () => {
    const ctx = context([workspace("ws-main", root)]);
    const refused = await removeWorktree({ rootPath: root, directory: orphan, force: false }, ctx);
    expect(refused.ok).toBe(false);
    expect(refused.message).toMatch(/modified|untracked|force/);
    await expect(fs.stat(orphan)).resolves.toBeTruthy();
    expect(await removeWorktree({ rootPath: root, directory: orphan, force: true }, ctx)).toMatchObject({ ok: true });
    await expect(fs.stat(orphan)).rejects.toThrow();
  });

  test("prune forgets the worktree whose directory is gone", async () => {
    expect(await pruneWorktrees({ rootPath: path.join(base, "other") }, context([]))).toMatchObject({ ok: false });
    expect(await pruneWorktrees({ rootPath: root }, context([workspace("ws-main", root)]))).toMatchObject({ ok: true });
    expect(git(root, "worktree", "list", "--porcelain")).not.toContain(gone);
  });
});
