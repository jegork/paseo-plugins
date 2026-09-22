import type { PluginHostProps } from "@getpaseo/plugin/client";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { GroupBy, Section } from "../shared/grouping";
import { scopeLabel } from "../shared/grouping";
import {
  containerActionRpc,
  preferences,
  runtimeSnapshotRpc,
  signalProcessRpc,
  type Container,
  type Listener,
  type RuntimeSnapshot,
} from "../shared/runtime";

export const REFRESH_MS = 5_000;
const SNAPSHOT_KEY = ["runtime-radar", "snapshot"];

export function useRuntimeSnapshot() {
  const snapshot = useRpc(runtimeSnapshotRpc);
  return useQuery({
    queryKey: SNAPSHOT_KEY,
    queryFn: () => snapshot({}),
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

/** The saved grouping and whether stop/kill are offered; defaults until the host answers. */
export function useDisplayPreferences() {
  const settings = useSettings(preferences);
  const values = settings.status === "ready" ? settings.values : { groupBy: "workspace" as GroupBy, allowActions: true };
  async function setGroupBy(groupBy: GroupBy) {
    if (settings.status !== "ready") return;
    await settings.save({ ...settings.values, groupBy }, settings.revision);
  }
  return { ...values, setGroupBy, settings };
}

export function useStyles(theme: PluginHostProps["theme"], compact: boolean) {
  return useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding: compact ? 12 : 20, gap: compact ? 12 : 16 },
      toolbar: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12, flexWrap: "wrap" as const },
      title: { color: theme.colors.foreground, fontSize: compact ? 18 : 22, fontWeight: "600" as const, flex: 1 },
      muted: { color: theme.colors.foregroundMuted, fontSize: 12 },
      action: { color: theme.colors.accent, fontSize: 13 },
      segment: { flexDirection: "row" as const, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, overflow: "hidden" as const },
      segmentItem: { paddingHorizontal: 10, paddingVertical: 5 },
      segmentOn: { backgroundColor: theme.colors.accent },
      segmentText: { color: theme.colors.foreground, fontSize: 12 },
      segmentTextOn: { color: theme.colors.accentForeground, fontSize: 12 },
      section: { gap: 6 },
      heading: { color: theme.colors.foreground, fontSize: 14, fontWeight: "600" as const },
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 10,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 10,
        backgroundColor: theme.colors.surface1,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      port: { color: theme.colors.foreground, fontFamily: "monospace", fontSize: 13, minWidth: 56 },
      name: { color: theme.colors.foreground, fontSize: 13, flexShrink: 1 },
      detail: { color: theme.colors.foregroundMuted, fontSize: 12, flexShrink: 1, flex: 1 },
      scope: { color: theme.colors.accent, fontSize: 12 },
      dot: { width: 8, height: 8, borderRadius: 4 },
      empty: { color: theme.colors.foregroundMuted, fontSize: 13, paddingVertical: 4 },
      error: { color: theme.colors.statusWarning, fontSize: 12 },
      menuButton: { padding: 4 },
      modalText: { color: theme.colors.foreground, fontSize: 14, lineHeight: 20 },
      modalButtons: { flexDirection: "row" as const, justifyContent: "flex-end" as const, gap: 20, paddingTop: 8 },
      danger: { color: theme.colors.statusDanger, fontSize: 14, fontWeight: "600" as const },
      modalAction: { color: theme.colors.accent, fontSize: 14 },
    }),
    [theme, compact],
  );
}

export type Styles = ReturnType<typeof useStyles>;

type PendingAction =
  | { kind: "signal"; listener: Listener; signal: "TERM" | "KILL" }
  | { kind: "container"; container: Container; action: "stop" | "restart" };

function describe(action: PendingAction): { title: string; body: string; verb: string; destructive: boolean } {
  if (action.kind === "signal") {
    const target = `${action.listener.command} (pid ${action.listener.pid}) on :${action.listener.port}`;
    return action.signal === "KILL"
      ? { title: "Force kill", body: `Send SIGKILL to ${target}? It gets no chance to clean up.`, verb: "Kill", destructive: true }
      : { title: "Stop process", body: `Send SIGTERM to ${target}?`, verb: "Stop", destructive: true };
  }
  const target = `${action.container.name} (${action.container.image})`;
  return action.action === "stop"
    ? { title: "Stop container", body: `docker stop ${target}?`, verb: "Stop", destructive: true }
    : { title: "Restart container", body: `docker restart ${target}?`, verb: "Restart", destructive: false };
}

/** Confirm-then-run for stop, kill, stop container, restart container. */
export function useActions() {
  const signal = useRpc(signalProcessRpc);
  const container = useRpc(containerActionRpc);
  const toast = useToast();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const mutation = useMutation({
    mutationFn: async (action: PendingAction) =>
      action.kind === "signal"
        ? signal({ pid: action.listener.pid, signal: action.signal })
        : container({ id: action.container.id, action: action.action }),
    onSuccess: (result) => {
      if (result.ok) toast.show(result.message, { variant: "success" });
      else toast.error(result.message);
      void queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });
  return {
    pending,
    request: setPending,
    cancel: () => setPending(null),
    confirm: () => {
      if (pending) mutation.mutate(pending);
      setPending(null);
    },
    busy: mutation.isPending,
  };
}

export type Actions = ReturnType<typeof useActions>;

export function ConfirmModal({ actions, styles, theme }: { actions: Actions; styles: Styles; theme: PluginHostProps["theme"] }) {
  const text = actions.pending ? describe(actions.pending) : null;
  return (
    <Modal
      title={text?.title ?? ""}
      icon={<Icon name="TriangleAlert" size={18} color={theme.colors.statusWarning} />}
      open={actions.pending !== null}
      onOpenChange={(open) => {
        if (!open) actions.cancel();
      }}
    >
      <Modal.Content>
        <Text style={styles.modalText}>{text?.body ?? ""}</Text>
        <View style={styles.modalButtons}>
          <Pressable accessibilityRole="button" onPress={actions.cancel}>
            <Text style={styles.modalAction}>Cancel</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={actions.confirm}>
            <Text style={text?.destructive ? styles.danger : styles.modalAction}>{text?.verb ?? ""}</Text>
          </Pressable>
        </View>
      </Modal.Content>
    </Modal>
  );
}

function RowMenu({ items, styles, theme }: { items: { label: string; onPress: () => void; destructive?: boolean }[]; styles: Styles; theme: PluginHostProps["theme"] }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      {open
        ? items.map((item) => (
            <Pressable
              key={item.label}
              accessibilityRole="button"
              onPress={() => {
                setOpen(false);
                item.onPress();
              }}
            >
              <Text style={item.destructive ? styles.danger : styles.action}>{item.label}</Text>
            </Pressable>
          ))
        : null}
      <Pressable accessibilityRole="button" accessibilityLabel={open ? "Hide actions" : "Show actions"} onPress={() => setOpen((v) => !v)} style={styles.menuButton}>
        <Icon name={open ? "X" : "Ellipsis"} size={16} color={theme.colors.foregroundMuted} />
      </Pressable>
    </View>
  );
}

function ListenerRow({ listener, styles, theme, showCwd, scope, actions }: { listener: Listener; styles: Styles; theme: PluginHostProps["theme"]; showCwd: boolean; scope: string | null; actions: Actions | null }) {
  return (
    <View style={styles.row}>
      <Icon name="Radio" size={14} color={theme.colors.accent} />
      <Text style={styles.port}>{`:${listener.port}`}</Text>
      <Text style={styles.name} numberOfLines={1}>
        {listener.command}
      </Text>
      {scope !== null ? <Text style={styles.scope}>{scope}</Text> : null}
      <Text style={styles.detail} numberOfLines={1}>
        {`pid ${listener.pid}${listener.address !== "*" ? ` · ${listener.address}` : ""}${showCwd && listener.cwd !== null ? ` · ${listener.cwd}` : ""}`}
      </Text>
      {actions ? (
        <RowMenu
          styles={styles}
          theme={theme}
          items={[
            { label: "Stop", destructive: true, onPress: () => actions.request({ kind: "signal", listener, signal: "TERM" }) },
            { label: "Force kill", destructive: true, onPress: () => actions.request({ kind: "signal", listener, signal: "KILL" }) },
          ]}
        />
      ) : null}
    </View>
  );
}

function ContainerRow({ container, styles, theme, scope, actions }: { container: Container; styles: Styles; theme: PluginHostProps["theme"]; scope: string | null; actions: Actions | null }) {
  const up = container.status.startsWith("Up");
  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: up ? theme.colors.statusSuccess : theme.colors.statusWarning }]} />
      <Text style={styles.name} numberOfLines={1}>
        {container.name}
      </Text>
      {scope !== null ? <Text style={styles.scope}>{scope}</Text> : null}
      <Text style={styles.detail} numberOfLines={1}>
        {[container.image, container.status, ...container.ports].join(" · ")}
      </Text>
      {actions ? (
        <RowMenu
          styles={styles}
          theme={theme}
          items={[
            { label: "Restart", onPress: () => actions.request({ kind: "container", container, action: "restart" }) },
            { label: "Stop", destructive: true, onPress: () => actions.request({ kind: "container", container, action: "stop" }) },
          ]}
        />
      ) : null}
    </View>
  );
}

export function SectionView({ section, snapshot, styles, theme, showCwd, showScope, actions, onOpen }: { section: Section; snapshot: RuntimeSnapshot; styles: Styles; theme: PluginHostProps["theme"]; showCwd: boolean; showScope: boolean; actions: Actions | null; onOpen?: (workspaceId: string) => void }) {
  const heading = (
    <>
      <Text style={styles.heading}>{`${section.title} · ${section.listeners.length} ports · ${section.containers.length} containers`}</Text>
      {section.subtitle !== null ? (
        <Text style={styles.muted} numberOfLines={1}>
          {section.subtitle}
        </Text>
      ) : null}
    </>
  );
  return (
    <View style={styles.section}>
      {section.workspaceId !== null && onOpen ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Open workspace ${section.title}`} onPress={() => onOpen(section.workspaceId as string)}>
          {heading}
        </Pressable>
      ) : (
        <View>{heading}</View>
      )}
      {section.listeners.map((listener) => (
        <ListenerRow key={`${listener.pid}-${listener.address}-${listener.port}`} listener={listener} styles={styles} theme={theme} showCwd={showCwd} scope={showScope ? scopeLabel(listener, snapshot) : null} actions={actions} />
      ))}
      {section.containers.map((container) => (
        <ContainerRow key={container.id} container={container} styles={styles} theme={theme} scope={showScope ? scopeLabel(container, snapshot) : null} actions={actions} />
      ))}
    </View>
  );
}

const GROUPS: { value: GroupBy; label: string }[] = [
  { value: "workspace", label: "Workspace" },
  { value: "project", label: "Project" },
  { value: "kind", label: "Kind" },
];

export function Toolbar({ title, snapshot, refetch, fetching, styles, groupBy, onGroupBy }: { title: string; snapshot: RuntimeSnapshot | undefined; refetch: () => void; fetching: boolean; styles: Styles; groupBy: GroupBy; onGroupBy: (value: GroupBy) => void }) {
  return (
    <View style={styles.toolbar}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.segment}>
        {GROUPS.map((group) => {
          const on = group.value === groupBy;
          return (
            <Pressable key={group.value} accessibilityRole="button" accessibilityLabel={`Group by ${group.label}`} onPress={() => onGroupBy(group.value)} style={[styles.segmentItem, on ? styles.segmentOn : null]}>
              <Text style={on ? styles.segmentTextOn : styles.segmentText}>{group.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.muted}>{snapshot ? new Date(snapshot.takenAt).toLocaleTimeString() : "…"}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Refresh" onPress={refetch} disabled={fetching}>
        <Text style={styles.action}>{fetching ? "Refreshing" : "Refresh"}</Text>
      </Pressable>
    </View>
  );
}

export function Errors({ errors, styles }: { errors: string[]; styles: Styles }) {
  return errors.length === 0 ? null : (
    <View>
      {errors.map((error) => (
        <Text key={error} style={styles.error}>
          {error}
        </Text>
      ))}
    </View>
  );
}

export { ScrollView };
