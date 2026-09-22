import { defineAttachmentSource, defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const attachmentItem = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  url: z.url(),
  text: z.string(),
  resourceType: z.string(),
});

export const pullRequestSummary = z.object({
  id: z.number(),
  title: z.string(),
  status: z.string(),
  isDraft: z.boolean(),
  sourceBranch: z.string(),
  targetBranch: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
  url: z.url(),
  reviewers: z.array(z.object({ name: z.string(), vote: z.number() })),
});

export const pipelineRun = z.object({
  id: z.number(),
  project: z.string(),
  pipeline: z.string(),
  status: z.string(),
  result: z.string().nullable(),
  finished: z.string().nullable(),
  url: z.url().nullable(),
});

export const reviewComment = z.object({
  file: z.string().nullable(),
  author: z.string(),
  date: z.string(),
  content: z.string(),
  resolved: z.boolean(),
});

export const prOverview = defineRpc({
  name: "ado.pr.overview",
  input: z.object({ cwd: z.string(), id: z.number().optional() }),
  output: z.object({
    branch: z.string(),
    pr: pullRequestSummary.nullable(),
    runs: z.array(pipelineRun),
    comments: z.array(reviewComment),
  }),
});

export const runFailure = defineRpc({
  name: "ado.run.failure",
  input: z.object({ cwd: z.string(), runId: z.number(), project: z.string() }),
  output: z.object({
    pipeline: z.string(),
    url: z.url(),
    tasks: z.array(z.object({ name: z.string(), issues: z.array(z.string()), logTail: z.string() })),
  }),
});

export const mergeStrategy = z.enum(["noFastForward", "squash", "rebase", "rebaseMerge"]);

export const prMergeState = defineRpc({
  name: "ado.pr.merge-state",
  input: z.object({ cwd: z.string(), id: z.number() }),
  output: z.object({
    mergeStatus: z.string(),
    isDraft: z.boolean(),
    autoCompleteBy: z.string().nullable(),
    strategy: mergeStrategy.nullable(),
    deleteSourceBranch: z.boolean(),
    allowedStrategies: z.array(mergeStrategy),
    policies: z.array(z.object({ type: z.string(), status: z.string(), blocking: z.boolean() })),
    canCompleteNow: z.boolean(),
  }),
});

export const prComplete = defineRpc({
  name: "ado.pr.complete",
  input: z.object({
    cwd: z.string(),
    id: z.number(),
    action: z.enum(["auto-complete", "complete", "cancel-auto-complete"]),
    strategy: mergeStrategy.optional(),
    deleteSourceBranch: z.boolean().optional(),
    transitionWorkItems: z.boolean().optional(),
  }),
  output: z.object({ status: z.string(), autoCompleteBy: z.string().nullable() }),
});

export const prList = defineRpc({
  name: "ado.pr.list",
  input: z.object({ cwd: z.string() }),
  output: z.object({ items: z.array(pullRequestSummary) }),
});

export const prCreate = defineRpc({
  name: "ado.pr.create",
  input: z.object({ cwd: z.string(), title: z.string().optional() }),
  output: z.object({ id: z.number(), title: z.string(), url: z.url() }),
});

export const searchWorkItems = defineRpc({
  name: "ado.workitems.search",
  input: z.object({ query: z.string() }),
  output: z.object({ items: z.array(attachmentItem) }),
});

export const searchPullRequests = defineRpc({
  name: "ado.prs.search",
  input: z.object({ query: z.string() }),
  output: z.object({ items: z.array(attachmentItem) }),
});

export const workItemSource = defineAttachmentSource({
  id: "ado-work-item",
  title: "Azure DevOps work item",
  icon: "CircleDot",
  pickerTitle: "Attach work item",
  searchPlaceholder: "Search by id or title",
  search: searchWorkItems,
});

export const pullRequestSource = defineAttachmentSource({
  id: "ado-pull-request",
  title: "Azure DevOps pull request",
  icon: "GitPullRequest",
  pickerTitle: "Attach pull request",
  searchPlaceholder: "Search by id or title",
  search: searchPullRequests,
});

export type PullRequestSummary = z.infer<typeof pullRequestSummary>;
export type PipelineRun = z.infer<typeof pipelineRun>;
export type ReviewComment = z.infer<typeof reviewComment>;
export type MergeStrategy = z.infer<typeof mergeStrategy>;
export type MergeState = z.infer<(typeof prMergeState)["output"]>;

export const STRATEGY_LABEL: Record<MergeStrategy, string> = {
  noFastForward: "Merge commit",
  squash: "Squash",
  rebase: "Rebase, fast-forward",
  rebaseMerge: "Rebase, merge commit",
};
