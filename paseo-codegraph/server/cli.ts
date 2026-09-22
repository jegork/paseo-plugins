import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { parseChangedFiles } from "../shared/parse";

const run = promisify(execFile);

export interface Exec {
  stdout: string;
  stderr: string;
  code: number;
}

/** Runs a tool and never throws: a failed spawn or non-zero exit comes back as `code` plus stderr. */
export async function exec(command: string, args: string[], options: { cwd?: string; timeoutMs?: number } = {}): Promise<Exec> {
  try {
    const { stdout, stderr } = await run(command, args, {
      cwd: options.cwd,
      encoding: "utf8",
      timeout: options.timeoutMs ?? 20_000,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: "1" },
    });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string; code?: number | string };
    return {
      stdout: failure.stdout ?? "",
      stderr: (failure.stderr ?? "").trim() || failure.message,
      code: typeof failure.code === "number" ? failure.code : -1,
    };
  }
}

export function codegraph(args: string[], root: string): Promise<Exec> {
  return exec("codegraph", [...args, "-p", root], { cwd: root });
}

export function git(args: string[], cwd: string): Promise<Exec> {
  return exec("git", args, { cwd, timeoutMs: 15_000 });
}

export function firstLine(text: string): string {
  return text.split("\n")[0] ?? "";
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// ~/.codegraph holds global settings, so only a directory with the database counts as an index
function hasIndex(dir: string): Promise<boolean> {
  return exists(join(dir, ".codegraph", "codegraph.db"));
}

/**
 * The directory codegraph answers from: the nearest ancestor with an index,
 * or for a worktree (Paseo keeps them outside the repository) the main checkout,
 * whose index still describes the same symbols.
 */
export async function resolveIndexRoot(directory: string): Promise<string | null> {
  let dir = directory;
  for (let depth = 0; depth < 8; depth += 1) {
    if (await hasIndex(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const common = await git(["rev-parse", "--path-format=absolute", "--git-common-dir"], directory);
  if (common.code !== 0) return null;
  const main = dirname(common.stdout.trim());
  return (await hasIndex(main)) ? main : null;
}

async function defaultBase(cwd: string): Promise<string | null> {
  const head = await git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], cwd);
  if (head.code === 0 && head.stdout.trim() !== "") return head.stdout.trim();
  for (const name of ["main", "master"]) {
    const local = await git(["rev-parse", "--verify", "--quiet", `refs/heads/${name}`], cwd);
    if (local.code === 0) return name;
  }
  return null;
}

export interface DiffState {
  baseRef: string | null;
  files: string[];
  /** changes when the patch or the untracked set changes */
  signature: string;
}

export async function diffState(cwd: string): Promise<DiffState> {
  const baseRef = await defaultBase(cwd);
  let against = "HEAD";
  if (baseRef !== null) {
    const mergeBase = await git(["merge-base", "HEAD", baseRef], cwd);
    if (mergeBase.code === 0 && mergeBase.stdout.trim() !== "") against = mergeBase.stdout.trim();
  }
  const [names, status, patch] = await Promise.all([
    git(["diff", "--name-only", against], cwd),
    git(["status", "--porcelain", "--untracked-files=all"], cwd),
    git(["diff", "--no-color", against], cwd),
  ]);
  const files = parseChangedFiles(names.stdout, status.stdout);
  const signature = createHash("sha1").update(against).update("\0").update(patch.stdout).update("\0").update(status.stdout).digest("hex");
  return { baseRef, files, signature };
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
