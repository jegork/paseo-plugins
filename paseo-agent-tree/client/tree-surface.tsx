import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { usePaseo, useSettings } from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { DEFAULT_TREE_SETTINGS, treeSettings } from "../shared/settings";
import { buildTree, countByBucket, sweepableAgentIds, type Bucket } from "../shared/tree";
import { AgentRow, type RowOptions } from "./agent-row";
import { useDirectory } from "./use-directory";

const CHIPS: readonly { id: Bucket | null; label: string; key: Bucket | "all" }[] = [
  { id: null, label: "All", key: "all" },
  { id: "attention", label: "Attention", key: "attention" },
  { id: "running", label: "Running", key: "running" },
  { id: "idle", label: "Idle", key: "idle" },
  { id: "closed", label: "Closed", key: "closed" },
];

function toggle(keys: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(keys);
  if (!next.delete(key)) next.add(key);
  return next;
}

export interface TreeSurfaceProps extends PluginSurfaceProps {
  readonly onOpenSettings: () => void;
}

export function TreeSurface({ theme, layout, navigation, host, onOpenSettings }: TreeSurfaceProps) {
  const paseo = usePaseo();
  const queryClient = useQueryClient();
  const settings = useSettings(treeSettings);
  const values = settings.status === "ready" ? settings.values : DEFAULT_TREE_SETTINGS;

  const [query, setQuery] = useState("");
  const [bucket, setBucket] = useState<Bucket | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [armedAgentId, setArmedAgentId] = useState<string | null>(null);
  const [sweepArmed, setSweepArmed] = useState(false);
  const { data, error, isPending, isFetching, refetch } = useDirectory();

  const entries = useMemo(() => data?.entries ?? [], [data]);
  const tree = useMemo(
    () =>
      buildTree(entries, {
        query,
        bucket,
        hideClosed: values.hideClosed,
        workspaces: data?.workspaces,
        projects: data?.projects,
      }),
    [entries, query, bucket, values.hideClosed, data],
  );
  const totals = useMemo(() => countByBucket(entries), [entries]);
  const now = Date.now();
  const sweepAgeDays = Number(values.sweepAgeDays);
  const sweepable = sweepableAgentIds(entries, { now, minAgeDays: sweepAgeDays });
  const compact = layout.compact;
  const openAgent = navigation?.openAgent;
  const onOpen = useMemo(
    () => (openAgent === undefined ? undefined : (agentId: string) => openAgent({ agentId })),
    [openAgent],
  );

  const archive = useMutation({
    async mutationFn(agentIds: readonly string[]) {
      for (const agentId of agentIds) await paseo.agents.ref(agentId).archive();
    },
    onSettled() {
      setArmedAgentId(null);
      setSweepArmed(false);
      void queryClient.invalidateQueries({ queryKey: ["agent-tree", "directory"] });
    },
  });

  const rowOptions: RowOptions = {
    showModel: values.showModel,
    showLastError: values.showLastError,
    compact,
    dense: values.density === "compact",
  };

  function onArchive(agentId: string) {
    if (armedAgentId === agentId) archive.mutate([agentId]);
    else setArmedAgentId(agentId);
  }

  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      header: {
        padding: compact ? 12 : 16,
        gap: 10,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      titleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12 },
      title: { flex: 1, fontSize: 12, color: theme.colors.foregroundMuted },
      search: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingHorizontal: 10,
        paddingVertical: compact ? 8 : 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
      },
      input: { flex: 1, fontSize: 13, color: theme.colors.foreground, padding: 0 },
      chips: { flexDirection: "row" as const, gap: 8, alignItems: "center" as const, flexWrap: "wrap" as const },
      projectHeader: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingHorizontal: 12,
        paddingTop: 14,
        paddingBottom: 4,
      },
      projectName: { fontSize: 13, fontWeight: "600" as const, color: theme.colors.foreground },
      workspaceHeader: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingLeft: 18,
        paddingRight: 12,
        paddingVertical: 4,
      },
      workspaceName: { fontSize: 12, color: theme.colors.foregroundMuted },
      count: { fontSize: 11, color: theme.colors.foregroundMuted },
      empty: { padding: 24, gap: 6 },
      emptyTitle: { fontSize: 13, color: theme.colors.foreground },
      emptyHint: { fontSize: 12, color: theme.colors.foregroundMuted },
      danger: { fontSize: 12, color: theme.colors.statusDanger },
    }),
    [theme, compact],
  );

  function diffStat(additions: number, deletions: number) {
    if (!values.showDiffStats || (additions === 0 && deletions === 0)) return null;
    return (
      <View style={{ flexDirection: "row", gap: 6 }}>
        <Text style={{ fontSize: 11, color: theme.colors.statusSuccess }}>
          {`+${additions.toLocaleString()}`}
        </Text>
        <Text style={{ fontSize: 11, color: theme.colors.statusDanger }}>
          {`-${deletions.toLocaleString()}`}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{`${totals.all} agents on ${host.label}`}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh agents"
            disabled={isFetching}
            onPress={() => void refetch()}
          >
            <Icon
              name="RefreshCw"
              size={14}
              color={isFetching ? theme.colors.border : theme.colors.foregroundMuted}
            />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Tree settings" onPress={onOpenSettings}>
            <Icon name="Settings" size={14} color={theme.colors.foregroundMuted} />
          </Pressable>
        </View>
        <View style={styles.search}>
          <Icon name="Search" size={14} color={theme.colors.foregroundMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Filter by title, project, path, model"
            placeholderTextColor={theme.colors.foregroundMuted}
            accessibilityLabel="Filter agents"
            style={styles.input}
          />
          {query === "" ? null : (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear filter" onPress={() => setQuery("")}>
              <Icon name="X" size={14} color={theme.colors.foregroundMuted} />
            </Pressable>
          )}
        </View>
        <View style={styles.chips}>
          {CHIPS.map((entry) => {
            const selected = bucket === entry.id;
            return (
              <Pressable
                key={entry.key}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${entry.label}, ${totals[entry.key]} agents`}
                onPress={() => setBucket(entry.id)}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: selected ? theme.colors.accent : theme.colors.border,
                  backgroundColor: selected ? theme.colors.accent : "transparent",
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    color: selected ? theme.colors.accentForeground : theme.colors.foregroundMuted,
                  }}
                >
                  {`${entry.label} ${totals[entry.key]}`}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {sweepable.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              sweepArmed
                ? `Confirm archiving ${sweepable.length} closed agents`
                : `Archive ${sweepable.length} agents closed for more than ${sweepAgeDays} days`
            }
            disabled={archive.isPending}
            onPress={() => {
              if (sweepArmed) archive.mutate(sweepable);
              else setSweepArmed(true);
            }}
            style={{
              alignSelf: "flex-start",
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: theme.colors.statusDanger,
            }}
          >
            <Text style={{ fontSize: 12, color: theme.colors.statusDanger }}>
              {sweepArmed
                ? `Confirm: archive ${sweepable.length}`
                : `Archive ${sweepable.length} closed over ${sweepAgeDays}d`}
            </Text>
          </Pressable>
        ) : null}
        {archive.error !== null ? <Text style={styles.danger}>{archive.error.message}</Text> : null}
        {onOpen === undefined ? (
          <Text style={styles.emptyHint}>This client cannot open agents from a plugin.</Text>
        ) : null}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
        {error !== null ? (
          <View style={styles.empty}>
            <Text style={styles.danger}>{error instanceof Error ? error.message : String(error)}</Text>
          </View>
        ) : null}
        {error === null && tree.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{isPending ? "Loading agents" : "No agents match"}</Text>
            {isPending ? null : (
              <Text style={styles.emptyHint}>{`Clear the filter to see all ${totals.all}.`}</Text>
            )}
          </View>
        ) : null}

        {tree.map((project) => {
          const projectCollapsed = collapsed.has(project.key);
          return (
            <View key={project.key}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${projectCollapsed ? "Expand" : "Collapse"} ${project.name}`}
                onPress={() => setCollapsed((keys) => toggle(keys, project.key))}
                style={styles.projectHeader}
              >
                <Icon
                  name={projectCollapsed ? "ChevronRight" : "ChevronDown"}
                  size={14}
                  color={theme.colors.foregroundMuted}
                />
                <Text style={styles.projectName} numberOfLines={1}>
                  {project.name}
                </Text>
                <Text style={styles.count}>{project.count}</Text>
              </Pressable>
              {projectCollapsed
                ? null
                : project.workspaces.map((workspace) => {
                    const key = `${project.key}/${workspace.key}`;
                    const workspaceCollapsed = collapsed.has(key);
                    return (
                      <View key={key}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${workspaceCollapsed ? "Expand" : "Collapse"} ${workspace.name}`}
                          onPress={() => setCollapsed((keys) => toggle(keys, key))}
                          style={styles.workspaceHeader}
                        >
                          <Icon
                            name={workspaceCollapsed ? "ChevronRight" : "ChevronDown"}
                            size={12}
                            color={theme.colors.foregroundMuted}
                          />
                          {workspace.pinned ? (
                            <Icon name="Pin" size={11} color={theme.colors.foregroundMuted} />
                          ) : null}
                          <Text style={[styles.workspaceName, { flexShrink: 1 }]} numberOfLines={1}>
                            {workspace.name}
                          </Text>
                          {workspace.branch === null ? null : (
                            <Text style={styles.count} numberOfLines={1}>
                              {workspace.branch}
                            </Text>
                          )}
                          <View style={{ flex: 1 }} />
                          {diffStat(workspace.additions, workspace.deletions)}
                          <Text style={styles.count}>{workspace.count}</Text>
                        </Pressable>
                        {workspaceCollapsed
                          ? null
                          : workspace.nodes.map((node) => (
                              <AgentRow
                                key={node.id}
                                node={node}
                                depth={1}
                                theme={theme}
                                options={rowOptions}
                                now={now}
                                workspaceKey={workspace.key}
                                collapsed={collapsed}
                                armedAgentId={armedAgentId}
                                onToggle={(agentId) => setCollapsed((keys) => toggle(keys, agentId))}
                                onArchive={onArchive}
                                onOpen={onOpen}
                              />
                            ))}
                      </View>
                    );
                  })}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
