import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { FlatList, Icon, Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { prComplete, prCreate, prMergeState, prOverview, runFailure, STRATEGY_LABEL, type MergeStrategy, type PipelineRun, type ReviewComment } from "../shared/ado";
import { allCommentsMessage, commentMessage, failureMessage, statusMessage } from "./messages";
import { openExternal } from "./web";

interface AgentChoice {
  id: string;
  title: string;
  status: string;
}

function runColor(run: PipelineRun, colors: PluginWorkspacePanelProps["theme"]["colors"]): string {
  if (run.result === "succeeded") return colors.statusSuccess;
  if (run.result === "failed" || run.result === "canceled") return colors.statusDanger;
  if (run.result === "partiallySucceeded") return colors.statusWarning;
  return colors.foregroundMuted;
}

function voteLabel(vote: number): string {
  if (vote >= 10) return "approved";
  if (vote === 5) return "approved with suggestions";
  if (vote === -5) return "waiting for author";
  if (vote <= -10) return "rejected";
  return "no vote";
}

function formatDate(value: string | null): string {
  if (!value) return "";
  return value.slice(0, 16).replace("T", " ");
}

export function PullRequestPanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  const cwd = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const fetchOverview = useRpc(prOverview);
  const createPr = useRpc(prCreate);
  const fetchFailure = useRpc(runFailure);
  const fetchMergeState = useRpc(prMergeState);
  const completePr = useRpc(prComplete);
  const [merging, setMerging] = useState(false);
  const [strategy, setStrategy] = useState<MergeStrategy | null>(null);
  const [deleteSource, setDeleteSource] = useState<boolean | null>(null);
  const [transitionItems, setTransitionItems] = useState(false);
  const paseo = usePaseo();
  const toast = useToast();
  const queryClient = useQueryClient();
  // a message waiting for an agent choice; resolved once the workspace has exactly one agent or the user picks
  const [pending, setPending] = useState<{ label: string; text: string } | null>(null);
  const [rememberedAgent, setRememberedAgent] = useState<string | null>(null);
  const queryKey = ["ado", "overview", cwd];
  const overview = useQuery({
    queryKey,
    queryFn: () => fetchOverview({ cwd: cwd! }),
    enabled: !!cwd,
    refetchInterval: 60_000,
  });
  const creation = useMutation({
    mutationFn: () => createPr({ cwd: cwd! }),
    onSuccess: (pr) => {
      toast.show(`Created PR !${pr.id}`, { variant: "success" });
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  const agents = useQuery({
    queryKey: ["ado", "agents", workspaceId],
    queryFn: async (): Promise<AgentChoice[]> => {
      const result = await paseo.agents.list();
      return result.entries
        .map((entry) => entry.agent)
        .filter((agent) => agent.workspaceId === workspaceId && !agent.archivedAt)
        .map((agent) => ({ id: agent.id, title: agent.title ?? agent.provider, status: agent.status }));
    },
    enabled: pending !== null,
  });
  const send = useMutation({
    mutationFn: async ({ agentId, text }: { agentId: string; text: string }) => {
      await paseo.agents.ref(agentId).send(text);
    },
    onSuccess: () => {
      setPending(null);
      toast.show("Sent to agent", { variant: "success" });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  function deliver(label: string, text: string) {
    if (rememberedAgent) {
      send.mutate({ agentId: rememberedAgent, text });
      return;
    }
    setPending({ label, text });
  }

  // with a single agent in the workspace there is nothing to choose
  const single = agents.data?.length === 1 ? agents.data[0] : null;
  useEffect(() => {
    if (!pending || !single || rememberedAgent || send.isPending) return;
    setRememberedAgent(single.id);
    send.mutate({ agentId: single.id, text: pending.text });
  }, [pending, single, rememberedAgent, send]);

  const data = overview.data;
  const merge = useQuery({
    queryKey: ["ado", "merge", cwd, data?.pr?.id],
    queryFn: () => fetchMergeState({ cwd: cwd!, id: data!.pr!.id }),
    enabled: !!cwd && !!data?.pr,
    refetchInterval: 60_000,
  });
  const completion = useMutation({
    mutationFn: (action: "auto-complete" | "complete" | "cancel-auto-complete") =>
      completePr({
        cwd: cwd!,
        id: data!.pr!.id,
        action,
        strategy: strategy ?? undefined,
        deleteSourceBranch: deleteSource ?? undefined,
        transitionWorkItems: transitionItems,
      }),
    onSuccess: (result, action) => {
      setMerging(false);
      toast.show(
        action === "complete" ? "Pull request completed" : action === "auto-complete" ? `Auto-complete set by ${result.autoCompleteBy ?? "you"}` : "Auto-complete cancelled",
        { variant: "success" },
      );
      void queryClient.invalidateQueries({ queryKey: ["ado"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });
  const sendFailure = useMutation({
    mutationFn: async (run: PipelineRun) => {
      if (!data?.pr) throw new Error("No pull request");
      const failure = await fetchFailure({ cwd: cwd!, runId: run.id, project: run.project });
      return failureMessage(data.pr.id, failure);
    },
    onSuccess: (text) => deliver("pipeline failure", text),
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  const styles = useMemo(() => {
    const pad = layout.compact ? 12 : 20;
    return {
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding: pad, gap: pad },
      row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      title: { color: theme.colors.foreground, fontSize: layout.compact ? 16 : 18, fontWeight: "600" as const, flexShrink: 1 },
      body: { color: theme.colors.foreground, fontSize: 14 },
      muted: { color: theme.colors.foregroundMuted, fontSize: 13 },
      section: { color: theme.colors.foregroundMuted, fontSize: 12, textTransform: "uppercase" as const, letterSpacing: 0.5 },
      card: { backgroundColor: theme.colors.surface1, borderRadius: 10, padding: 12, gap: 6, borderWidth: 1, borderColor: theme.colors.border },
      button: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: theme.colors.accent, alignSelf: "flex-start" as const },
      buttonText: { color: theme.colors.accentForeground, fontSize: 13, fontWeight: "600" as const },
      ghost: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, alignSelf: "flex-start" as const },
      ghostText: { color: theme.colors.foreground, fontSize: 13 },
      danger: { color: theme.colors.statusDanger, fontSize: 13 },
      agentRow: { paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.border, gap: 2 },
    };
  }, [theme, layout.compact]);

  const openComments = data?.comments.filter((comment) => !comment.resolved) ?? [];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.row}>
        <Icon name="GitBranch" size={16} color={theme.colors.foregroundMuted} />
        <Text style={styles.muted}>{data?.branch ?? "…"}</Text>
        <View style={{ flex: 1 }} />
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh" onPress={() => void overview.refetch()}>
          <Icon name="RefreshCw" size={16} color={theme.colors.foregroundMuted} />
        </Pressable>
      </View>

      {overview.isLoading ? <Text style={styles.muted}>Loading pull request…</Text> : null}
      {overview.error ? (
        <Text style={styles.danger}>{overview.error instanceof Error ? overview.error.message : String(overview.error)}</Text>
      ) : null}

      {data && !data.pr ? (
        <View style={styles.card}>
          <Text style={styles.body}>No active pull request for this branch.</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create pull request"
            style={styles.button}
            disabled={creation.isPending}
            onPress={() => creation.mutate()}
          >
            <Text style={styles.buttonText}>{creation.isPending ? "Creating…" : "Create pull request"}</Text>
          </Pressable>
        </View>
      ) : null}

      {data?.pr ? (
        <>
          <View style={styles.card}>
            <View style={styles.row}>
              <Icon name="GitPullRequest" size={18} color={theme.colors.accent} />
              <Text style={styles.title} numberOfLines={2}>
                !{data.pr.id} {data.pr.title}
              </Text>
            </View>
            <Text style={styles.muted}>
              {data.pr.sourceBranch} → {data.pr.targetBranch}
            </Text>
            <Text style={styles.muted}>
              {data.pr.isDraft ? "Draft · " : ""}
              {data.pr.status} · {data.pr.createdBy} · {formatDate(data.pr.createdAt)}
            </Text>
            {data.pr.reviewers.length > 0 ? (
              <Text style={styles.muted}>
                {data.pr.reviewers.map((r) => `${r.name}: ${voteLabel(r.vote)}`).join(" · ")}
              </Text>
            ) : null}
            <View style={styles.row}>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Open in Azure DevOps"
                style={styles.ghost}
                onPress={() => void openExternal(data.pr!.url)}
              >
                <Text style={styles.ghostText}>Open in Azure DevOps</Text>
              </Pressable>
              {data.pr.status === "active" ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Merge options"
                  style={styles.button}
                  onPress={() => {
                    setStrategy(merge.data?.strategy ?? merge.data?.allowedStrategies[0] ?? null);
                    setDeleteSource(merge.data?.deleteSourceBranch ?? true);
                    setMerging(true);
                  }}
                >
                  <Text style={styles.buttonText}>{merge.data?.autoCompleteBy ? "Auto-complete set" : "Merge…"}</Text>
                </Pressable>
              ) : null}
            </View>
            {merge.data ? (
              <Text style={styles.muted}>
                merge {merge.data.mergeStatus}
                {merge.data.autoCompleteBy ? ` · auto-complete by ${merge.data.autoCompleteBy}` : ""}
                {merge.data.policies.length ? ` · ${merge.data.policies.map((p) => `${p.type}: ${p.status}`).join(", ")}` : ""}
              </Text>
            ) : null}
          </View>

          <View style={styles.row}>
            <Text style={styles.section}>Pipelines</Text>
            <View style={{ flex: 1 }} />
            {data.runs.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send pipeline status to agent"
                style={styles.ghost}
                onPress={() => deliver("pipeline status", statusMessage(data.pr!.id, data.runs))}
              >
                <Text style={styles.ghostText}>Send status</Text>
              </Pressable>
            ) : null}
          </View>
          {data.runs.length === 0 ? <Text style={styles.muted}>No pipeline runs for this PR.</Text> : null}
          {data.runs.map((run) => (
            <View key={run.id} style={styles.card}>
              <View style={styles.row}>
                <Icon name="Workflow" size={14} color={runColor(run, theme.colors)} />
                <Text style={{ ...styles.body, flexShrink: 1 }} numberOfLines={1}>
                  {run.pipeline}
                </Text>
                <View style={{ flex: 1 }} />
                <Pressable accessibilityRole="link" accessibilityLabel="Open run" onPress={() => run.url && void openExternal(run.url)}>
                  <Icon name="ExternalLink" size={14} color={theme.colors.foregroundMuted} />
                </Pressable>
              </View>
              <Text style={{ ...styles.muted, color: runColor(run, theme.colors) }}>
                {run.result ?? run.status}
                {run.finished ? ` · ${formatDate(run.finished)}` : ""}
              </Text>
              {run.result === "failed" || run.result === "partiallySucceeded" ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Send failure log to agent"
                  style={styles.button}
                  disabled={sendFailure.isPending}
                  onPress={() => sendFailure.mutate(run)}
                >
                  <Text style={styles.buttonText}>{sendFailure.isPending ? "Fetching log…" : "Send failure to agent"}</Text>
                </Pressable>
              ) : null}
            </View>
          ))}

          <View style={styles.row}>
            <Text style={styles.section}>Review comments</Text>
            <View style={{ flex: 1 }} />
            {openComments.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send all open comments to agent"
                style={styles.button}
                onPress={() => deliver("open comments", allCommentsMessage(data.pr!.id, openComments))}
              >
                <Text style={styles.buttonText}>Send all open ({openComments.length})</Text>
              </Pressable>
            ) : null}
          </View>
          {data.comments.length === 0 ? <Text style={styles.muted}>No review comments.</Text> : null}
          {data.comments.map((comment: ReviewComment, index) => (
            <View key={index} style={styles.card}>
              <Text style={styles.muted}>
                {comment.file ?? "general"} · {comment.author} · {formatDate(comment.date)}
                {comment.resolved ? " · resolved" : ""}
              </Text>
              <Text selectable style={styles.body}>
                {comment.content}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send this comment to agent"
                style={styles.ghost}
                onPress={() => deliver("review comment", commentMessage(data.pr!.id, comment))}
              >
                <Text style={styles.ghostText}>Send to agent</Text>
              </Pressable>
            </View>
          ))}
        </>
      ) : null}

      <Modal
        title={data?.pr ? `Merge !${data.pr.id}` : "Merge"}
        icon={<Icon name="GitMerge" size={18} color={theme.colors.foreground} />}
        open={merging}
        onOpenChange={(open) => !open && setMerging(false)}
      >
        <Modal.Content>
          {merge.data ? (
            <>
              <Text style={styles.muted}>
                {data?.pr?.sourceBranch} → {data?.pr?.targetBranch} · merge {merge.data.mergeStatus}{merge.data.isDraft ? " · draft" : ""}
              </Text>
              {merge.data.policies.map((p) => (
                <Text key={p.type} style={{ ...styles.muted, color: p.status === "approved" ? theme.colors.statusSuccess : p.blocking ? theme.colors.statusWarning : theme.colors.foregroundMuted }}>
                  {p.blocking ? "required" : "optional"} · {p.type}: {p.status}
                </Text>
              ))}
              <Text style={styles.section}>Strategy</Text>
              <View style={styles.row}>
                {merge.data.allowedStrategies.map((s) => (
                  <Pressable
                    key={s}
                    accessibilityRole="button"
                    accessibilityLabel={STRATEGY_LABEL[s]}
                    style={strategy === s ? styles.button : styles.ghost}
                    onPress={() => setStrategy(s)}
                  >
                    <Text style={strategy === s ? styles.buttonText : styles.ghostText}>{STRATEGY_LABEL[s]}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.row}>
                <Pressable accessibilityRole="switch" accessibilityLabel="Delete source branch after merge" style={styles.row} onPress={() => setDeleteSource(!deleteSource)}>
                  <Icon name={deleteSource ? "SquareCheck" : "Square"} size={18} color={theme.colors.foreground} />
                  <Text style={styles.body}>Delete source branch</Text>
                </Pressable>
              </View>
              <View style={styles.row}>
                <Pressable accessibilityRole="switch" accessibilityLabel="Transition linked work items" style={styles.row} onPress={() => setTransitionItems(!transitionItems)}>
                  <Icon name={transitionItems ? "SquareCheck" : "Square"} size={18} color={theme.colors.foreground} />
                  <Text style={styles.body}>Transition linked work items</Text>
                </Pressable>
              </View>
              <View style={styles.row}>
                {merge.data.autoCompleteBy ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="Cancel auto-complete" style={styles.ghost} disabled={completion.isPending} onPress={() => completion.mutate("cancel-auto-complete")}>
                    <Text style={styles.ghostText}>Cancel auto-complete</Text>
                  </Pressable>
                ) : (
                  <Pressable accessibilityRole="button" accessibilityLabel="Complete automatically when policies pass" style={styles.ghost} disabled={completion.isPending} onPress={() => completion.mutate("auto-complete")}>
                    <Text style={styles.ghostText}>Auto-complete when policies pass</Text>
                  </Pressable>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Complete the pull request now"
                  style={{ ...styles.button, opacity: merge.data.canCompleteNow ? 1 : 0.5 }}
                  disabled={!merge.data.canCompleteNow || completion.isPending}
                  onPress={() => completion.mutate("complete")}
                >
                  <Text style={styles.buttonText}>{completion.isPending ? "Working…" : "Complete now"}</Text>
                </Pressable>
              </View>
              {!merge.data.canCompleteNow ? (
                <Text style={styles.muted}>Complete now is available once the merge succeeds and every required policy is approved.</Text>
              ) : null}
            </>
          ) : (
            <Text style={styles.muted}>Loading merge state…</Text>
          )}
        </Modal.Content>
      </Modal>

      <Modal
        title={pending ? `Send ${pending.label} to…` : "Send to agent"}
        icon={<Icon name="Send" size={18} color={theme.colors.foreground} />}
        open={pending !== null && !single}
        onOpenChange={(open) => !open && setPending(null)}
      >
        <Modal.Content scrollable={false} contentContainerStyle={{ padding: 0, gap: 0 }}>
          {agents.isLoading ? <Text style={{ ...styles.muted, padding: 16 }}>Loading agents…</Text> : null}
          {agents.data && agents.data.length === 0 ? (
            <Text style={{ ...styles.muted, padding: 16 }}>No agents in this workspace. Start one first.</Text>
          ) : null}
          <FlatList
            style={{ flex: 1, minHeight: 0 }}
            data={agents.data ?? []}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Send to ${item.title}`}
                disabled={send.isPending}
                style={styles.agentRow}
                onPress={() => {
                  setRememberedAgent(item.id);
                  if (pending) send.mutate({ agentId: item.id, text: pending.text });
                }}
              >
                <Text style={styles.body} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.muted}>{item.status}</Text>
              </Pressable>
            )}
          />
        </Modal.Content>
      </Modal>
    </ScrollView>
  );
}
