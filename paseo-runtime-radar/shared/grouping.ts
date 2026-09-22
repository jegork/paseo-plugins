import type { Container, Listener, RuntimeSnapshot } from "./runtime";

export type GroupBy = "workspace" | "project" | "kind";

export type Section = {
  key: string;
  title: string;
  subtitle: string | null;
  listeners: Listener[];
  containers: Container[];
  /** set when the section is one workspace, so the row can open it */
  workspaceId: string | null;
};

const UNASSIGNED = "Not attached to any project";

function nonEmpty(section: Section): boolean {
  return section.listeners.length > 0 || section.containers.length > 0;
}

/**
 * Buckets a snapshot for display. `workspace` shows open workspaces, then
 * projects whose checkout has processes but no open workspace, then the
 * rest. `project` folds a project's workspaces into one bucket. `kind` is
 * two flat lists, ports then containers, for scanning by port number.
 */
export function groupSnapshot(snapshot: RuntimeSnapshot, groupBy: GroupBy): Section[] {
  const { listeners, containers, workspaces, projects } = snapshot;
  if (groupBy === "kind") {
    return [
      { key: "ports", title: "Ports", subtitle: null, listeners, containers: [], workspaceId: null },
      { key: "containers", title: "Containers", subtitle: null, listeners: [], containers, workspaceId: null },
    ].filter(nonEmpty);
  }
  const sections: Section[] = [];
  if (groupBy === "workspace") {
    for (const workspace of workspaces) {
      sections.push({
        key: `ws:${workspace.id}`,
        title: workspace.name,
        subtitle: workspace.directory,
        listeners: listeners.filter((l) => l.workspaceId === workspace.id),
        containers: containers.filter((c) => c.workspaceId === workspace.id),
        workspaceId: workspace.id,
      });
    }
    for (const project of projects) {
      sections.push({
        key: `proj:${project.id}`,
        title: `${project.name} · no open workspace`,
        subtitle: project.rootPath,
        listeners: listeners.filter((l) => l.workspaceId === null && l.projectId === project.id),
        containers: containers.filter((c) => c.workspaceId === null && c.projectId === project.id),
        workspaceId: null,
      });
    }
  } else {
    for (const project of projects) {
      sections.push({
        key: `proj:${project.id}`,
        title: project.name,
        subtitle: project.rootPath,
        listeners: listeners.filter((l) => l.projectId === project.id),
        containers: containers.filter((c) => c.projectId === project.id),
        workspaceId: null,
      });
    }
  }
  sections.push({
    key: "unassigned",
    title: UNASSIGNED,
    subtitle: null,
    listeners: listeners.filter((l) => l.projectId === null && l.workspaceId === null),
    containers: containers.filter((c) => c.projectId === null && c.workspaceId === null),
    workspaceId: null,
  });
  return sections.filter(nonEmpty);
}

/** Name of the scope a row belongs to, for the flat `kind` view. */
export function scopeLabel(item: { workspaceId: string | null; projectId: string | null }, snapshot: RuntimeSnapshot): string | null {
  const workspace = snapshot.workspaces.find((w) => w.id === item.workspaceId);
  if (workspace) return workspace.name;
  const project = snapshot.projects.find((p) => p.id === item.projectId);
  return project ? project.name : null;
}
