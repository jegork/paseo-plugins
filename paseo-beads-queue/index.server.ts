import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import * as beads from "./server/beads";
import { defaultProject, findProject, loadConfig, saveConfig } from "./server/config";
import { Dispatcher } from "./server/dispatcher";
import { shellCommand } from "./server/inspect";
import {
  configGet, configRemoveProject, configSetGlobal, configSetProject,
  dispatchIssue, issueCreate, issueShow, issuesList, issueTransition, searchIssues,
  type ProjectConfig,
} from "./shared/beads";

function requireProject(root: string): ProjectConfig {
  const project = findProject(loadConfig(), root);
  if (!project) throw new Error("Beads is not enabled for this project. Enable it from the Beads panel first.");
  return project;
}

export default function contribute(server: PluginServerContext) {
  let dispatcher: Dispatcher | null = null;
  const workspaceRoots = new Map<string, string>();
  // the server context carries no paseo handle at load time, so the poll loop starts on the first rpc or hook
  const ensure = (paseo: PluginHandlerContext["paseo"]): Dispatcher => {
    if (!dispatcher) {
      dispatcher = new Dispatcher(paseo);
      dispatcher.start();
    }
    return dispatcher;
  };

  server.handle(configGet, (_input, { paseo }) => {
    const config = loadConfig();
    return { ...config, status: ensure(paseo).status() };
  });

  server.handle(configSetGlobal, (patch) => {
    const config = loadConfig();
    config.global = { ...config.global, ...patch };
    saveConfig(config);
    dispatcher?.reschedule();
    return config.global;
  });

  server.handle(configSetProject, async (patch) => {
    const config = loadConfig();
    const current = findProject(config, patch.root) ?? defaultProject(patch.root);
    const next = { ...current, ...patch };
    config.projects = [...config.projects.filter((p) => p.root !== patch.root), next];
    saveConfig(config);
    await beads.ensureInitialized(next);
    return next;
  });

  server.handle(configRemoveProject, ({ root }) => {
    const config = loadConfig();
    const before = config.projects.length;
    config.projects = config.projects.filter((p) => p.root !== root);
    saveConfig(config);
    return { removed: config.projects.length < before };
  });

  server.handle(issuesList, async ({ root }, { paseo }) => {
    const active = ensure(paseo).activeFor(root);
    const project = requireProject(root);
    const init = await beads.ensureInitialized(project);
    if (!init.initialized) throw new Error(`No .beads directory in ${root}. Run \`br init\` there, or switch the project to external mode.`);
    const [ready, inProgress, blocked, closed] = await Promise.all([
      beads.ready(project),
      beads.listByStatus(project, "in_progress"),
      beads.listByStatus(project, "blocked"),
      beads.listByStatus(project, "closed", 15),
    ]);
    const readyIds = new Set(ready.map((i) => i.id));
    return {
      beadsDir: init.dir,
      ready,
      inProgress,
      // open issues that are not ready are blocked by dependencies even when their status says open
      blocked: [...blocked, ...(await beads.listByStatus(project, "open")).filter((i) => !readyIds.has(i.id))],
      closed,
      active,
    };
  });

  server.handle(issueShow, ({ root, id }) => beads.show(requireProject(root), id));

  server.handle(issueCreate, ({ root, ...input }) => beads.create(requireProject(root), input));

  server.handle(issueTransition, async ({ root, id, action, reason }) => {
    const project = requireProject(root);
    const actor = loadConfig().global.actor;
    if (action === "close") await beads.close(project, id, reason ?? "Closed from Paseo", actor);
    if (action === "reopen") await beads.reopen(project, id);
    if (action === "block") await beads.setStatus(project, id, "blocked");
    return (await beads.show(project, id)).issue;
  });

  server.handle(dispatchIssue, async ({ root, id }, { paseo }) => {
    const config = loadConfig();
    const project = findProject(config, root);
    if (!project) throw new Error("Beads is not enabled for this project");
    return ensure(paseo).dispatch(config, project, id);
  });

  server.handle(searchIssues, async ({ query }) => {
    const config = loadConfig();
    const results = await Promise.all(
      config.projects.map(async (project) => {
        const issues = query.trim() ? await beads.search(project, query.trim()) : await beads.ready(project);
        return issues.slice(0, 10).map((issue) => ({
          id: `${project.root}::${issue.id}`,
          identifier: issue.id,
          title: issue.title,
          subtitle: `P${issue.priority} · ${issue.status} · ${project.root.split("/").pop() ?? ""}`,
          url: `file://${beads.beadsDir(project)}/issues.jsonl#${issue.id}`,
          text: beads.issueText(project, issue, []),
          resourceType: "beads-issue",
        }));
      }),
    );
    return { items: results.flat().slice(0, 25) };
  });

  // every agent in an external-mode project gets br pointed at the project's queue, worktrees included
  server.before("agent.session_open", async ({ request }, { paseo }) => {
    const config = loadConfig();
    if (config.projects.length === 0) return;
    let root = config.projects.find((p) => request.cwd === p.root || request.cwd.startsWith(`${p.root}/`))?.root;
    if (!root && request.workspaceId) {
      root = workspaceRoots.get(request.workspaceId);
      if (!root) {
        const snapshot = await paseo.workspaces.ref(request.workspaceId).refresh().catch(() => null);
        root = snapshot?.projectRootPath;
        if (root) workspaceRoots.set(request.workspaceId, root);
      }
    }
    const project = root ? findProject(config, root) : undefined;
    if (!project || project.mode !== "external") return;
    return { ...request, env: { ...request.env, ...beads.beadsEnv(project) } };
  });

  server.on("agent.turn_ended", async (event, { paseo }) => {
    await ensure(paseo).onTurnEnded(event.agent, event.outcome, event.timeline);
  });

  server.on("agent.created", (_event, { paseo }) => {
    ensure(paseo);
  });

  // dispatched agents must be able to comment on and close their issue without a human clicking allow,
  // and must never push: the human reviews the branch and pushes it under the generated name
  server.on("agent.permission_requested", async (event, { paseo }) => {
    if (!ensure(paseo).isTracked(event.agent.id)) return;
    const command = shellCommand(event.request);
    if (command === null) return;
    const agent = paseo.agents.ref(event.agent.id);
    if (/\bgit\s+push\b/.test(command)) {
      await agent.respondToPermission({
        requestId: event.request.id,
        response: { behavior: "deny", message: "Dispatched agents do not push. Commit on the branch and close the issue; the branch is pushed after review." },
      });
      return;
    }
    if (/^(RUST_LOG=\S+\s+)?br\s/.test(command.trim())) {
      await agent.respondToPermission({ requestId: event.request.id, response: { behavior: "allow" } });
    }
  });

  return () => {
    dispatcher?.stop();
  };
}
