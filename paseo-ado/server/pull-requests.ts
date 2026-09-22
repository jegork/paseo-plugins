import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { prCreate, prList, prOverview, PullRequestSummary, PipelineRun, ReviewComment } from "../shared/ado";
import { az, git, orgFromApiUrl } from "./az";

interface AzPullRequest {
  pullRequestId: number;
  title: string;
  status: string;
  isDraft: boolean;
  sourceRefName: string;
  targetRefName: string;
  creationDate: string;
  url: string;
  createdBy: { displayName: string };
  reviewers: { displayName: string; vote: number }[];
  repository: { id: string; name: string; project: { name: string } };
}

interface AzRun {
  id: number;
  url: string;
  definition: { name: string };
  project: { name: string };
  status: string;
  result: string | null;
  finishTime: string | null;
}

interface AzThread {
  isDeleted: boolean;
  status: string | null;
  threadContext: { filePath: string | null } | null;
  comments: {
    commentType: string;
    isDeleted?: boolean;
    content: string;
    publishedDate: string;
    author: { displayName: string };
  }[];
}

export function buildUrl(apiUrl: string, project: string, buildId: number): string {
  return `${orgFromApiUrl(apiUrl)}/${encodeURIComponent(project)}/_build/results?buildId=${buildId}`;
}

export function webUrl(pr: AzPullRequest): string {
  const org = orgFromApiUrl(pr.url);
  const project = encodeURIComponent(pr.repository.project.name);
  const repo = encodeURIComponent(pr.repository.name);
  return `${org}/${project}/_git/${repo}/pullrequest/${pr.pullRequestId}`;
}

export function toSummary(pr: AzPullRequest): PullRequestSummary {
  return {
    id: pr.pullRequestId,
    title: pr.title,
    status: pr.status,
    isDraft: pr.isDraft,
    sourceBranch: pr.sourceRefName.replace(/^refs\/heads\//, ""),
    targetBranch: pr.targetRefName.replace(/^refs\/heads\//, ""),
    createdBy: pr.createdBy.displayName,
    createdAt: pr.creationDate,
    url: webUrl(pr),
    reviewers: pr.reviewers.map((r) => ({ name: r.displayName, vote: r.vote })),
  };
}

async function findPullRequest(cwd: string, branch: string, id?: number): Promise<AzPullRequest | null> {
  if (id !== undefined) {
    return az<AzPullRequest>(["repos", "pr", "show", "--id", String(id)], cwd);
  }
  const active = await az<AzPullRequest[]>(
    ["repos", "pr", "list", "--status", "active", "--source-branch", branch, "--top", "1"],
    cwd,
  );
  return active[0] ?? null;
}

async function listRuns(cwd: string, id: number): Promise<PipelineRun[]> {
  const runs = await az<AzRun[]>(
    ["pipelines", "runs", "list", "--branch", `refs/pull/${id}/merge`, "--top", "10"],
    cwd,
  );
  return runs.map((run) => ({
    id: run.id,
    project: run.project.name,
    pipeline: run.definition.name,
    status: run.status,
    result: run.result ?? null,
    finished: run.finishTime ?? null,
    url: buildUrl(run.url, run.project.name, run.id),
  }));
}

async function listComments(cwd: string, pr: AzPullRequest): Promise<ReviewComment[]> {
  const response = await az<{ value: AzThread[] }>(
    [
      "devops", "invoke", "--area", "git", "--resource", "pullRequestThreads",
      "--route-parameters",
      `project=${pr.repository.project.name}`,
      `repositoryId=${pr.repository.id}`,
      `pullRequestId=${pr.pullRequestId}`,
      "--api-version", "7.1",
    ],
    cwd,
  );
  const comments: ReviewComment[] = [];
  for (const thread of response.value) {
    if (thread.isDeleted) continue;
    const resolved = thread.status === "fixed" || thread.status === "closed" || thread.status === "wontFix";
    for (const comment of thread.comments ?? []) {
      if (comment.commentType === "system" || comment.isDeleted) continue;
      comments.push({
        file: thread.threadContext?.filePath ?? null,
        author: comment.author.displayName,
        date: comment.publishedDate,
        content: (comment.content ?? "").replace(/<!--[\s\S]*?-->\s*/g, "").trim(),
        resolved,
      });
    }
  }
  return comments;
}

export async function overview({ cwd, id }: RpcInput<typeof prOverview>): Promise<RpcOutput<typeof prOverview>> {
  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const pr = await findPullRequest(cwd, branch, id);
  if (!pr) return { branch, pr: null, runs: [], comments: [] };
  const [runs, comments] = await Promise.all([listRuns(cwd, pr.pullRequestId), listComments(cwd, pr)]);
  return { branch, pr: toSummary(pr), runs, comments };
}

export async function list({ cwd }: RpcInput<typeof prList>): Promise<RpcOutput<typeof prList>> {
  const prs = await az<AzPullRequest[]>(["repos", "pr", "list", "--status", "active", "--top", "50"], cwd);
  return { items: prs.map(toSummary) };
}

export async function create({ cwd, title }: RpcInput<typeof prCreate>): Promise<RpcOutput<typeof prCreate>> {
  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const upstream = await git(["rev-parse", "--abbrev-ref", "@{upstream}"], cwd).catch(() => "");
  if (!upstream) {
    await git(["push", "-u", "origin", "HEAD"], cwd);
  } else {
    const ahead = await git(["rev-list", "--count", `${upstream}..HEAD`], cwd);
    if (ahead !== "0") await git(["push"], cwd);
  }
  const subject = title?.trim() || (await git(["log", "-1", "--pretty=%s"], cwd));
  const pr = await az<AzPullRequest>(
    ["repos", "pr", "create", "--source-branch", branch, "--title", subject],
    cwd,
  );
  return { id: pr.pullRequestId, title: pr.title, url: webUrl(pr) };
}
