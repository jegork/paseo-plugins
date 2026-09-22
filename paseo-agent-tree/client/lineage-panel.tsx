import type { PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import {
  agentTitle,
  bucketOf,
  formatAge,
  parentAgentId,
  stateLabel,
  waitingSince,
  type AgentEntry,
} from "../shared/tree";
import { useDirectory } from "./use-directory";

/** The parent chain above this agent, oldest first, stopping at a cycle or a missing parent. */
function ancestors(agentId: string, byId: ReadonlyMap<string, AgentEntry>): AgentEntry[] {
  const chain: AgentEntry[] = [];
  const seen = new Set<string>([agentId]);
  let current = parentAgentId(byId.get(agentId)?.agent.labels);
  while (current !== null && !seen.has(current)) {
    const entry = byId.get(current);
    if (entry === undefined) break;
    chain.unshift(entry);
    seen.add(current);
    current = parentAgentId(entry.agent.labels);
  }
  return chain;
}

export function LineagePanel({ theme, layout, navigation, agentId }: PluginAgentPanelProps) {
  const { data, isPending } = useDirectory();
  const byId = useMemo(
    () => new Map((data?.entries ?? []).map((entry) => [entry.agent.id, entry] as const)),
    [data],
  );
  const chain = useMemo(() => ancestors(agentId, byId), [agentId, byId]);
  const children = useMemo(
    () => (data?.entries ?? []).filter((entry) => parentAgentId(entry.agent.labels) === agentId),
    [data, agentId],
  );
  const now = Date.now();
  const openAgent = navigation?.openAgent;

  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      body: { padding: layout.compact ? 12 : 16, gap: 14 },
      heading: { fontSize: 12, color: theme.colors.foregroundMuted },
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      title: { flex: 1, fontSize: 13, color: theme.colors.foreground },
      meta: { fontSize: 11, color: theme.colors.foregroundMuted },
    }),
    [theme, layout.compact],
  );

  function row(entry: AgentEntry, depth: number) {
    const state = stateLabel(entry.agent);
    const age = formatAge(waitingSince(entry.agent), now);
    return (
      <Pressable
        key={entry.agent.id}
        accessibilityRole="button"
        accessibilityLabel={`Open agent ${agentTitle(entry.agent)}`}
        disabled={openAgent === undefined}
        onPress={() => openAgent?.({ agentId: entry.agent.id })}
        style={[styles.row, { marginLeft: depth * 14 }]}
      >
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor:
              bucketOf(entry.agent) === "attention"
                ? theme.colors.statusWarning
                : theme.colors.foregroundMuted,
          }}
        />
        <Text style={styles.title} numberOfLines={1}>
          {agentTitle(entry.agent)}
        </Text>
        <Text style={styles.meta}>{age === "" ? state : `${state} · ${age}`}</Text>
        <Icon name="ArrowUpRight" size={13} color={theme.colors.foregroundMuted} />
      </Pressable>
    );
  }

  const self = byId.get(agentId);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.body}>
        {isPending ? <Text style={styles.meta}>Loading lineage</Text> : null}
        {!isPending && chain.length === 0 && children.length === 0 ? (
          <Text style={styles.meta}>This agent was not handed off and has no subagents.</Text>
        ) : null}
        {chain.length > 0 ? (
          <View style={{ gap: 6 }}>
            <Text style={styles.heading}>Handed off from</Text>
            {chain.map((entry, index) => row(entry, index))}
            {self === undefined ? null : (
              <View style={[styles.row, { marginLeft: chain.length * 14, opacity: 0.6 }]}>
                <Icon name="CornerDownRight" size={13} color={theme.colors.foregroundMuted} />
                <Text style={styles.title} numberOfLines={1}>
                  {agentTitle(self.agent)}
                </Text>
                <Text style={styles.meta}>this agent</Text>
              </View>
            )}
          </View>
        ) : null}
        {children.length > 0 ? (
          <View style={{ gap: 6 }}>
            <Text style={styles.heading}>{`Subagents (${children.length})`}</Text>
            {children.map((entry) => row(entry, 0))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
