import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { agentTitle, parentAgentId, type AgentFields } from "../shared/tree";

const PILL_ID = "lineage";
const PAGE_LIMIT = 200;

/**
 * Marks a handed-off thread as a child: every agent carrying a parent label gets a
 * composer pill naming its parent, which opens the lineage panel.
 */
export function contributeLineage(client: PluginClientContext): () => void {
  const pills = new Map<string, PluginButtonRegistration>();
  const snapshots = new Map<string, AgentFields>();
  const childrenOf = new Map<string, Set<string>>();
  let disposed = false;

  function parentLabel(parentId: string): string {
    const parent = snapshots.get(parentId);
    return parent === undefined ? parentId.slice(0, 7) : agentTitle(parent);
  }

  function drop(agentId: string) {
    pills.get(agentId)?.remove();
    pills.delete(agentId);
  }

  function sync(agent: AgentFields) {
    const parentId = parentAgentId(agent.labels);
    const workspaceId = agent.workspaceId;
    if (parentId === null || workspaceId === undefined) {
      drop(agent.id);
      return;
    }
    const title = `Child of ${parentLabel(parentId)}`;
    const button = {
      title,
      label: title,
      icon: "CornerLeftUp",
      behavior: {
        kind: "action" as const,
        onPress() {
          client.openPanel(PILL_ID, { workspaceId, agentId: agent.id });
        },
      },
    };
    const existing = pills.get(agent.id);
    if (existing !== undefined) {
      existing.update(button);
      return;
    }
    pills.set(agent.id, client.addComposerPill({ id: PILL_ID, workspaceId, agentId: agent.id, button }));
  }

  function record(agent: AgentFields) {
    const previousParent = parentAgentId(snapshots.get(agent.id)?.labels);
    snapshots.set(agent.id, agent);
    const parentId = parentAgentId(agent.labels);
    if (previousParent !== null && previousParent !== parentId) {
      childrenOf.get(previousParent)?.delete(agent.id);
    }
    if (parentId !== null) {
      const siblings = childrenOf.get(parentId);
      if (siblings === undefined) childrenOf.set(parentId, new Set([agent.id]));
      else siblings.add(agent.id);
    }
    sync(agent);
    // this agent may itself be a parent whose children still show its short id
    for (const childId of childrenOf.get(agent.id) ?? []) {
      const child = snapshots.get(childId);
      if (child !== undefined) sync(child);
    }
  }

  void (async () => {
    try {
      const result = await client.paseo.agents.list({ page: { limit: PAGE_LIMIT } });
      if (disposed) return;
      for (const entry of result.entries) snapshots.set(entry.agent.id, entry.agent);
      for (const entry of result.entries) record(entry.agent);
    } catch {
      // the pills fill in from the update stream instead
    }
  })();

  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (update.kind === "remove") {
      drop(update.agentId);
      snapshots.delete(update.agentId);
      return;
    }
    record(update.agent);
  });

  return () => {
    disposed = true;
    unsubscribe();
    for (const pill of pills.values()) pill.remove();
    pills.clear();
  };
}
