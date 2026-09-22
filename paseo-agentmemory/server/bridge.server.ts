import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";
import type { PluginHookContext, PluginServerContext } from "@getpaseo/plugin/server";
import {
  collectObservations,
  configFromEnv,
  formatRecall,
  providerId,
  recallQuery,
  sessionSummary,
  withRecall,
  type BridgeConfig,
  type Observation,
  type SearchHit,
} from "../shared/bridge";

const run = promisify(execFile);
const REQUEST_TIMEOUT_MS = 3_000;

/** Same rule as agentmemory's hooks: the git toplevel's basename, else the cwd's. */
export async function resolveProject(cwd: string): Promise<string> {
  const explicit = process.env.AGENTMEMORY_PROJECT_NAME?.trim();
  if (explicit) return explicit;
  try {
    const { stdout } = await run("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 500, encoding: "utf8" });
    const top = stdout.trim();
    if (top !== "") return basename(top);
  } catch {
    // not a git checkout, or git is missing; the directory name is what the hooks use too
  }
  return basename(cwd);
}

function headers(): Record<string, string> {
  const secret = process.env.AGENTMEMORY_SECRET?.trim();
  return secret ? { "Content-Type": "application/json", Authorization: `Bearer ${secret}` } : { "Content-Type": "application/json" };
}

async function request(url: string, path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<unknown> {
  try {
    const response = await fetch(`${url}${path}`, {
      method: init.method,
      headers: headers(),
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) as unknown as RequestInit["signal"],
    });
    if (!response.ok) {
      console.warn(`agentmemory ${path} -> ${response.status}`);
      return null;
    }
    return await response.json().catch(() => null);
  } catch (error) {
    // the hooks swallow failures too: memory must never block the agent
    console.warn(`agentmemory ${path} failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function post(url: string, path: string, body: unknown): Promise<void> {
  await request(url, path, { method: "POST", body });
}

// consolidation runs after the session ends and takes a while; check back with backoff
const SUMMARY_DELAYS_MS = [30_000, 60_000, 120_000, 300_000, 600_000];

export function createBridge(server: PluginServerContext, config: BridgeConfig = configFromEnv(process.env)) {
  // how many timeline items each agent has already reported
  const cursors = new Map<string, number>();

  async function captures(provider: string): Promise<BridgeConfig | null> {
    return config.providers.includes(providerId(provider)) ? config : null;
  }

  server.before("agent.create", async ({ request: create }) => {
    const prefs = await captures(create.config.provider);
    if (!prefs) return;
    const query = recallQuery({ title: create.config.title, cwd: create.config.cwd });
    if (query === "") return;
    const result = (await request(prefs.url, "/agentmemory/search", {
      method: "POST",
      body: { query, limit: 8 },
    })) as { results?: SearchHit[] } | null;
    const block = formatRecall(result?.results ?? []);
    if (block === null) return;
    console.log(`agentmemory: recalled context for "${query}"`);
    return { ...create, config: { ...create.config, systemPrompt: withRecall(create.config.systemPrompt, block) } };
  });

  server.on("agent.created", async ({ agent }) => {
    const prefs = await captures(agent.provider);
    if (!prefs) return;
    await post(prefs.url, "/agentmemory/session/start", {
      sessionId: agent.id,
      project: await resolveProject(agent.cwd),
      cwd: agent.cwd,
    });
  });

  server.on("agent.turn_ended", async ({ agent, timeline }, context) => {
    const prefs = await captures(agent.provider);
    if (!prefs) return;
    const { observations, seen } = collectObservations(timeline, cursors.get(agent.id) ?? 0, {
      prompts: true,
      tools: true,
    });
    cursors.set(agent.id, seen);
    const project = await resolveProject(agent.cwd);
    for (const observation of observations) {
      await post(prefs.url, "/agentmemory/observe", observe(agent.id, project, agent.cwd, observation));
    }
    // the Stop hook ends the session after every turn; the engine reopens it on the next observation
    await post(prefs.url, "/agentmemory/session/end", { sessionId: agent.id });
    scheduleSummary(agent.id, prefs, context);
  });

  const posted = new Map<string, string>();
  const timers = new Set<ReturnType<typeof setTimeout>>();

  function scheduleSummary(agentId: string, prefs: BridgeConfig, context: { paseo: PluginHookContext["paseo"] }, attempt = 0) {
    const delay = SUMMARY_DELAYS_MS[attempt];
    if (delay === undefined) return;
    const timer = setTimeout(async () => {
      timers.delete(timer);
      const listing = (await request(prefs.url, "/agentmemory/sessions?limit=100", { method: "GET" })) as
        | { sessions?: { id?: string }[] }
        | null;
      const session = listing?.sessions?.find((entry) => entry.id === agentId);
      const summary = sessionSummary(session);
      if (summary === null) {
        scheduleSummary(agentId, prefs, context, attempt + 1);
        return;
      }
      if (posted.get(agentId) === summary.createdAt) return;
      try {
        await context.paseo.agents.ref(agentId).timeline.append({
          type: "plugin",
          id: `memory-summary-${summary.createdAt}`,
          kind: "memory-summary",
          version: 1,
          data: summary,
        });
        posted.set(agentId, summary.createdAt);
        console.log(`agentmemory: appended summary row for ${agentId}`);
      } catch (error) {
        console.warn(`agentmemory: could not append summary row: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, delay);
    (timer as { unref?: () => void }).unref?.();
    timers.add(timer);
  }

  return () => {
    cursors.clear();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };
}

function observe(sessionId: string, project: string, cwd: string, observation: Observation) {
  return { ...observation, sessionId, project, cwd, timestamp: new Date().toISOString() };
}

