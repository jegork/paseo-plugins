import type { PluginHostProps, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { impactReportRpc, type AffectedFile, type ChangedFile, type Dependent, type ImpactReport } from "../shared/codegraph";

const REFRESH_MS = 10_000;
const ROWS_PER_FILE = 6;
const FILES_PER_SECTION = 12;

function useStyles(theme: PluginHostProps["theme"], compact: boolean) {
  return useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding: compact ? 12 : 20, gap: compact ? 12 : 16 },
      toolbar: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12, flexWrap: "wrap" as const },
      title: { color: theme.colors.foreground, fontSize: compact ? 18 : 22, fontWeight: "600" as const, flex: 1 },
      muted: { color: theme.colors.foregroundMuted, fontSize: 12 },
      action: { color: theme.colors.accent, fontSize: 13 },
      section: { gap: 6 },
      heading: { color: theme.colors.foreground, fontSize: 14, fontWeight: "600" as const },
      group: { borderRadius: 10, backgroundColor: theme.colors.surface1, borderWidth: 1, borderColor: theme.colors.border, paddingVertical: 6, paddingHorizontal: 12, gap: 2 },
      groupHead: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, paddingVertical: 4 },
      path: { color: theme.colors.foreground, fontFamily: "monospace", fontSize: 13, flexShrink: 1, flex: 1 },
      count: { color: theme.colors.foregroundMuted, fontSize: 12 },
      row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, paddingVertical: 3, paddingLeft: 22, flexWrap: "wrap" as const },
      symbol: { color: theme.colors.foreground, fontFamily: "monospace", fontSize: 12 },
      detail: { color: theme.colors.foregroundMuted, fontSize: 12, flexShrink: 1 },
      via: { color: theme.colors.accent, fontSize: 12, flexShrink: 1 },
      more: { color: theme.colors.accent, fontSize: 12, paddingVertical: 4, paddingLeft: 22 },
      moreFiles: { color: theme.colors.accent, fontSize: 13, paddingVertical: 4 },
      empty: { color: theme.colors.foregroundMuted, fontSize: 13, paddingVertical: 4 },
      warning: { color: theme.colors.statusWarning, fontSize: 12 },
      code: { color: theme.colors.foreground, fontFamily: "monospace", fontSize: 13 },
      notice: { color: theme.colors.foreground, fontSize: 13, lineHeight: 20 },
    }),
    [theme, compact],
  );
}

type Styles = ReturnType<typeof useStyles>;

function useImpactReport(workspaceId: string) {
  const report = useRpc(impactReportRpc);
  const queryClient = useQueryClient();
  // the cached workspace diff stat changes as soon as the tree does, so a change refetches without waiting for the poll
  const diffStat = useWorkspace(workspaceId, (workspace) => workspace.diffStat);
  const diffKey = diffStat ? `${diffStat.additions}+${diffStat.deletions}` : "none";
  const queryKey = ["codegraph", "impact", workspaceId, diffKey];
  const query = useQuery({
    queryKey,
    queryFn: () => report({ workspaceId }),
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });
  const refresh = useMutation({
    mutationFn: () => report({ workspaceId, force: true }),
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
  });
  return { query, refresh };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function rowLabel(dependent: Dependent): { name: string; detail: string } {
  if (dependent.kind === "file") return { name: "whole file", detail: "imports" };
  return { name: `${dependent.name}:${dependent.startLine}`, detail: dependent.kind };
}

function DependentRow({ dependent, styles }: { dependent: Dependent; styles: Styles }) {
  const label = rowLabel(dependent);
  return (
    <View style={styles.row}>
      <Text style={styles.symbol}>{label.name}</Text>
      <Text style={styles.detail}>{label.detail}</Text>
      <Text style={styles.via} numberOfLines={1}>
        {`via ${dependent.via.join(", ")}`}
      </Text>
    </View>
  );
}

function FileGroup({ file, styles, theme }: { file: AffectedFile; styles: Styles; theme: PluginHostProps["theme"] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? file.dependents : file.dependents.slice(0, ROWS_PER_FILE);
  const hidden = file.dependents.length - shown.length;
  return (
    <View style={styles.group}>
      <View style={styles.groupHead}>
        <Icon name={file.dependents.length === 0 ? "FlaskConical" : "FileCode"} size={14} color={theme.colors.accent} />
        <Text style={styles.path} numberOfLines={1}>
          {file.filePath}
        </Text>
        {file.dependents.length > 0 ? <Text style={styles.count}>{plural(file.dependents.length, "symbol")}</Text> : null}
      </View>
      {shown.map((dependent) => (
        <DependentRow key={`${dependent.name}:${dependent.startLine}`} dependent={dependent} styles={styles} />
      ))}
      {hidden > 0 ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Show ${hidden} more symbols in ${file.filePath}`} onPress={() => setExpanded(true)}>
          <Text style={styles.more}>{`${hidden} more`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function AffectedSection({ title, files, empty, styles, theme }: { title: string; files: AffectedFile[]; empty: string; styles: Styles; theme: PluginHostProps["theme"] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? files : files.slice(0, FILES_PER_SECTION);
  const hidden = files.length - shown.length;
  const symbols = files.reduce((sum, file) => sum + file.dependents.length, 0);
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>{`${title} · ${plural(files.length, "file")}${symbols > 0 ? ` · ${plural(symbols, "symbol")}` : ""}`}</Text>
      {files.length === 0 ? <Text style={styles.empty}>{empty}</Text> : null}
      {shown.map((file) => (
        <FileGroup key={file.filePath} file={file} styles={styles} theme={theme} />
      ))}
      {hidden > 0 ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Show ${hidden} more files`} onPress={() => setExpanded(true)}>
          <Text style={styles.moreFiles}>{`${hidden} more ${hidden === 1 ? "file" : "files"}`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function changedDetail(file: ChangedFile): string {
  if (!file.indexed) return "not in index";
  const parts = [plural(file.symbols.length, "symbol")];
  if (file.skipped > 0) parts.push(`${file.skipped} skipped`);
  return parts.join(" · ");
}

function ChangedFiles({ report, styles, theme }: { report: ImpactReport; styles: Styles; theme: PluginHostProps["theme"] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? report.changedFiles : report.changedFiles.slice(0, FILES_PER_SECTION);
  const hidden = report.changedFiles.length - shown.length;
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>{`Changed files · ${report.changedFiles.length}`}</Text>
      {report.changedFiles.length === 0 ? <Text style={styles.empty}>{`No changes against ${report.baseRef ?? "HEAD"}.`}</Text> : null}
      {shown.map((file) => (
        <View key={file.path} style={[styles.group, styles.groupHead]}>
          <Icon name="FileDiff" size={14} color={theme.colors.accent} />
          <Text style={styles.path} numberOfLines={1}>
            {file.path}
          </Text>
          <Text style={styles.count}>{changedDetail(file)}</Text>
        </View>
      ))}
      {hidden > 0 ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Show ${hidden} more changed files`} onPress={() => setExpanded(true)}>
          <Text style={styles.moreFiles}>{`${hidden} more ${hidden === 1 ? "file" : "files"}`}</Text>
        </Pressable>
      ) : null}
      {report.filesSkipped > 0 ? <Text style={styles.warning}>{`${plural(report.filesSkipped, "more changed file")} not analysed.`}</Text> : null}
    </View>
  );
}

function summary(report: ImpactReport): string {
  const symbols = report.changedFiles.reduce((sum, file) => sum + file.symbols.length, 0);
  const parts = [`vs ${report.baseRef ?? "HEAD"}`, plural(report.changedFiles.length, "file"), plural(symbols, "symbol")];
  if (report.cached) parts.push("cached");
  return parts.join(" · ");
}

export function ImpactPanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  const styles = useStyles(theme, layout.compact);
  const { query, refresh } = useImpactReport(workspaceId);
  const report = query.data;
  const busy = query.isFetching || refresh.isPending;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.toolbar}>
        <Text style={styles.title}>Impact</Text>
        <Text style={styles.muted}>{report ? summary(report) : "…"}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh impact" onPress={() => refresh.mutate()} disabled={busy}>
          <Text style={styles.action}>{busy ? "Analysing" : "Refresh"}</Text>
        </Pressable>
      </View>
      {query.error ? <Text style={styles.warning}>{query.error instanceof Error ? query.error.message : String(query.error)}</Text> : null}
      {refresh.error ? <Text style={styles.warning}>{refresh.error instanceof Error ? refresh.error.message : String(refresh.error)}</Text> : null}
      {report?.errors.map((error) => (
        <Text key={error} style={styles.warning}>
          {error}
        </Text>
      ))}
      {!report ? <Text style={styles.empty}>Analysing the diff…</Text> : null}
      {report && !report.indexed ? (
        <View style={styles.section}>
          <Text style={styles.notice}>{`No CodeGraph index for ${report.directory ?? "this workspace"}. Create one in the project root:`}</Text>
          <Text style={styles.code}>codegraph init</Text>
        </View>
      ) : null}
      {report ? <ChangedFiles report={report} styles={styles} theme={theme} /> : null}
      {report?.indexed ? <AffectedSection title="Affected code" files={report.affectedCode} empty="Nothing in the index depends on the changed symbols." styles={styles} theme={theme} /> : null}
      {report?.indexed ? <AffectedSection title="Affected tests" files={report.affectedTests} empty="No test reaches the changed symbols." styles={styles} theme={theme} /> : null}
    </ScrollView>
  );
}
