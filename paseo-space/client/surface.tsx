import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Text } from "react-native";
import { sectionsByProject } from "../shared/space";
import { ConfirmModal, Errors, ScrollView, SectionView, Toolbar, maxEntryKb, useActions, useSpaceSnapshot, useStyles } from "./space-list";

/** every checkout on the machine, grouped by project, biggest first */
export function SpaceSurface({ theme, layout, navigation }: PluginSurfaceProps) {
  const styles = useStyles(theme, layout.compact);
  const { query, rescan } = useSpaceSnapshot();
  const actions = useActions();
  const snapshot = query.data;
  const sections = snapshot ? sectionsByProject(snapshot.entries) : [];
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Toolbar title="Space" snapshot={snapshot} styles={styles} rescan={() => rescan.mutate()} fetching={rescan.isPending || (query.isFetching && !snapshot)} />
      <Errors errors={[...(query.error ? [String(query.error)] : []), ...(snapshot?.errors ?? [])]} styles={styles} />
      {!snapshot && !query.error ? <Text style={styles.empty}>Measuring worktrees…</Text> : null}
      {snapshot && sections.length === 0 ? <Text style={styles.empty}>No projects or worktrees found.</Text> : null}
      {snapshot
        ? sections.map((section) => (
            <SectionView
              key={section.projectId}
              section={section}
              maxKb={maxEntryKb(snapshot)}
              styles={styles}
              theme={theme}
              actions={actions}
              onOpen={navigation ? (workspaceId) => navigation.openWorkspace({ workspaceId }) : undefined}
            />
          ))
        : null}
      <ConfirmModal actions={actions} styles={styles} theme={theme} />
    </ScrollView>
  );
}
