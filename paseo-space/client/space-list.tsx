import type { PluginHostProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  cacheKb,
  cleanRpc,
  formatKb,
  pruneRpc,
  removeWorktreeRpc,
  snapshotRpc,
  totals,
  type Entry,
  type Section,
  type Snapshot,
} from "../shared/space";

const SNAPSHOT_KEY = ["space", "snapshot"];
const REFRESH_MS = 60_000;

/** cached sizes every minute; `rescan` forces the daemon to walk the disk again */
export function useSpaceSnapshot() {
  const snapshot = useRpc(snapshotRpc);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: SNAPSHOT_KEY,
    queryFn: () => snapshot({ refresh: false }),
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });
  const rescan = useMutation({
    mutationFn: () => snapshot({ refresh: true }),
    onSuccess: (data) => queryClient.setQueryData(SNAPSHOT_KEY, data),
  });
  return { query, rescan };
}

export function useStyles(theme: PluginHostProps["theme"], compact: boolean) {
  return useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding: compact ? 12 : 20, gap: compact ? 12 : 16 },
      toolbar: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12, flexWrap: "wrap" as const },
      title: { color: theme.colors.foreground, fontSize: compact ? 18 : 22, fontWeight: "600" as const, flex: 1 },
      summary: { color: theme.colors.foregroundMuted, fontSize: 13 },
      muted: { color: theme.colors.foregroundMuted, fontSize: 12 },
      action: { color: theme.colors.accent, fontSize: 13 },
      section: { gap: 6 },
      headingRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, flexWrap: "wrap" as const },
      heading: { color: theme.colors.foreground, fontSize: 14, fontWeight: "600" as const, flex: 1 },
      row: {
        gap: 6,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 10,
        backgroundColor: theme.colors.surface1,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      rowTop: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
      name: { color: theme.colors.foreground, fontSize: 13, flexShrink: 1 },
      detail: { color: theme.colors.foregroundMuted, fontSize: 12, flexShrink: 1, flex: 1 },
      size: { color: theme.colors.foreground, fontFamily: "monospace", fontSize: 13, minWidth: 64, textAlign: "right" as const },
      badge: { fontSize: 11, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, overflow: "hidden" as const },
      badgeWarning: { color: theme.colors.accentForeground, backgroundColor: theme.colors.statusWarning },
      badgeMuted: { color: theme.colors.foregroundMuted, backgroundColor: theme.colors.surface2 },
      track: { height: 4, borderRadius: 2, backgroundColor: theme.colors.surface2, overflow: "hidden" as const },
      fill: { height: 4, backgroundColor: theme.colors.accent },
      fillCache: { height: 4, backgroundColor: theme.colors.statusWarning },
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
  | { kind: "clean"; entry: Entry }
  | { kind: "archive"; entry: Entry }
  | { kind: "remove"; entry: Entry; force: boolean }
  | { kind: "prune"; entry: Entry };

function describe(action: PendingAction): { title: string; body: string; verb: string } {
  const { entry } = action;
  switch (action.kind) {
    case "clean": {
      const names = entry.caches.map((cache) => cache.path.slice(entry.directory.length + 1)).join(", ");
      return { title: "Clear caches", body: `Delete ${names} in ${entry.name}? Frees about ${formatKb(cacheKb(entry))}. They come back on the next install or build.`, verb: "Delete" };
    }
    case "archive":
      return { title: "Archive workspace", body: `Archive ${entry.name}? Paseo closes its agents and removes the worktree at ${entry.directory}.`, verb: "Archive" };
    case "remove":
      return {
        title: action.force ? "Force remove worktree" : "Remove worktree",
        body: action.force ? `Remove ${entry.directory} even if it has uncommitted changes? They are lost.` : `Run git worktree remove on ${entry.directory}? Git refuses if it has uncommitted changes.`,
        verb: "Remove",
      };
    case "prune":
      return { title: "Prune stale entry", body: `Run git worktree prune in ${entry.projectName}? This forgets ${entry.directory}, whose directory is already gone.`, verb: "Prune" };
  }
}

/** confirm-then-run for the four destructive actions; archive goes through the Paseo SDK, the rest through plugin RPCs */
export function useActions() {
  const paseo = usePaseo();
  const clean = useRpc(cleanRpc);
  const remove = useRpc(removeWorktreeRpc);
  const prune = useRpc(pruneRpc);
  const toast = useToast();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const mutation = useMutation({
    mutationFn: async (action: PendingAction) => {
      const { entry } = action;
      switch (action.kind) {
        case "clean":
          return clean({ directory: entry.directory, paths: entry.caches.map((cache) => cache.path) });
        case "remove":
          return remove({ rootPath: entry.projectRootPath, directory: entry.directory, force: action.force });
        case "prune":
          return prune({ rootPath: entry.projectRootPath });
        case "archive": {
          const result = await paseo.workspaces.archive(entry.workspaceId as string);
          return result.error ? { ok: false, message: result.error } : { ok: true, message: `Archived ${entry.name}.` };
        }
      }
    },
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
            <Text style={styles.danger}>{text?.verb ?? ""}</Text>
          </Pressable>
        </View>
      </Modal.Content>
    </Modal>
  );
}

type MenuItem = { label: string; onPress: () => void; destructive?: boolean };

function RowMenu({ items, styles, theme }: { items: MenuItem[]; styles: Styles; theme: PluginHostProps["theme"] }) {
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
      <Pressable accessibilityRole="button" accessibilityLabel={open ? "Hide actions" : "Show actions"} onPress={() => setOpen((value) => !value)} style={styles.menuButton}>
        <Icon name={open ? "X" : "Ellipsis"} size={16} color={theme.colors.foregroundMuted} />
      </Pressable>
    </View>
  );
}

function menuFor(entry: Entry, actions: Actions, onOpen?: (workspaceId: string) => void): MenuItem[] {
  const items: MenuItem[] = [];
  if (entry.workspaceId !== null && onOpen) items.push({ label: "Open", onPress: () => onOpen(entry.workspaceId as string) });
  if (entry.caches.length > 0) items.push({ label: `Clear caches (${formatKb(cacheKb(entry))})`, destructive: true, onPress: () => actions.request({ kind: "clean", entry }) });
  if (entry.kind === "workspace") items.push({ label: "Archive", destructive: true, onPress: () => actions.request({ kind: "archive", entry }) });
  if (entry.kind === "orphan") {
    items.push({ label: "Remove worktree", destructive: true, onPress: () => actions.request({ kind: "remove", entry, force: false }) });
    items.push({ label: "Force remove", destructive: true, onPress: () => actions.request({ kind: "remove", entry, force: true }) });
  }
  if (entry.kind === "prunable") items.push({ label: "Prune", destructive: true, onPress: () => actions.request({ kind: "prune", entry }) });
  return items;
}

function relativeTime(iso: string | null): string | null {
  if (iso === null) return null;
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutes)) return null;
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / (60 * 24))}d ago`;
}

function EntryRow({ entry, maxKb, styles, theme, actions, onOpen }: { entry: Entry; maxKb: number; styles: Styles; theme: PluginHostProps["theme"]; actions: Actions | null; onOpen?: (workspaceId: string) => void }) {
  const caches = cacheKb(entry);
  const total = entry.totalKb ?? 0;
  const pct = maxKb > 0 ? (total / maxKb) * 100 : 0;
  const cachePct = total > 0 ? (caches / total) * 100 : 0;
  const icon = entry.kind === "main" ? "House" : entry.kind === "prunable" ? "Ghost" : "GitBranch";
  const details = [
    entry.branch,
    entry.dirty === true ? "uncommitted changes" : null,
    caches > 0 ? `${formatKb(caches)} caches` : null,
    relativeTime(entry.activityAt),
    entry.error,
  ].filter((part): part is string => part !== null);
  const body = (
    <View style={styles.rowTop}>
      <Icon name={icon} size={14} color={entry.dirty ? theme.colors.statusWarning : theme.colors.accent} />
      <Text style={styles.name} numberOfLines={1}>
        {entry.name}
      </Text>
      {entry.kind === "orphan" ? <Text style={[styles.badge, styles.badgeWarning]}>not in Paseo</Text> : null}
      {entry.kind === "prunable" ? <Text style={[styles.badge, styles.badgeMuted]}>directory gone</Text> : null}
      <Text style={styles.detail} numberOfLines={1}>
        {details.join(" · ")}
      </Text>
      <Text style={styles.size}>{entry.totalKb === null ? (entry.kind === "prunable" ? "" : "…") : formatKb(entry.totalKb)}</Text>
      {actions ? <RowMenu items={menuFor(entry, actions, onOpen)} styles={styles} theme={theme} /> : null}
    </View>
  );
  return (
    <View style={styles.row}>
      {entry.workspaceId !== null && onOpen ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Open workspace ${entry.name}`} onPress={() => onOpen(entry.workspaceId as string)}>
          {body}
        </Pressable>
      ) : (
        body
      )}
      {entry.kind !== "prunable" ? (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct}%` }]}>
            <View style={[styles.fillCache, { width: `${cachePct}%` }]} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function SectionView({ section, maxKb, styles, theme, actions, onOpen }: { section: Section; maxKb: number; styles: Styles; theme: PluginHostProps["theme"]; actions: Actions | null; onOpen?: (workspaceId: string) => void }) {
  return (
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <Text style={styles.heading} numberOfLines={1}>
          {section.title}
        </Text>
        <Text style={styles.muted}>{`${section.entries.length} ${section.entries.length === 1 ? "checkout" : "checkouts"} · ${formatKb(section.totalKb)}${section.cacheKb > 0 ? ` · ${formatKb(section.cacheKb)} caches` : ""}`}</Text>
      </View>
      {section.entries.map((entry) => (
        <EntryRow key={entry.directory} entry={entry} maxKb={maxKb} styles={styles} theme={theme} actions={actions} onOpen={onOpen} />
      ))}
    </View>
  );
}

export function Toolbar({ title, snapshot, styles, rescan, fetching }: { title: string; snapshot: Snapshot | undefined; styles: Styles; rescan: () => void; fetching: boolean }) {
  const sums = snapshot ? totals(snapshot.entries) : null;
  return (
    <View style={styles.toolbar}>
      <Text style={styles.title}>{title}</Text>
      {snapshot ? <Text style={styles.muted}>{new Date(snapshot.takenAt).toLocaleTimeString()}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Rescan disk usage" onPress={rescan} disabled={fetching}>
        <Text style={styles.action}>{fetching ? "Scanning…" : "Rescan"}</Text>
      </Pressable>
      {sums ? (
        <Text style={[styles.summary, { width: "100%" }]}>
          {[
            `${formatKb(sums.totalKb)} across ${sums.worktrees} ${sums.worktrees === 1 ? "worktree" : "worktrees"}`,
            sums.cacheKb > 0 ? `${formatKb(sums.cacheKb)} in caches` : null,
            sums.orphans > 0 ? `${sums.orphans} not tracked by Paseo` : null,
            snapshot?.disk ? `${formatKb(snapshot.disk.freeKb)} free of ${formatKb(snapshot.disk.totalKb)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      ) : null}
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

export function maxEntryKb(snapshot: Snapshot): number {
  return snapshot.entries.reduce((max, entry) => Math.max(max, entry.totalKb ?? 0), 0);
}

export { ScrollView };
