import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Text } from "react-native";
import { groupSnapshot } from "../shared/grouping";
import { ConfirmModal, Errors, ScrollView, SectionView, Toolbar, useActions, useDisplayPreferences, useRuntimeSnapshot, useStyles } from "./runtime-list";

/** Everything on the machine, grouped the way the host's saved preference says. */
export function RuntimeSurface({ theme, layout, navigation }: PluginSurfaceProps) {
  const styles = useStyles(theme, layout.compact);
  const query = useRuntimeSnapshot();
  const prefs = useDisplayPreferences();
  const actions = useActions();
  const snapshot = query.data;
  const sections = snapshot ? groupSnapshot(snapshot, prefs.groupBy) : [];
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Toolbar title="Runtime radar" snapshot={snapshot} refetch={() => void query.refetch()} fetching={query.isFetching} styles={styles} groupBy={prefs.groupBy} onGroupBy={(value) => void prefs.setGroupBy(value)} />
      <Errors errors={snapshot?.errors ?? []} styles={styles} />
      {snapshot && sections.length === 0 ? <Text style={styles.empty}>Nothing is listening and no container is running.</Text> : null}
      {snapshot
        ? sections.map((section) => (
            <SectionView
              key={section.key}
              section={section}
              snapshot={snapshot}
              styles={styles}
              theme={theme}
              showCwd={section.key === "unassigned"}
              showScope={prefs.groupBy === "kind"}
              actions={prefs.allowActions ? actions : null}
              onOpen={navigation ? (workspaceId) => navigation.openWorkspace({ workspaceId }) : undefined}
            />
          ))
        : null}
      <ConfirmModal actions={actions} styles={styles} theme={theme} />
    </ScrollView>
  );
}
