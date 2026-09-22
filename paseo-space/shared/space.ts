import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** directories that are always regenerable; `dist` and `build` are left out because some repos commit them */
export const CACHE_NAMES = [
  "node_modules",
  ".venv",
  "venv",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".svelte-kit",
  ".output",
  "target",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  "__pycache__",
  ".tox",
  "coverage",
  ".gradle",
  ".dart_tool",
] as const;

export const CacheSchema = z.object({ path: z.string(), kb: z.number() });

export const EntrySchema = z.object({
  directory: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  projectRootPath: z.string(),
  /** `main` is the project checkout itself, `orphan` a git worktree Paseo does not track, `prunable` a git entry whose directory is gone */
  kind: z.enum(["workspace", "main", "orphan", "prunable"]),
  workspaceId: z.string().nullable(),
  name: z.string(),
  branch: z.string().nullable(),
  dirty: z.boolean().nullable(),
  activityAt: z.string().nullable(),
  totalKb: z.number().nullable(),
  caches: z.array(CacheSchema),
  sizedAt: z.string().nullable(),
  error: z.string().nullable(),
});

export const SnapshotSchema = z.object({
  entries: z.array(EntrySchema),
  disk: z.object({ path: z.string(), freeKb: z.number(), totalKb: z.number() }).nullable(),
  errors: z.array(z.string()),
  takenAt: z.string(),
});

export const ActionResultSchema = z.object({ ok: z.boolean(), message: z.string() });

export type Cache = z.output<typeof CacheSchema>;
export type Entry = z.output<typeof EntrySchema>;
export type Snapshot = z.output<typeof SnapshotSchema>;
export type ActionResult = z.output<typeof ActionResultSchema>;

/** `refresh` re-runs `du`; otherwise sizes come from the daemon cache for a few minutes */
export const snapshotRpc = defineRpc({
  name: "space.snapshot",
  input: z.object({ refresh: z.boolean().default(false) }),
  output: SnapshotSchema,
});

export const cleanRpc = defineRpc({
  name: "space.clean",
  input: z.object({ directory: z.string(), paths: z.array(z.string()).min(1) }),
  output: ActionResultSchema,
});

export const removeWorktreeRpc = defineRpc({
  name: "space.remove-worktree",
  input: z.object({ rootPath: z.string(), directory: z.string(), force: z.boolean().default(false) }),
  output: ActionResultSchema,
});

export const pruneRpc = defineRpc({
  name: "space.prune",
  input: z.object({ rootPath: z.string() }),
  output: ActionResultSchema,
});

export type GitWorktree = { path: string; branch: string | null; prunable: boolean };

/**
 * `git worktree list --porcelain` prints one stanza per worktree: a `worktree <path>`
 * line, then `HEAD`, `branch refs/heads/x` or `detached`, and `prunable <reason>`
 * when the directory no longer exists.
 */
export function parseGitWorktrees(output: string): GitWorktree[] {
  const out: GitWorktree[] = [];
  let current: GitWorktree | null = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length), branch: null, prunable: false };
      out.push(current);
    } else if (current && line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    } else if (current && line.startsWith("prunable")) {
      current.prunable = true;
    }
  }
  return out;
}

/**
 * `du -k -d N <dir>` prints `<kb>\t<path>` per directory, the root last. Cache
 * directories are picked by basename; a cache nested inside another cache is
 * already counted by its parent and skipped.
 */
export function parseDu(output: string, directory: string, cacheNames: readonly string[] = CACHE_NAMES): { totalKb: number | null; caches: Cache[] } {
  const sizes = new Map<string, number>();
  for (const line of output.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    const kb = Number.parseInt(line.slice(0, tab), 10);
    if (!Number.isInteger(kb)) continue;
    sizes.set(line.slice(tab + 1), kb);
  }
  const names = new Set<string>(cacheNames);
  const prefix = `${directory}/`;
  const caches: Cache[] = [];
  for (const [path, kb] of sizes) {
    if (!path.startsWith(prefix)) continue;
    const parts = path.slice(prefix.length).split("/");
    const last = parts[parts.length - 1] ?? "";
    if (!names.has(last)) continue;
    if (parts.slice(0, -1).some((part) => names.has(part))) continue;
    caches.push({ path, kb });
  }
  caches.sort((a, b) => b.kb - a.kb);
  return { totalKb: sizes.get(directory) ?? null, caches };
}

export function cacheKb(entry: Pick<Entry, "caches">): number {
  return entry.caches.reduce((sum, cache) => sum + cache.kb, 0);
}

export function formatKb(kb: number): string {
  if (kb < 1024) return `${kb} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb < 10 ? gb.toFixed(2) : gb.toFixed(1)} GB`;
}

export type Section = {
  projectId: string;
  title: string;
  rootPath: string;
  entries: Entry[];
  totalKb: number;
  cacheKb: number;
};

/** one section per project, biggest first, entries biggest first */
export function sectionsByProject(entries: Entry[]): Section[] {
  const byProject = new Map<string, Section>();
  for (const entry of entries) {
    let section = byProject.get(entry.projectId);
    if (!section) {
      section = { projectId: entry.projectId, title: entry.projectName, rootPath: entry.projectRootPath, entries: [], totalKb: 0, cacheKb: 0 };
      byProject.set(entry.projectId, section);
    }
    section.entries.push(entry);
    section.totalKb += entry.totalKb ?? 0;
    section.cacheKb += cacheKb(entry);
  }
  const sections = [...byProject.values()];
  for (const section of sections) section.entries.sort((a, b) => (b.totalKb ?? -1) - (a.totalKb ?? -1));
  return sections.sort((a, b) => b.totalKb - a.totalKb);
}

export function totals(entries: Entry[]): { totalKb: number; cacheKb: number; worktrees: number; orphans: number } {
  let totalKb = 0;
  let cache = 0;
  let worktrees = 0;
  let orphans = 0;
  for (const entry of entries) {
    totalKb += entry.totalKb ?? 0;
    cache += cacheKb(entry);
    if (entry.kind === "workspace" || entry.kind === "orphan") worktrees += 1;
    if (entry.kind === "orphan" || entry.kind === "prunable") orphans += 1;
  }
  return { totalKb, cacheKb: cache, worktrees, orphans };
}
