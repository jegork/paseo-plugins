import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ActiveDispatch, GlobalConfig, ProjectConfig } from "../shared/beads";

export const PASEO_HOME = process.env.PASEO_HOME ?? join(homedir(), ".paseo");
export const BEADS_HOME = join(PASEO_HOME, "beads");

const CONFIG_PATH = join(BEADS_HOME, "queue.json");
const STATE_PATH = join(BEADS_HOME, "queue-state.json");

export interface QueueConfig {
  global: GlobalConfig;
  projects: ProjectConfig[];
}

export interface QueueState {
  active: ActiveDispatch[];
}

const DEFAULT_CONFIG: QueueConfig = {
  global: { paused: false, pollSeconds: 30, provider: "claude/claude-sonnet-5", actor: "paseo" },
  projects: [],
};

function readJson<T>(path: string, fallback: T): T {
  try {
    return { ...fallback, ...(JSON.parse(readFileSync(path, "utf8")) as T) };
  } catch {
    return fallback;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(BEADS_HOME, { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, path);
}

export function loadConfig(): QueueConfig {
  const loaded = readJson(CONFIG_PATH, DEFAULT_CONFIG);
  return { global: { ...DEFAULT_CONFIG.global, ...loaded.global }, projects: loaded.projects ?? [] };
}

export function saveConfig(config: QueueConfig): void {
  writeJson(CONFIG_PATH, config);
}

export function loadState(): QueueState {
  return readJson(STATE_PATH, { active: [] });
}

export function saveState(state: QueueState): void {
  writeJson(STATE_PATH, state);
}

export function findProject(config: QueueConfig, root: string): ProjectConfig | undefined {
  return config.projects.find((project) => project.root === root);
}

export function defaultProject(root: string): ProjectConfig {
  return { root, mode: "external", autoDispatch: false, isolation: "worktree", provider: null, maxConcurrent: 1 };
}
