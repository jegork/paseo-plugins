import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  CACHE_NAMES,
  cacheKb,
  formatKb,
  parseDu,
  parseGitWorktrees,
  type ActionResult,
  type Cache,
  type Entry,
  type Snapshot,
  cleanRpc,
  pruneRpc,
  removeWorktreeRpc,
  snapshotRpc,
} from "../shared/space";

const run = promisify(execFile);

const SIZE_TTL_MS = 5 * 60_000;
const DU_DEPTH = "4";

type Sized = { totalKb: number | null; caches: Cache[]; sizedAt: string };
const sizeCache = new Map<string, Sized>();

async function runTool(command: string, args: string[], timeout = 30_000): Promise<string> {
  const { stdout } = await run(command, args, { encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

function firstLine(error: unknown): string {
  const stderr = typeof error === "object" && error !== null ? String(Reflect.get(error, "stderr") ?? "") : "";
  const text = stderr.trim() || (error instanceof Error ? error.message : String(error));
  return text.split("\n")[0] ?? "command failed";
}

function exitCode(error: unknown): number | null {
  const code = typeof error === "object" && error !== null ? Reflect.get(error, "code") : null;
  return typeof code === "number" ? code : null;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

type WorkspaceRef = { id: string; name: string; directory: string; projectId: string; activityAt: string | null };
type ProjectRef = { id: string; name: string; rootPath: string };
type Scopes = { workspaces: WorkspaceRef[]; projects: ProjectRef[] };

async function listScopes(context: PluginHandlerContext): Promise<Scopes> {
  const page = await context.paseo.workspaces.list();
  const workspaces: WorkspaceRef[] = [];
  const projects = new Map<string, ProjectRef>();
  for (const workspace of page.entries) {
    projects.set(workspace.projectId, {
      id: workspace.projectId,
      name: workspace.projectCustomName ?? workspace.projectDisplayName,
      rootPath: workspace.projectRootPath,
    });
    if (workspace.archivingAt !== null && workspace.archivingAt !== undefined) continue;
    workspaces.push({
      id: workspace.id,
      name: workspace.title ?? workspace.name,
      directory: workspace.workspaceDirectory ?? workspace.projectRootPath,
      projectId: workspace.projectId,
      activityAt: workspace.activityAt ?? null,
    });
  }
  try {
    const listed = await context.paseo.projects.list();
    for (const project of listed.projects) {
      if (!projects.has(project.projectId)) {
        projects.set(project.projectId, {
          id: project.projectId,
          name: project.projectCustomName ?? project.projectDisplayName,
          rootPath: project.projectRootPath,
        });
      }
    }
  } catch {
    // older daemons have no project listing; workspace-derived projects suffice
  }
  return { workspaces, projects: [...projects.values()] };
}

type Discovered = Omit<Entry, "totalKb" | "caches" | "sizedAt" | "dirty">;

/** every directory worth sizing: git worktrees of each project, plus Paseo workspaces git does not know about */
async function discover(scopes: Scopes, errors: string[]): Promise<Discovered[]> {
  const entries: Discovered[] = [];
  const seen = new Set<string>();
  await mapLimit(scopes.projects, 4, async (project) => {
    let worktrees;
    try {
      worktrees = parseGitWorktrees(await runTool("git", ["-C", project.rootPath, "worktree", "list", "--porcelain"]));
    } catch (error) {
      if (exitCode(error) === 128) worktrees = [{ path: project.rootPath, branch: null, prunable: false }];
      else {
        errors.push(`${project.name}: ${firstLine(error)}`);
        return;
      }
    }
    for (const worktree of worktrees) {
      const workspace = scopes.workspaces.find((candidate) => candidate.directory === worktree.path) ?? null;
      const isRoot = worktree.path === project.rootPath;
      seen.add(worktree.path);
      entries.push({
        directory: worktree.path,
        projectId: project.id,
        projectName: project.name,
        projectRootPath: project.rootPath,
        kind: worktree.prunable ? "prunable" : isRoot ? "main" : workspace ? "workspace" : "orphan",
        workspaceId: workspace?.id ?? null,
        name: isRoot ? "main checkout" : (workspace?.name ?? path.basename(worktree.path)),
        branch: worktree.branch,
        activityAt: workspace?.activityAt ?? null,
        error: null,
      });
    }
  });
  for (const workspace of scopes.workspaces) {
    if (seen.has(workspace.directory)) continue;
    const project = scopes.projects.find((candidate) => candidate.id === workspace.projectId);
    if (!project) continue;
    seen.add(workspace.directory);
    entries.push({
      directory: workspace.directory,
      projectId: project.id,
      projectName: project.name,
      projectRootPath: project.rootPath,
      kind: workspace.directory === project.rootPath ? "main" : "workspace",
      workspaceId: workspace.id,
      name: workspace.name,
      branch: null,
      activityAt: workspace.activityAt,
      error: null,
    });
  }
  return entries;
}

/** only gitignored cache dirs are offered for deletion, so a committed `target/` is never removed */
async function ignoredOnly(directory: string, caches: Cache[]): Promise<Cache[]> {
  if (caches.length === 0) return caches;
  let output: string;
  try {
    output = await runTool("git", ["-C", directory, "check-ignore", ...caches.map((cache) => cache.path)]);
  } catch (error) {
    const code = exitCode(error);
    if (code === 1) return [];
    if (code === 128) return caches;
    throw error;
  }
  const ignored = new Set(output.split("\n").filter(Boolean));
  return caches.filter((cache) => ignored.has(cache.path));
}

async function size(directory: string, refresh: boolean): Promise<Sized> {
  const cached = sizeCache.get(directory);
  if (!refresh && cached && Date.now() - Date.parse(cached.sizedAt) < SIZE_TTL_MS) return cached;
  const parsed = parseDu(await runTool("du", ["-k", "-d", DU_DEPTH, directory], 180_000), directory);
  const sized: Sized = { totalKb: parsed.totalKb, caches: await ignoredOnly(directory, parsed.caches), sizedAt: new Date().toISOString() };
  sizeCache.set(directory, sized);
  return sized;
}

async function isDirty(directory: string): Promise<boolean | null> {
  try {
    return (await runTool("git", ["-C", directory, "status", "--porcelain", "--untracked-files=no"])).trim().length > 0;
  } catch {
    return null;
  }
}

async function diskUsage(target: string): Promise<Snapshot["disk"]> {
  try {
    const stats = await fs.statfs(target);
    const toKb = (blocks: number | bigint) => Math.round((Number(blocks) * Number(stats.bsize)) / 1024);
    return { path: target, freeKb: toKb(stats.bavail), totalKb: toKb(stats.blocks) };
  } catch {
    return null;
  }
}

export async function snapshotSpace(input: RpcInput<typeof snapshotRpc>, context: PluginHandlerContext): Promise<Snapshot> {
  const started = Date.now();
  const errors: string[] = [];
  const scopes = await listScopes(context);
  const discovered = await discover(scopes, errors);
  const entries = await mapLimit(discovered, 4, async (entry): Promise<Entry> => {
    if (entry.kind === "prunable") return { ...entry, dirty: null, totalKb: null, caches: [], sizedAt: null };
    const [dirty, sized] = await Promise.all([
      isDirty(entry.directory),
      size(entry.directory, input.refresh ?? false).catch((error: unknown) => ({ error: firstLine(error) })),
    ]);
    if ("error" in sized) return { ...entry, dirty, totalKb: null, caches: [], sizedAt: null, error: sized.error };
    return { ...entry, dirty, ...sized };
  });
  const disk = await diskUsage(path.join(homedir(), ".paseo"));
  console.log(JSON.stringify({ event: "space.snapshot", refresh: input.refresh ?? false, entries: entries.length, sized: entries.filter((entry) => entry.totalKb !== null).length, errors: errors.length, durationMs: Date.now() - started }));
  return { entries, disk, errors, takenAt: new Date().toISOString() };
}

async function findEntry(context: PluginHandlerContext, directory: string): Promise<Discovered | null> {
  const entries = await discover(await listScopes(context), []);
  return entries.find((entry) => entry.directory === directory) ?? null;
}

/**
 * Deletes cache directories inside a known worktree. Each path must sit under
 * that worktree, carry a cache basename, and be a real directory rather than a
 * symlink, so a stale panel cannot point this at anything else.
 */
export async function cleanCaches({ directory, paths }: RpcInput<typeof cleanRpc>, context: PluginHandlerContext): Promise<ActionResult> {
  const entry = await findEntry(context, directory);
  if (!entry || entry.kind === "prunable") return { ok: false, message: `${directory} is not a known worktree.` };
  const names = new Set<string>(CACHE_NAMES);
  const prefix = `${directory}${path.sep}`;
  const removed: Cache[] = [];
  for (const target of paths) {
    const resolved = path.resolve(target);
    if (!resolved.startsWith(prefix) || !names.has(path.basename(resolved))) return { ok: false, message: `Refusing to delete ${target}.` };
    let stat;
    try {
      stat = await fs.lstat(resolved);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) return { ok: false, message: `Refusing to delete ${target}: not a directory.` };
    const known = sizeCache.get(directory)?.caches.find((cache) => cache.path === resolved);
    await fs.rm(resolved, { recursive: true, force: true });
    removed.push({ path: resolved, kb: known?.kb ?? 0 });
  }
  sizeCache.delete(directory);
  if (removed.length === 0) return { ok: true, message: "Nothing to remove." };
  const freed = cacheKb({ caches: removed });
  return { ok: true, message: `Removed ${removed.length} ${removed.length === 1 ? "directory" : "directories"}${freed > 0 ? `, about ${formatKb(freed)}` : ""}.` };
}

/** Only a git worktree Paseo does not own can be removed here; Paseo workspaces are archived through Paseo. */
export async function removeWorktree({ rootPath, directory, force }: RpcInput<typeof removeWorktreeRpc>, context: PluginHandlerContext): Promise<ActionResult> {
  const entry = await findEntry(context, directory);
  if (!entry || entry.projectRootPath !== rootPath) return { ok: false, message: `${directory} is not a known worktree.` };
  if (entry.kind !== "orphan") return { ok: false, message: `${entry.name} is ${entry.kind === "main" ? "the main checkout" : "a Paseo workspace"}; archive it in Paseo instead.` };
  try {
    await runTool("git", ["-C", rootPath, "worktree", "remove", ...(force ? ["--force"] : []), directory], 120_000);
  } catch (error) {
    return { ok: false, message: firstLine(error) };
  }
  sizeCache.delete(directory);
  return { ok: true, message: `Removed worktree ${path.basename(directory)}.` };
}

export async function pruneWorktrees({ rootPath }: RpcInput<typeof pruneRpc>, context: PluginHandlerContext): Promise<ActionResult> {
  const scopes = await listScopes(context);
  if (!scopes.projects.some((project) => project.rootPath === rootPath)) return { ok: false, message: `${rootPath} is not a known project.` };
  try {
    await runTool("git", ["-C", rootPath, "worktree", "prune"]);
  } catch (error) {
    return { ok: false, message: firstLine(error) };
  }
  return { ok: true, message: "Pruned stale worktree entries." };
}
