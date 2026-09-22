import type { PluginHandlerContext, PluginHookAgent, PluginTurnOutcome } from "@getpaseo/plugin/server";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { ActiveDispatch, Comment, DispatcherStatus, Issue, ProjectConfig } from "../shared/beads";

type PaseoApi = PluginHandlerContext["paseo"];
import * as beads from "./beads";
import { findProject, loadConfig, loadState, saveState, type QueueConfig } from "./config";
import { latestOutputText } from "./inspect";

const SUMMARY_CHARS = 2000;

export function agentPrompt(project: ProjectConfig, issue: Issue, comments: Comment[]): string {
  const body = beads.issueText(project, issue, comments);
  return [
    `You are working on Beads issue ${issue.id} from the project's work queue. The issue has been claimed for you.`,
    "",
    body,
    "",
    "The `br` CLI is configured for this project through the environment; run `br show " + issue.id + " --json` for the full record and `br ready --json` to see what else is unblocked.",
    "",
    "Do the work described, verify it the way the project verifies changes, and commit it on the current branch. Do not push and do not open a pull request.",
    `Pass --actor paseo-agent on every br command that writes, so your comments are distinguishable from the human's.`,
    `When you are done run: br comments add ${issue.id} "<what you changed and how you verified it>" --actor paseo-agent and then br close ${issue.id} --reason "Completed: <specific proof>" --actor paseo-agent.`,
    `If you cannot finish, leave it open: br comments add ${issue.id} "<what blocks you>" --actor paseo-agent and br update ${issue.id} --status blocked --actor paseo-agent.`,
    "If you notice unrelated work worth doing, file it with br create instead of doing it now.",
  ].join("\n");
}

export class Dispatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  lastPollAt: string | null = null;
  lastError: string | null = null;

  constructor(private readonly paseo: PaseoApi) {}

  start(): void {
    this.reschedule();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  reschedule(): void {
    this.stop();
    const { global } = loadConfig();
    this.timer = setInterval(() => void this.poll(), global.pollSeconds * 1000);
    void this.poll();
  }

  status(): DispatcherStatus {
    return { lastPollAt: this.lastPollAt, lastError: this.lastError, active: loadState().active };
  }

  isTracked(agentId: string): boolean {
    return loadState().active.some((entry) => entry.agentId === agentId);
  }

  activeFor(root: string): ActiveDispatch[] {
    return loadState().active.filter((entry) => entry.root === root);
  }

  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const config = loadConfig();
      this.lastPollAt = new Date().toISOString();
      if (config.global.paused) return;
      for (const project of config.projects) {
        if (!project.autoDispatch) continue;
        try {
          await this.fill(config, project);
        } catch (error) {
          this.lastError = `${project.root}: ${error instanceof Error ? error.message : String(error)}`;
          console.error("[beads-queue] poll failed", this.lastError);
        }
      }
    } finally {
      this.polling = false;
    }
  }

  private async fill(config: QueueConfig, project: ProjectConfig): Promise<void> {
    const active = this.activeFor(project.root);
    let slots = project.maxConcurrent - active.length;
    if (slots <= 0) return;
    const init = await beads.ensureInitialized(project);
    if (!init.initialized) return;
    const candidates = await beads.ready(project);
    for (const issue of candidates) {
      if (slots <= 0) break;
      if (active.some((entry) => entry.issueId === issue.id)) continue;
      await this.dispatch(config, project, issue.id);
      slots -= 1;
    }
  }

  async dispatch(config: QueueConfig, project: ProjectConfig, id: string): Promise<ActiveDispatch> {
    const actor = config.global.actor;
    const { issue, comments } = await beads.show(project, id);
    if (issue.status === "closed") throw new Error(`${id} is already closed`);
    await beads.claim(project, id, actor);
    const provider = project.provider ?? config.global.provider;
    const title = `${issue.id} ${issue.title}`.slice(0, 80);
    const prompt = agentPrompt(project, issue, comments);
    let workspaceId: string;
    let agentId: string;
    try {
      // no branchName on purpose: paseo's metadata generation names the branch from the issue,
      // honouring the repo's paseo.json branchName instructions, so nothing needs renaming before a push
      const workspace = project.isolation === "worktree"
        ? await this.paseo.workspaces.create({
            title,
            source: { kind: "worktree", cwd: project.root, action: "branch-off" },
            firstAgentContext: { prompt },
          })
        : await this.paseo.workspaces.open({ cwd: project.root });
      workspaceId = workspace.id;
      const agent = await workspace.agents.create({
        config: { provider },
        title,
        prompt,
      });
      agentId = agent.id;
    } catch (error) {
      await beads.release(project, id).catch(() => undefined);
      throw error;
    }
    const entry: ActiveDispatch = { issueId: id, root: project.root, agentId, workspaceId, startedAt: new Date().toISOString() };
    const state = loadState();
    state.active = [...state.active.filter((e) => e.issueId !== id || e.root !== project.root), entry];
    saveState(state);
    await beads.addComment(project, id, `Dispatched to Paseo agent ${agentId} (workspace ${workspaceId}, provider ${provider})`, actor).catch(() => undefined);
    await this.appendRow(agentId, project, issue, "Dispatched from the Beads queue");
    return entry;
  }

  async onTurnEnded(agent: PluginHookAgent, outcome: PluginTurnOutcome, timeline: readonly AgentTimelineItem[]): Promise<void> {
    const state = loadState();
    const entry = state.active.find((e) => e.agentId === agent.id);
    if (!entry) return;
    const config = loadConfig();
    const project = findProject(config, entry.root);
    if (!project) return;
    const actor = config.global.actor;
    const summary = latestOutputText(timeline).trim().slice(-SUMMARY_CHARS);
    const branch = await this.currentBranch(entry.workspaceId);
    const where = branch ? ` Branch: ${branch}.` : "";
    const finish = async (note: string) => {
      state.active = state.active.filter((e) => e.agentId !== agent.id);
      saveState(state);
      const { issue } = await beads.show(project, entry.issueId).catch(() => ({ issue: null }));
      if (issue) await this.appendRow(agent.id, project, issue, note);
    };
    try {
      if (outcome.kind === "failed") {
        await beads.addComment(project, entry.issueId, `Agent ${agent.id} failed: ${outcome.error.message}. Returned to ready.${where}`, actor);
        await beads.release(project, entry.issueId);
        await finish("Agent failed; issue returned to ready");
        return;
      }
      if (outcome.kind === "canceled") {
        await beads.addComment(project, entry.issueId, `Agent ${agent.id} turn was canceled (${outcome.reason}). Left in progress.${where}`, actor);
        await finish("Turn canceled; issue left in progress");
        return;
      }
      const { issue } = await beads.show(project, entry.issueId);
      if (issue.status === "closed") {
        if (branch) await beads.addComment(project, entry.issueId, `Work is committed on branch ${branch}, not pushed.`, actor);
        await finish(branch ? `Issue closed by the agent · ${branch}` : "Issue closed by the agent");
        return;
      }
      await beads.addComment(
        project,
        entry.issueId,
        `Agent ${agent.id} turn ended without closing the issue.${where} Last output:\n${summary || "(no text output)"}`,
        actor,
      );
      await finish(`Turn ended; issue still ${issue.status}. Review the agent's work`);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      console.error("[beads-queue] turn_ended handling failed", this.lastError);
    }
  }

  private async currentBranch(workspaceId: string): Promise<string | null> {
    try {
      const snapshot = await this.paseo.workspaces.ref(workspaceId).refresh();
      return snapshot?.gitRuntime?.currentBranch ?? null;
    } catch {
      return null;
    }
  }

  private async appendRow(agentId: string, project: ProjectConfig, issue: Issue, note: string | null): Promise<void> {
    try {
      await this.paseo.agents.ref(agentId).timeline.append({
        type: "plugin",
        id: `beads-${issue.id}`,
        kind: "beads-issue",
        version: 1,
        data: { issueId: issue.id, title: issue.title, root: project.root, status: issue.status, note },
      });
    } catch (error) {
      console.error("[beads-queue] timeline append failed", error instanceof Error ? error.message : error);
    }
  }
}
