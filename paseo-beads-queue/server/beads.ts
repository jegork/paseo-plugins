import { existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { Comment, Issue, ProjectConfig } from "../shared/beads";
import { BEADS_HOME } from "./config";
import { run } from "./exec";
import { createLimiter } from "./limit";

// br takes a sqlite write lock per call, so serialise writers and keep readers few
const limit = createLimiter(2);

export function beadsDir(project: ProjectConfig): string {
  return project.mode === "repo" ? join(project.root, ".beads") : join(BEADS_HOME, basename(project.root), ".beads");
}

export function beadsEnv(project: ProjectConfig): Record<string, string> {
  return { BEADS_DIR: beadsDir(project), RUST_LOG: "error" };
}

interface BrError {
  error?: { code?: string; message?: string };
}

export async function br<T>(project: ProjectConfig, args: string[]): Promise<T> {
  let stdout: string;
  try {
    stdout = await limit(() => run("br", [...args, "--json"], { cwd: project.root, env: beadsEnv(project) }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const parsed = JSON.parse(message) as BrError;
      if (parsed.error?.message) throw new Error(parsed.error.message);
    } catch (inner) {
      if (inner instanceof Error && inner.message !== message) throw inner;
    }
    throw new Error(message.split("\n")[0] ?? message);
  }
  return JSON.parse(stdout || "null") as T;
}

export async function ensureInitialized(project: ProjectConfig): Promise<{ initialized: boolean; dir: string }> {
  const dir = beadsDir(project);
  if (existsSync(join(dir, "beads.db")) || existsSync(join(dir, "issues.jsonl"))) return { initialized: true, dir };
  if (project.mode === "repo") return { initialized: false, dir };
  mkdirSync(dir, { recursive: true });
  const prefix = basename(project.root).replace(/[^a-z0-9]/gi, "").slice(0, 4).toLowerCase() || "bq";
  await br(project, ["init", "--prefix", prefix]);
  return { initialized: true, dir };
}

interface RawIssue {
  id: string;
  title: string;
  status: string;
  priority: number;
  issue_type: string;
  assignee?: string | null;
  labels?: string[];
  created_at: string;
  updated_at: string;
  description?: string | null;
  dependency_count?: number;
  dependent_count?: number;
  comments?: Comment[];
}

function normalize(raw: RawIssue): Issue {
  return {
    id: raw.id,
    title: raw.title,
    status: raw.status,
    priority: raw.priority,
    issue_type: raw.issue_type,
    assignee: raw.assignee ?? null,
    labels: raw.labels ?? [],
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    description: raw.description ?? null,
    dependency_count: raw.dependency_count ?? 0,
    dependent_count: raw.dependent_count ?? 0,
  };
}

function byPriority(a: Issue, b: Issue): number {
  return a.priority - b.priority || a.created_at.localeCompare(b.created_at);
}

export async function ready(project: ProjectConfig): Promise<Issue[]> {
  const raw = await br<RawIssue[]>(project, ["ready"]);
  return (raw ?? []).map(normalize).sort(byPriority);
}

export async function listByStatus(project: ProjectConfig, status: string, limitCount = 0): Promise<Issue[]> {
  const raw = await br<{ issues: RawIssue[] }>(project, ["list", "-s", status, "--limit", String(limitCount)]);
  return (raw?.issues ?? []).map(normalize).sort(byPriority);
}

export async function show(project: ProjectConfig, id: string): Promise<{ issue: Issue; comments: Comment[] }> {
  const raw = await br<RawIssue[]>(project, ["show", id]);
  const first = raw?.[0];
  if (!first) throw new Error(`Issue ${id} not found`);
  const comments = (first.comments ?? []).map((c) => ({ id: c.id, author: c.author, text: c.text, created_at: c.created_at }));
  return { issue: normalize(first), comments };
}

export async function create(
  project: ProjectConfig,
  input: { title: string; description?: string; priority?: number; type?: string },
): Promise<Issue> {
  const args = ["create", input.title];
  if (input.description) args.push("-d", input.description);
  if (input.priority !== undefined) args.push("-p", String(input.priority));
  if (input.type) args.push("-t", input.type);
  return normalize(await br<RawIssue>(project, args));
}

export async function claim(project: ProjectConfig, id: string, actor: string): Promise<void> {
  await br(project, ["update", id, "--claim", "--actor", actor]);
}

export async function release(project: ProjectConfig, id: string): Promise<void> {
  await br(project, ["update", id, "--status", "open", "--assignee", ""]);
}

export async function setStatus(project: ProjectConfig, id: string, status: string): Promise<void> {
  await br(project, ["update", id, "--status", status]);
}

export async function close(project: ProjectConfig, id: string, reason: string, actor: string): Promise<void> {
  await br(project, ["close", id, "--reason", reason, "--actor", actor]);
}

export async function reopen(project: ProjectConfig, id: string): Promise<void> {
  await br(project, ["reopen", id]);
}

export async function addComment(project: ProjectConfig, id: string, text: string, actor: string): Promise<void> {
  await br(project, ["comments", "add", id, text, "--actor", actor]);
}

export async function search(project: ProjectConfig, query: string): Promise<Issue[]> {
  const raw = await br<{ issues?: RawIssue[] } | RawIssue[]>(project, ["search", query, "--limit", "20"]);
  const list = Array.isArray(raw) ? raw : raw?.issues ?? [];
  return list.map(normalize);
}

export function issueText(project: ProjectConfig, issue: Issue, comments: Comment[]): string {
  const lines = [
    `Beads issue ${issue.id}: ${issue.title}`,
    `Project: ${project.root}`,
    `Type: ${issue.issue_type} · Priority: P${issue.priority} · Status: ${issue.status}${issue.assignee ? ` · Assignee: ${issue.assignee}` : ""}`,
    issue.labels.length ? `Labels: ${issue.labels.join(", ")}` : "",
    issue.description ? `\n${issue.description}` : "",
  ];
  if (comments.length) {
    lines.push("", "Comments:");
    for (const c of comments) lines.push(`- ${c.author} (${c.created_at.slice(0, 16).replace("T", " ")}): ${c.text}`);
  }
  return lines.filter((line) => line !== "").join("\n");
}
