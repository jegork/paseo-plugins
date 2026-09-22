import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { groupSnapshot, type Section } from "../shared/grouping";
import { ConfirmModal, Errors, ScrollView, SectionView, Toolbar, useActions, useDisplayPreferences, useRuntimeSnapshot, useStyles } from "./runtime-list";

/** This workspace first, then the rest of the machine grouped by the saved preference. */
export function RuntimePanel({ theme, layout, workspaceId, navigation }: PluginWorkspacePanelProps) {
  const styles = useStyles(theme, layout.compact);
  const query = useRuntimeSnapshot();
  const prefs = useDisplayPreferences();
  const actions = useActions();
  const snapshot = query.data;
  const mine: Section | null = snapshot
    ? {
        key: "mine",
        title: "This workspace",
        subtitle: null,
        listeners: snapshot.listeners.filter((l) => l.workspaceId === workspaceId),
        containers: snapshot.containers.filter((c) => c.workspaceId === workspaceId),
        workspaceId: null,
      }
    : null;
  const rest = snapshot
    ? groupSnapshot(
        {
          ...snapshot,
          listeners: snapshot.listeners.filter((l) => l.workspaceId !== workspaceId),
          containers: snapshot.containers.filter((c) => c.workspaceId !== workspaceId),
        },
        prefs.groupBy,
      )
    : [];
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Toolbar title="Runtime" snapshot={snapshot} refetch={() => void query.refetch()} fetching={query.isFetching} styles={styles} groupBy={prefs.groupBy} onGroupBy={(value) => void prefs.setGroupBy(value)} />
      <Errors errors={snapshot?.errors ?? []} styles={styles} />
      {snapshot && mine ? <SectionView section={mine} snapshot={snapshot} styles={styles} theme={theme} showCwd={false} showScope={false} actions={prefs.allowActions ? actions : null} /> : null}
      {snapshot
        ? rest.map((section) => (
            <SectionView
              key={section.key}
              section={section}
              snapshot={snapshot}
              styles={styles}
              theme={theme}
              showCwd={section.key === "unassigned"}
              showScope={prefs.groupBy === "kind"}
              actions={prefs.allowActions ? actions : null}
              onOpen={navigation ? (id) => navigation.openWorkspace({ workspaceId: id }) : undefined}
            />
          ))
        : null}
      <ConfirmModal actions={actions} styles={styles} theme={theme} />
    </ScrollView>
  );
}
