import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter } from "node:path";

// the daemon is started by the desktop app with a minimal PATH, so brew binaries need a fallback lookup
const FALLBACK_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", `${process.env.HOME ?? ""}/.local/bin`];

const resolved = new Map<string, string>();

export function resolveBinary(name: string): string {
  const cached = resolved.get(name);
  if (cached) return cached;
  const dirs = [...(process.env.PATH ?? "").split(delimiter), ...FALLBACK_DIRS];
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = `${dir}/${name}`;
    try {
      accessSync(candidate, constants.X_OK);
      resolved.set(name, candidate);
      return candidate;
    } catch {
      // keep looking
    }
  }
  throw new Error(`${name} is not installed or not on PATH`);
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxBuffer?: number;
}

export function run(binary: string, args: string[], options: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      resolveBinary(binary),
      args,
      {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve(stdout);
      },
    );
  });
}
