import { defineAttachmentSource, defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const issue = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  priority: z.number(),
  issue_type: z.string(),
  assignee: z.string().nullable(),
  labels: z.array(z.string()),
  created_at: z.string(),
  updated_at: z.string(),
  description: z.string().nullable(),
  dependency_count: z.number(),
  dependent_count: z.number(),
});

export const comment = z.object({
  id: z.number(),
  author: z.string(),
  text: z.string(),
  created_at: z.string(),
});

export const projectConfig = z.object({
  root: z.string(),
  mode: z.enum(["repo", "external"]),
  autoDispatch: z.boolean(),
  isolation: z.enum(["worktree", "directory"]),
  provider: z.string().nullable(),
  maxConcurrent: z.number().int().min(1).max(10),
});

export const globalConfig = z.object({
  paused: z.boolean(),
  pollSeconds: z.number().int().min(10).max(3600),
  provider: z.string(),
  actor: z.string(),
});

export const activeDispatch = z.object({
  issueId: z.string(),
  root: z.string(),
  agentId: z.string(),
  workspaceId: z.string(),
  startedAt: z.string(),
});

export const dispatcherStatus = z.object({
  lastPollAt: z.string().nullable(),
  lastError: z.string().nullable(),
  active: z.array(activeDispatch),
});

export const configGet = defineRpc({
  name: "beads.config.get",
  input: z.object({}),
  output: z.object({ global: globalConfig, projects: z.array(projectConfig), status: dispatcherStatus }),
});

export const configSetGlobal = defineRpc({
  name: "beads.config.set-global",
  input: globalConfig.partial(),
  output: globalConfig,
});

export const configSetProject = defineRpc({
  name: "beads.config.set-project",
  input: projectConfig.partial().extend({ root: z.string() }),
  output: projectConfig,
});

export const configRemoveProject = defineRpc({
  name: "beads.config.remove-project",
  input: z.object({ root: z.string() }),
  output: z.object({ removed: z.boolean() }),
});

export const issuesList = defineRpc({
  name: "beads.issues.list",
  input: z.object({ root: z.string() }),
  output: z.object({
    beadsDir: z.string(),
    ready: z.array(issue),
    inProgress: z.array(issue),
    blocked: z.array(issue),
    closed: z.array(issue),
    active: z.array(activeDispatch),
  }),
});

export const issueShow = defineRpc({
  name: "beads.issues.show",
  input: z.object({ root: z.string(), id: z.string() }),
  output: z.object({ issue, comments: z.array(comment) }),
});

export const issueCreate = defineRpc({
  name: "beads.issues.create",
  input: z.object({
    root: z.string(),
    title: z.string().min(1),
    description: z.string().optional(),
    priority: z.number().int().min(0).max(4).optional(),
    type: z.string().optional(),
  }),
  output: issue,
});

export const issueTransition = defineRpc({
  name: "beads.issues.transition",
  input: z.object({ root: z.string(), id: z.string(), action: z.enum(["close", "reopen", "block"]), reason: z.string().optional() }),
  output: issue,
});

export const dispatchIssue = defineRpc({
  name: "beads.dispatch",
  input: z.object({ root: z.string(), id: z.string() }),
  output: activeDispatch,
});

export const searchIssues = defineRpc({
  name: "beads.issues.search",
  input: z.object({ query: z.string() }),
  output: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        identifier: z.string(),
        title: z.string(),
        subtitle: z.string().optional(),
        url: z.url(),
        text: z.string(),
        resourceType: z.string(),
      }),
    ),
  }),
});

export const issueSource = defineAttachmentSource({
  id: "beads-issue",
  title: "Beads issue",
  icon: "ListTodo",
  pickerTitle: "Attach Beads issue",
  searchPlaceholder: "Search by id or title",
  search: searchIssues,
});

export const timelineRow = z.object({
  issueId: z.string(),
  title: z.string(),
  root: z.string(),
  status: z.string(),
  note: z.string().nullable(),
});

export type Issue = z.infer<typeof issue>;
export type Comment = z.infer<typeof comment>;
export type ProjectConfig = z.infer<typeof projectConfig>;
export type GlobalConfig = z.infer<typeof globalConfig>;
export type ActiveDispatch = z.infer<typeof activeDispatch>;
export type DispatcherStatus = z.infer<typeof dispatcherStatus>;
export type TimelineRow = z.infer<typeof timelineRow>;

export const PRIORITY_LABEL = ["P0", "P1", "P2", "P3", "P4"];
