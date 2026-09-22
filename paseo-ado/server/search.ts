import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { searchPullRequests, searchWorkItems } from "../shared/ado";
import { az, orgFromApiUrl, stripHtml } from "./az";
import { toSummary } from "./pull-requests";

interface AzWorkItem {
  id: number;
  url: string;
  fields: Record<string, unknown> & {
    "System.Title"?: string;
    "System.WorkItemType"?: string;
    "System.State"?: string;
    "System.TeamProject"?: string;
    "System.Parent"?: number;
    "System.CommentCount"?: number;
    "System.Description"?: string;
    "System.AssignedTo"?: { displayName: string } | string;
    "Microsoft.VSTS.Common.AcceptanceCriteria"?: string;
    "Microsoft.VSTS.TCM.ReproSteps"?: string;
    "Microsoft.VSTS.TCM.SystemInfo"?: string;
  };
}

interface AzComment {
  createdBy: { displayName: string };
  createdDate: string;
  text: string;
}

const WORK_ITEM_FIELDS =
  "[System.Id], [System.Title], [System.WorkItemType], [System.State], [System.TeamProject], [System.AssignedTo], [System.Parent], [System.CommentCount]";

// search results come back without bodies, and each body is one az call, so keep the batch small
const DETAIL_LIMIT = 6;

function wiqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function assignee(item: AzWorkItem): string {
  const value = item.fields["System.AssignedTo"];
  if (!value) return "Unassigned";
  return typeof value === "string" ? value : value.displayName;
}

function workItemUrl(item: AzWorkItem): string {
  const project = encodeURIComponent(item.fields["System.TeamProject"] ?? "");
  return `${orgFromApiUrl(item.url)}/${project}/_workitems/edit/${item.id}`;
}

function showWorkItem(id: number): Promise<AzWorkItem> {
  return az<AzWorkItem>(["boards", "work-item", "show", "--id", String(id)]);
}

async function listComments(item: AzWorkItem): Promise<AzComment[]> {
  if (!item.fields["System.CommentCount"]) return [];
  const project = item.fields["System.TeamProject"];
  if (!project) return [];
  const result = await az<{ comments: AzComment[] }>([
    "devops", "invoke", "--area", "wit", "--resource", "comments",
    "--route-parameters", `project=${project}`, `workItemId=${item.id}`,
    "--api-version", "7.1-preview",
  ]).catch(() => ({ comments: [] as AzComment[] }));
  return result.comments ?? [];
}

function bodySections(item: AzWorkItem): string[] {
  const sections: string[] = [];
  const description = stripHtml(item.fields["System.Description"]);
  const repro = stripHtml(item.fields["Microsoft.VSTS.TCM.ReproSteps"]);
  const systemInfo = stripHtml(item.fields["Microsoft.VSTS.TCM.SystemInfo"]);
  const acceptance = stripHtml(item.fields["Microsoft.VSTS.Common.AcceptanceCriteria"]);
  if (description) sections.push(`\n${description}`);
  if (repro) sections.push(`\nRepro steps:\n${repro}`);
  if (systemInfo) sections.push(`\nSystem info:\n${systemInfo}`);
  if (acceptance) sections.push(`\nAcceptance criteria:\n${acceptance}`);
  return sections;
}

function snapshot(item: AzWorkItem, parent: AzWorkItem | null, comments: AzComment[]): string {
  const title = item.fields["System.Title"] ?? `Work item ${item.id}`;
  const type = item.fields["System.WorkItemType"] ?? "Work item";
  const lines = [
    `${type} #${item.id}: ${title}`,
    `State: ${item.fields["System.State"] ?? "unknown"}`,
    `Assigned to: ${assignee(item)}`,
    `URL: ${workItemUrl(item)}`,
    ...bodySections(item),
  ];
  if (parent) {
    const parentType = parent.fields["System.WorkItemType"] ?? "Parent";
    lines.push(`\nParent ${parentType} #${parent.id}: ${parent.fields["System.Title"] ?? ""}`, `Parent URL: ${workItemUrl(parent)}`, ...bodySections(parent));
  }
  if (comments.length) {
    lines.push("\nDiscussion:");
    for (const comment of comments) {
      lines.push(`- ${comment.createdBy.displayName} (${comment.createdDate.slice(0, 16).replace("T", " ")}): ${stripHtml(comment.text)}`);
    }
  }
  return lines.join("\n");
}

export async function workItems({ query }: RpcInput<typeof searchWorkItems>): Promise<RpcOutput<typeof searchWorkItems>> {
  const trimmed = query.trim();
  const where = /^\d+$/.test(trimmed)
    ? `[System.Id] = ${trimmed}`
    : trimmed
      ? `[System.Title] CONTAINS '${wiqlLiteral(trimmed)}'`
      : "[System.ChangedDate] > @Today - 30";
  const found = await az<AzWorkItem[]>([
    "boards", "query", "--wiql",
    `SELECT ${WORK_ITEM_FIELDS} FROM WorkItems WHERE ${where} ORDER BY [System.ChangedDate] DESC`,
  ]);
  const top = found.slice(0, DETAIL_LIMIT);
  const detailed = await Promise.all(top.map((item) => showWorkItem(item.id).catch(() => item)));
  // tasks usually carry no body of their own; the parent backlog item is where the intent lives
  const parentIds = new Set(detailed.map((item) => item.fields["System.Parent"]).filter((id): id is number => typeof id === "number"));
  const parents = new Map<number, AzWorkItem>();
  await Promise.all([...parentIds].map(async (id) => {
    const parent = await showWorkItem(id).catch(() => null);
    if (parent) parents.set(id, parent);
  }));
  const comments = await Promise.all(detailed.map((item) => listComments(item)));
  return {
    items: detailed.map((item, index) => {
      const title = item.fields["System.Title"] ?? `Work item ${item.id}`;
      const type = item.fields["System.WorkItemType"] ?? "Work item";
      const state = item.fields["System.State"] ?? "";
      const parentId = item.fields["System.Parent"];
      const parent = typeof parentId === "number" ? parents.get(parentId) ?? null : null;
      return {
        id: String(item.id),
        identifier: `#${item.id}`,
        title,
        subtitle: [type, state, parent ? `↑ #${parent.id}` : ""].filter(Boolean).join(" · "),
        url: workItemUrl(item),
        text: snapshot(item, parent, comments[index] ?? []),
        resourceType: "work-item",
      };
    }),
  };
}

interface AzPullRequestWithBody {
  pullRequestId: number;
  description?: string | null;
}

export async function pullRequests({ query }: RpcInput<typeof searchPullRequests>): Promise<RpcOutput<typeof searchPullRequests>> {
  const trimmed = query.trim();
  const byId = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
  const raw = byId !== null
    ? [await az<Parameters<typeof toSummary>[0] & AzPullRequestWithBody>(["repos", "pr", "show", "--id", String(byId)])]
    : await az<(Parameters<typeof toSummary>[0] & AzPullRequestWithBody)[]>([
        "repos", "pr", "list", "--status", "active", "--top", "100",
      ]);
  const needle = trimmed.toLowerCase();
  const matches = byId !== null || !needle
    ? raw
    : raw.filter((pr) => pr.title.toLowerCase().includes(needle) || pr.repository.name.toLowerCase().includes(needle));
  return {
    items: matches.slice(0, 20).map((pr) => {
      const summary = toSummary(pr);
      const text = [
        `Pull request !${summary.id}: ${summary.title}`,
        `Repository: ${pr.repository.name}`,
        `${summary.sourceBranch} → ${summary.targetBranch}`,
        `Author: ${summary.createdBy}`,
        `Status: ${summary.isDraft ? "draft" : summary.status}`,
        `URL: ${summary.url}`,
        pr.description ? `\n${pr.description}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      return {
        id: String(summary.id),
        identifier: `!${summary.id}`,
        title: summary.title,
        subtitle: `${pr.repository.name} · ${summary.createdBy}`,
        url: summary.url,
        text,
        resourceType: "pull-request",
      };
    }),
  };
}
