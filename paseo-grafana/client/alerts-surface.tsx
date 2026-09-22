import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { FlatList, Icon, Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { INVESTIGATION_PROVIDER, investigationPrompt, listAlerts, type AlertInstance } from "../shared/grafana";
import { openExternal } from "./web";

function stateColor(state: string, colors: PluginSurfaceProps["theme"]["colors"]): string {
  if (/firing|alerting/i.test(state)) return colors.statusDanger;
  if (/pending/i.test(state)) return colors.statusWarning;
  if (/error|nodata/i.test(state)) return colors.foregroundMuted;
  return colors.statusSuccess;
}

interface WorkspaceChoice {
  id: string;
  name: string;
  directory: string;
}

export function AlertsSurface({ theme, layout, navigation }: PluginSurfaceProps) {
  const paseo = usePaseo();
  const toast = useToast();
  const fetchAlerts = useRpc(listAlerts);
  const fetchPrompt = useRpc(investigationPrompt);
  const [includeNormal, setIncludeNormal] = useState(false);
  const [target, setTarget] = useState<AlertInstance | null>(null);

  const alerts = useQuery({
    queryKey: ["grafana", "alerts", includeNormal],
    queryFn: () => fetchAlerts({ includeNormal }),
    refetchInterval: 60_000,
  });
  const workspaces = useQuery({
    queryKey: ["grafana", "workspaces"],
    queryFn: async (): Promise<WorkspaceChoice[]> => {
      const result = await paseo.workspaces.list();
      return result.entries
        .filter((workspace) => !workspace.archivingAt)
        .map((workspace) => ({
          id: workspace.id,
          name: workspace.title ?? workspace.name,
          directory: workspace.workspaceDirectory ?? workspace.projectRootPath,
        }));
    },
    enabled: target !== null,
  });
  const investigate = useMutation({
    mutationFn: async ({ alert, workspaceId }: { alert: AlertInstance; workspaceId: string }) => {
      const { prompt, ruleName } = await fetchPrompt({ query: alert.ruleUid });
      const agent = await paseo.workspaces.ref(workspaceId).agents.create({
        config: { provider: INVESTIGATION_PROVIDER },
        title: `Investigate: ${ruleName}`,
        prompt,
      });
      return agent;
    },
    onSuccess: (agent) => {
      setTarget(null);
      toast.show("Investigation started", { variant: "success" });
      navigation?.openAgent({ agentId: agent.id });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  const styles = useMemo(() => {
    const pad = layout.compact ? 12 : 20;
    return {
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding: pad, gap: 10 },
      row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      heading: { color: theme.colors.foreground, fontSize: layout.compact ? 18 : 22, fontWeight: "600" as const },
      muted: { color: theme.colors.foregroundMuted, fontSize: 13 },
      body: { color: theme.colors.foreground, fontSize: 14 },
      card: { backgroundColor: theme.colors.surface1, borderRadius: 10, padding: 12, gap: 6, borderWidth: 1, borderColor: theme.colors.border },
      chip: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.border },
      chipOn: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
      chipText: { color: theme.colors.foreground, fontSize: 12 },
      chipTextOn: { color: theme.colors.accentForeground, fontSize: 12 },
      action: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border },
      actionText: { color: theme.colors.foreground, fontSize: 13 },
      primary: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: theme.colors.accent },
      primaryText: { color: theme.colors.accentForeground, fontSize: 13, fontWeight: "600" as const },
      danger: { color: theme.colors.statusDanger, fontSize: 13 },
      workspaceRow: { paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.border, gap: 2 },
    };
  }, [theme, layout.compact]);

  const data = alerts.data;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.row}>
        <Icon name="BellRing" size={20} color={theme.colors.accent} />
        <Text style={styles.heading}>Grafana alerts</Text>
        <View style={{ flex: 1 }} />
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh" onPress={() => void alerts.refetch()}>
          <Icon name="RefreshCw" size={16} color={theme.colors.foregroundMuted} />
        </Pressable>
      </View>
      {data ? (
        <Text style={styles.muted} numberOfLines={1}>
          {data.context}
        </Text>
      ) : null}
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show only active alerts"
          style={[styles.chip, !includeNormal && styles.chipOn]}
          onPress={() => setIncludeNormal(false)}
        >
          <Text style={!includeNormal ? styles.chipTextOn : styles.chipText}>Active</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show all alert instances"
          style={[styles.chip, includeNormal && styles.chipOn]}
          onPress={() => setIncludeNormal(true)}
        >
          <Text style={includeNormal ? styles.chipTextOn : styles.chipText}>All</Text>
        </Pressable>
      </View>

      {alerts.isLoading ? <Text style={styles.muted}>Loading alerts…</Text> : null}
      {alerts.error ? (
        <Text style={styles.danger}>{alerts.error instanceof Error ? alerts.error.message : String(alerts.error)}</Text>
      ) : null}
      {data && data.items.length === 0 ? (
        <Text style={styles.muted}>{includeNormal ? "No alert instances." : "Nothing firing or pending."}</Text>
      ) : null}

      {data?.items.map((alert) => (
        <View key={`${alert.ruleUid}-${JSON.stringify(alert.labels)}`} style={styles.card}>
          <View style={styles.row}>
            <Icon name="Circle" size={10} color={stateColor(alert.state, theme.colors)} />
            <Text style={styles.body} numberOfLines={2}>
              {alert.ruleName}
            </Text>
          </View>
          <Text style={{ ...styles.muted, color: stateColor(alert.state, theme.colors) }}>
            {alert.state}
            {alert.activeAt ? ` · since ${alert.activeAt.slice(0, 16).replace("T", " ")}` : ""}
          </Text>
          <Text style={styles.muted} numberOfLines={1}>
            {alert.folder} / {alert.group}
          </Text>
          {alert.summary ? (
            <Text style={styles.body} numberOfLines={3}>
              {alert.summary}
            </Text>
          ) : null}
          <View style={styles.row}>
            <Pressable accessibilityRole="link" accessibilityLabel="Open in Grafana" style={styles.action} onPress={() => void openExternal(alert.url)}>
              <Text style={styles.actionText}>Open</Text>
            </Pressable>
            {alert.dashboardUrl ? (
              <Pressable accessibilityRole="link" accessibilityLabel="Open dashboard" style={styles.action} onPress={() => void openExternal(alert.dashboardUrl!)}>
                <Text style={styles.actionText}>Dashboard</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Investigate with an agent" style={styles.primary} onPress={() => setTarget(alert)}>
              <Text style={styles.primaryText}>Investigate</Text>
            </Pressable>
          </View>
        </View>
      ))}

      <Modal
        title={target ? `Investigate: ${target.ruleName}` : "Investigate"}
        icon={<Icon name="Search" size={18} color={theme.colors.foreground} />}
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
      >
        <Modal.Content scrollable={false} contentContainerStyle={{ padding: 0, gap: 0 }}>
          {workspaces.isLoading ? <Text style={{ ...styles.muted, padding: 16 }}>Loading workspaces…</Text> : null}
          <FlatList
            style={{ flex: 1, minHeight: 0 }}
            data={workspaces.data ?? []}
            keyExtractor={(item) => item.id}
            ListHeaderComponent={
              <Text style={{ ...styles.muted, padding: 16 }}>
                Pick the workspace whose agent should run the investigation.
              </Text>
            }
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Investigate in ${item.name}`}
                disabled={investigate.isPending}
                style={styles.workspaceRow}
                onPress={() => target && investigate.mutate({ alert: target, workspaceId: item.id })}
              >
                <Text style={styles.body}>{item.name}</Text>
                <Text style={styles.muted} numberOfLines={1}>
                  {item.directory}
                </Text>
              </Pressable>
            )}
          />
        </Modal.Content>
      </Modal>
    </ScrollView>
  );
}
