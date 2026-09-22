import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { copyText, Icon, Modal, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import {
  configGet, configSetProject, dispatchIssue, issueCreate, issueShow, issuesList, issueTransition,
  PRIORITY_LABEL, type ActiveDispatch, type Issue,
} from "../shared/beads";
import { makeStyles, priorityStyle } from "./styles";

type Styles = ReturnType<typeof makeStyles>;
type LaneKey = "ready" | "inProgress" | "blocked" | "closed";

const LANES: { key: LaneKey; title: string; empty: string }[] = [
  { key: "ready", title: "Ready", empty: "Nothing unblocked" },
  { key: "inProgress", title: "In progress", empty: "No agent working" },
  { key: "blocked", title: "Blocked", empty: "No blockers" },
  { key: "closed", title: "Closed", empty: "Nothing closed yet" },
];

function IssueCard({
  issue, active, styles, theme, onOpen, onDispatch, onOpenAgent,
}: {
  issue: Issue;
  active?: ActiveDispatch;
  styles: Styles;
  theme: PluginWorkspacePanelProps["theme"];
  onOpen: () => void;
  onDispatch?: () => void;
  onOpenAgent?: () => void;
}) {
  const hasActions = Boolean(onDispatch || (active && onOpenAgent));
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${issue.id}`} onPress={onOpen} style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={{ ...styles.priority, ...priorityStyle(issue.priority, theme) }}>
          {PRIORITY_LABEL[issue.priority] ?? `P${issue.priority}`}
        </Text>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.body} numberOfLines={3}>{issue.title}</Text>
          <View style={styles.wrap}>
            <Text style={styles.mono}>{issue.id}</Text>
            {issue.issue_type !== "task" ? <View style={styles.chip}><Text style={styles.chipText}>{issue.issue_type}</Text></View> : null}
            {issue.assignee ? <Text style={styles.muted}>· {issue.assignee}</Text> : null}
            {issue.dependency_count > 0 ? <Text style={styles.muted}>· waits on {issue.dependency_count}</Text> : null}
            {issue.labels.map((label) => (
              <View key={label} style={styles.chip}><Text style={styles.chipText}>{label}</Text></View>
            ))}
          </View>
        </View>
      </View>
      {hasActions ? (
        <View style={{ ...styles.row, justifyContent: "flex-end" }}>
          {active && onOpenAgent ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Open the working agent" style={styles.ghost} onPress={onOpenAgent}>
              <Text style={styles.ghostText}>Open agent</Text>
            </Pressable>
          ) : null}
          {onDispatch ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Dispatch ${issue.id} to an agent`} style={styles.button} onPress={onDispatch}>
              <Text style={styles.buttonText}>Dispatch</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

export function BeadsPanel({ theme, layout, workspaceId, navigation }: PluginWorkspacePanelProps) {
  const root = useWorkspace(workspaceId, (workspace) => workspace.projectRootPath);
  const getConfig = useRpc(configGet);
  const setProject = useRpc(configSetProject);
  const list = useRpc(issuesList);
  const show = useRpc(issueShow);
  const create = useRpc(issueCreate);
  const transition = useRpc(issueTransition);
  const dispatch = useRpc(dispatchIssue);
  const toast = useToast();
  const queryClient = useQueryClient();
  const styles = useMemo(() => makeStyles(theme, layout.compact), [theme, layout.compact]);

  const [selected, setSelected] = useState<string | null>(null);
  const [lane, setLane] = useState<LaneKey>("ready");
  const [creating, setCreating] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftPriority, setDraftPriority] = useState(2);

  const config = useQuery({ queryKey: ["beads", "config"], queryFn: () => getConfig({}) });
  const project = config.data?.projects.find((p) => p.root === root) ?? null;
  const issues = useQuery({
    queryKey: ["beads", "issues", root],
    queryFn: () => list({ root: root! }),
    enabled: !!root && !!project,
    refetchInterval: 15_000,
  });
  const detail = useQuery({
    queryKey: ["beads", "issue", root, selected],
    queryFn: () => show({ root: root!, id: selected! }),
    enabled: !!root && !!selected,
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["beads"] });
  const onError = (error: unknown) => toast.error(error instanceof Error ? error.message : String(error));

  const enable = useMutation({ mutationFn: (mode: "repo" | "external") => setProject({ root: root!, mode }), onSuccess: invalidate, onError });
  const toggleAuto = useMutation({ mutationFn: (autoDispatch: boolean) => setProject({ root: root!, autoDispatch }), onSuccess: invalidate, onError });
  const createIssue = useMutation({
    mutationFn: () => create({ root: root!, title: draftTitle.trim(), description: draftBody.trim() || undefined, priority: draftPriority }),
    onSuccess: (issue) => {
      setCreating(false);
      setDraftTitle("");
      setDraftBody("");
      toast.show(`Created ${issue.id}`, { variant: "success" });
      invalidate();
    },
    onError,
  });
  const dispatchOne = useMutation({
    mutationFn: (id: string) => dispatch({ root: root!, id }),
    onSuccess: (entry) => {
      toast.show(`Dispatched ${entry.issueId}`, { variant: "success" });
      invalidate();
      navigation?.openAgent({ agentId: entry.agentId });
    },
    onError,
  });
  const transitionOne = useMutation({
    mutationFn: (input: { id: string; action: "close" | "reopen" | "block" }) => transition({ root: root!, ...input }),
    onSuccess: () => {
      setSelected(null);
      invalidate();
    },
    onError,
  });

  const data = issues.data;
  const activeFor = (id: string) => data?.active.find((entry) => entry.issueId === id);

  if (!root) return <View style={styles.screen} />;

  if (config.data && !project) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 520 }}>
        <Text style={styles.heading}>Beads queue</Text>
        <Text style={styles.muted}>Not enabled for this project. Choose where the queue lives.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Enable external mode" style={styles.card} onPress={() => enable.mutate("external")}>
          <Text style={styles.body}>Outside the repo</Text>
          <Text style={styles.muted}>Stored under ~/.paseo/beads. Nothing is added to the repository; agents get BEADS_DIR injected.</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Enable repo mode" style={styles.card} onPress={() => enable.mutate("repo")}>
          <Text style={styles.body}>In the repo</Text>
          <Text style={styles.muted}>Uses a committed .beads directory in the project root. Run `br init` there first.</Text>
        </Pressable>
      </ScrollView>
    );
  }

  const renderCards = (key: LaneKey) => {
    const items = data?.[key];
    const meta = LANES.find((l) => l.key === key)!;
    if (!items || items.length === 0) {
      return (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{items ? meta.empty : "Loading…"}</Text>
        </View>
      );
    }
    return items.map((issue) => {
      const active = activeFor(issue.id);
      return (
        <IssueCard
          key={issue.id}
          issue={issue}
          active={active}
          styles={styles}
          theme={theme}
          onOpen={() => setSelected(issue.id)}
          onDispatch={key === "ready" && !dispatchOne.isPending ? () => dispatchOne.mutate(issue.id) : undefined}
          onOpenAgent={active ? () => navigation?.openAgent({ agentId: active.agentId }) : undefined}
        />
      );
    });
  };

  const counts = (key: LaneKey) => data?.[key]?.length;
  const autoOn = Boolean(project?.autoDispatch);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.row}>
          <Icon name="ListTodo" size={16} color={theme.colors.accent} />
          <Text style={styles.heading}>Beads</Text>
          <View style={styles.chip}><Text style={styles.chipText}>{project?.mode === "repo" ? "in repo" : "external"}</Text></View>
          <View style={{ flex: 1 }} />
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel="Toggle automatic dispatch"
            style={{ ...styles.row, gap: 6 }}
            onPress={() => toggleAuto.mutate(!autoOn)}
          >
            <Icon name={autoOn ? "ToggleRight" : "ToggleLeft"} size={22} color={autoOn ? theme.colors.accent : theme.colors.foregroundMuted} />
            <Text style={styles.muted}>Auto-dispatch</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="New issue" style={styles.button} onPress={() => setCreating(true)}>
            <Text style={styles.buttonText}>New</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Refresh" style={styles.iconButton} onPress={() => void issues.refetch()}>
            <Icon name="RefreshCw" size={15} color={theme.colors.foregroundMuted} />
          </Pressable>
        </View>
        <Text style={styles.muted}>
          {config.data?.global.paused ? "Dispatcher paused" : "Dispatcher running"} · up to {project?.maxConcurrent ?? 1} agent{(project?.maxConcurrent ?? 1) > 1 ? "s" : ""}
          {data?.active.length ? ` · ${data.active.length} active` : ""}
        </Text>
        {data?.beadsDir ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Copy the BEADS_DIR export for a terminal"
            style={styles.row}
            onPress={() => void copyText(`export BEADS_DIR=${data.beadsDir}`).then(() => toast.show("Copied BEADS_DIR export", { variant: "success" }), () => toast.error("Could not copy"))}
          >
            <Icon name="FolderOpen" size={12} color={theme.colors.foregroundMuted} />
            <Text style={styles.mono} numberOfLines={1}>{data.beadsDir.replace(/^\/Users\/[^/]+/, "~")}</Text>
            <Icon name="Copy" size={12} color={theme.colors.foregroundMuted} />
          </Pressable>
        ) : null}
        {config.data?.status.lastError ? <Text style={styles.danger}>{config.data.status.lastError}</Text> : null}
        {issues.error ? <Text style={styles.danger}>{issues.error instanceof Error ? issues.error.message : String(issues.error)}</Text> : null}
        {layout.compact ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 6 }}>
            {LANES.map((l) => (
              <Pressable
                key={l.key}
                accessibilityRole="tab"
                accessibilityLabel={`${l.title} lane`}
                style={[styles.tab, lane === l.key && styles.tabOn]}
                onPress={() => setLane(l.key)}
              >
                <Text style={lane === l.key ? styles.tabTextOn : styles.tabText}>
                  {l.title}{counts(l.key) !== undefined ? ` ${counts(l.key)}` : ""}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>

      {layout.compact ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12, gap: 8 }}>
          {renderCards(lane)}
        </ScrollView>
      ) : (
        <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.board}>
            {LANES.map((l) => (
              <View key={l.key} style={styles.column}>
                <View style={styles.columnHeader}>
                  <Text style={styles.columnTitle}>{l.title}</Text>
                  {counts(l.key) !== undefined ? <Text style={styles.count}>{counts(l.key)}</Text> : null}
                </View>
                {renderCards(l.key)}
              </View>
            ))}
          </ScrollView>
        </ScrollView>
      )}

      <Modal
        title={detail.data ? `${detail.data.issue.id} ${detail.data.issue.title}` : selected ?? "Issue"}
        icon={<Icon name="ListTodo" size={18} color={theme.colors.foreground} />}
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <Modal.Content>
          {detail.isLoading ? <Text style={styles.muted}>Loading…</Text> : null}
          {detail.data ? (
            <>
              <Text style={styles.modalMeta}>
                {PRIORITY_LABEL[detail.data.issue.priority]} · {detail.data.issue.issue_type} · {detail.data.issue.status}
                {detail.data.issue.assignee ? ` · ${detail.data.issue.assignee}` : ""}
              </Text>
              <Text selectable style={styles.body}>{detail.data.issue.description ?? "No description."}</Text>
              {detail.data.comments.length > 0 ? <Text style={styles.columnTitle}>Comments</Text> : null}
              {detail.data.comments.map((c) => (
                <View key={c.id} style={styles.card}>
                  <Text style={styles.muted}>{c.author} · {c.created_at.slice(0, 16).replace("T", " ")}</Text>
                  <Text selectable style={styles.body}>{c.text}</Text>
                </View>
              ))}
              <View style={{ ...styles.row, justifyContent: "flex-end" }}>
                {detail.data.issue.status !== "closed" ? (
                  <>
                    {detail.data.issue.status !== "blocked" ? (
                      <Pressable accessibilityRole="button" accessibilityLabel="Mark blocked" style={styles.ghost} onPress={() => transitionOne.mutate({ id: detail.data!.issue.id, action: "block" })}>
                        <Text style={styles.ghostText}>Block</Text>
                      </Pressable>
                    ) : null}
                    <Pressable accessibilityRole="button" accessibilityLabel="Close issue" style={styles.ghost} onPress={() => transitionOne.mutate({ id: detail.data!.issue.id, action: "close" })}>
                      <Text style={styles.ghostText}>Close</Text>
                    </Pressable>
                    {!activeFor(detail.data.issue.id) ? (
                      <Pressable accessibilityRole="button" accessibilityLabel="Dispatch to an agent" style={styles.button} onPress={() => { setSelected(null); dispatchOne.mutate(detail.data!.issue.id); }}>
                        <Text style={styles.buttonText}>Dispatch</Text>
                      </Pressable>
                    ) : null}
                  </>
                ) : (
                  <Pressable accessibilityRole="button" accessibilityLabel="Reopen issue" style={styles.ghost} onPress={() => transitionOne.mutate({ id: detail.data!.issue.id, action: "reopen" })}>
                    <Text style={styles.ghostText}>Reopen</Text>
                  </Pressable>
                )}
              </View>
            </>
          ) : null}
        </Modal.Content>
      </Modal>

      <Modal
        title="New issue"
        icon={<Icon name="Plus" size={18} color={theme.colors.foreground} />}
        open={creating}
        onOpenChange={(open) => !open && setCreating(false)}
      >
        <Modal.Content>
          <TextInput
            accessibilityLabel="Issue title"
            placeholder="Title"
            placeholderTextColor={theme.colors.foregroundMuted}
            value={draftTitle}
            onChangeText={setDraftTitle}
            style={styles.input}
          />
          <TextInput
            accessibilityLabel="Issue description"
            placeholder="What needs to happen, and how to verify it"
            placeholderTextColor={theme.colors.foregroundMuted}
            value={draftBody}
            onChangeText={setDraftBody}
            multiline
            style={{ ...styles.input, minHeight: 120 }}
          />
          <View style={styles.wrap}>
            {PRIORITY_LABEL.map((label, value) => (
              <Pressable
                key={label}
                accessibilityRole="button"
                accessibilityLabel={`Priority ${label}`}
                style={[styles.tab, draftPriority === value && styles.tabOn]}
                onPress={() => setDraftPriority(value)}
              >
                <Text style={draftPriority === value ? styles.tabTextOn : styles.tabText}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ ...styles.row, justifyContent: "flex-end" }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Create issue"
              style={styles.button}
              disabled={!draftTitle.trim() || createIssue.isPending}
              onPress={() => createIssue.mutate()}
            >
              <Text style={styles.buttonText}>{createIssue.isPending ? "Creating…" : "Create"}</Text>
            </Pressable>
          </View>
        </Modal.Content>
      </Modal>
    </View>
  );
}
