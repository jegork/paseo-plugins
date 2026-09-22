import { usePaseo } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import type { AgentEntry, WorkspaceInfo } from "../shared/tree";

const PAGE_LIMIT = 200;
const MAX_PAGES = 5;
const REFRESH_MS = 4000;

export interface Directory {
  readonly entries: AgentEntry[];
  readonly workspaces: ReadonlyMap<string, WorkspaceInfo>;
  readonly projects: ReadonlyMap<string, string>;
}

type Paseo = ReturnType<typeof usePaseo>;

async function loadAgents(paseo: Paseo): Promise<AgentEntry[]> {
  const collected: AgentEntry[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await paseo.agents.list({
      page: cursor === undefined ? { limit: PAGE_LIMIT } : { limit: PAGE_LIMIT, cursor },
    });
    collected.push(...result.entries);
    if (!result.pageInfo.hasMore || result.pageInfo.nextCursor === null) break;
    cursor = result.pageInfo.nextCursor;
  }
  return collected;
}

async function loadWorkspaces(paseo: Paseo): Promise<Map<string, WorkspaceInfo>> {
  const workspaces = new Map<string, WorkspaceInfo>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await paseo.workspaces.list({
      page: cursor === undefined ? { limit: PAGE_LIMIT } : { limit: PAGE_LIMIT, cursor },
    });
    for (const workspace of result.entries) {
      workspaces.set(workspace.id, {
        id: workspace.id,
        name: workspace.name,
        projectName: workspace.projectDisplayName,
        additions: workspace.diffStat?.additions ?? 0,
        deletions: workspace.diffStat?.deletions ?? 0,
        pinned: workspace.pinnedAt != null,
      });
    }
    if (!result.pageInfo.hasMore || result.pageInfo.nextCursor === null) break;
    cursor = result.pageInfo.nextCursor;
  }
  return workspaces;
}

/** Agents, plus the workspace and project rows that carry names, branches, and diff stats. */
export function useDirectory() {
  const paseo = usePaseo();
  return useQuery<Directory>({
    queryKey: ["agent-tree", "directory"],
    refetchInterval: REFRESH_MS,
    async queryFn() {
      const [entries, workspaces, registry] = await Promise.all([
        loadAgents(paseo),
        loadWorkspaces(paseo),
        paseo.projects.list(),
      ]);
      const projects = new Map<string, string>();
      for (const project of registry.projects) {
        const name = project.projectCustomName?.trim() || project.projectDisplayName;
        projects.set(project.projectId, name);
        if (project.projectKey) projects.set(project.projectKey, name);
      }
      return { entries, workspaces, projects };
    },
  });
}
