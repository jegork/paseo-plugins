import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Text } from "react-native";
import { sectionsByProject, type Section } from "../shared/space";
import { ConfirmModal, Errors, ScrollView, SectionView, Toolbar, maxEntryKb, useActions, useSpaceSnapshot, useStyles } from "./space-list";

/** this workspace's footprint first, then the rest of the machine */
export function SpacePanel({ theme, layout, workspaceId, navigation }: PluginWorkspacePanelProps) {
  const styles = useStyles(theme, layout.compact);
  const { query, rescan } = useSpaceSnapshot();
  const actions = useActions();
  const snapshot = query.data;
  const mineEntry = snapshot?.entries.find((entry) => entry.workspaceId === workspaceId) ?? null;
  const mine: Section | null = mineEntry
    ? { projectId: "mine", title: "This workspace", rootPath: mineEntry.projectRootPath, entries: [mineEntry], totalKb: mineEntry.totalKb ?? 0, cacheKb: 0 }
    : null;
  const rest = snapshot ? sectionsByProject(snapshot.entries.filter((entry) => entry.workspaceId !== workspaceId)) : [];
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Toolbar title="Space" snapshot={snapshot} styles={styles} rescan={() => rescan.mutate()} fetching={rescan.isPending || (query.isFetching && !snapshot)} />
      <Errors errors={[...(query.error ? [String(query.error)] : []), ...(snapshot?.errors ?? [])]} styles={styles} />
      {!snapshot && !query.error ? <Text style={styles.empty}>Measuring worktrees…</Text> : null}
      {snapshot && mine ? <SectionView section={mine} maxKb={maxEntryKb(snapshot)} styles={styles} theme={theme} actions={actions} /> : null}
      {snapshot
        ? rest.map((section) => (
            <SectionView
              key={section.projectId}
              section={section}
              maxKb={maxEntryKb(snapshot)}
              styles={styles}
              theme={theme}
              actions={actions}
              onOpen={navigation ? (id) => navigation.openWorkspace({ workspaceId: id }) : undefined}
            />
          ))
        : null}
      <ConfirmModal actions={actions} styles={styles} theme={theme} />
    </ScrollView>
  );
}
