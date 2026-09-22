import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  attribute,
  parseDockerPs,
  parseLsofCwds,
  parseLsofListeners,
  refuseReason,
  withoutPublishedPorts,
  type ActionResultSchema,
  type Container,
  type ContainerRow,
  type Listener,
  type ProjectRef,
  type RuntimeSnapshot,
  type Socket,
  type WorkspaceRef,
  containerActionRpc,
  signalProcessRpc,
} from "../shared/runtime";
import type { z } from "zod";

type ActionResult = z.output<typeof ActionResultSchema>;

const run = promisify(execFile);

async function runTool(command: string, args: string[]): Promise<string> {
  const { stdout } = await run(command, args, {
    encoding: "utf8",
    timeout: 8_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout;
}

// lsof exits 1 when nothing matches, which is a valid empty answer
function isEmptyMatch(error: unknown): boolean {
  return typeof error === "object" && error !== null && Reflect.get(error, "code") === 1;
}

type Scopes = { workspaces: WorkspaceRef[]; projects: ProjectRef[] };

async function listScopes(context: PluginHandlerContext): Promise<Scopes> {
  const page = await context.paseo.workspaces.list();
  const workspaces: WorkspaceRef[] = [];
  const projects = new Map<string, ProjectRef>();
  for (const workspace of page.entries) {
    projects.set(workspace.projectId, {
      id: workspace.projectId,
      name: workspace.projectCustomName ?? workspace.projectDisplayName,
      rootPath: workspace.projectRootPath,
    });
    if (workspace.archivingAt !== null && workspace.archivingAt !== undefined) continue;
    workspaces.push({
      id: workspace.id,
      name: workspace.title ?? workspace.name,
      directory: workspace.workspaceDirectory ?? workspace.projectRootPath,
    });
  }
  // projects with no workspace at all still own directories worth naming
  try {
    const listed = await context.paseo.projects.list();
    for (const project of listed.projects) {
      if (!projects.has(project.projectId)) {
        projects.set(project.projectId, {
          id: project.projectId,
          name: project.projectCustomName ?? project.projectDisplayName,
          rootPath: project.projectRootPath,
        });
      }
    }
  } catch {
    // older daemons have no project listing; workspace-derived projects suffice
  }
  return { workspaces, projects: [...projects.values()] };
}

function attributeBoth(path: string | null, scopes: Scopes): { workspaceId: string | null; projectId: string | null } {
  return {
    workspaceId: attribute(path, scopes.workspaces),
    projectId: attribute(path, scopes.projects.map((project) => ({ id: project.id, directory: project.rootPath }))),
  };
}

async function listSockets(errors: string[]): Promise<Socket[]> {
  let sockets: Socket[];
  try {
    sockets = parseLsofListeners(await runTool("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"]));
  } catch (error) {
    if (isEmptyMatch(error)) return [];
    errors.push(`lsof: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
  return sockets;
}

async function resolveListeners(sockets: Socket[], scopes: Scopes, errors: string[]): Promise<Listener[]> {
  const pids = [...new Set(sockets.map((socket) => socket.pid))];
  let cwds = new Map<number, string>();
  if (pids.length > 0) {
    try {
      cwds = parseLsofCwds(await runTool("lsof", ["-a", "-d", "cwd", "-p", pids.join(","), "-F", "pn"]));
    } catch (error) {
      // a process owned by another user hides its cwd; the port still shows, unassigned
      if (!isEmptyMatch(error)) errors.push(`lsof cwd: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return sockets.map((socket) => {
    const cwd = cwds.get(socket.pid) ?? null;
    return { ...socket, cwd, ...attributeBoth(cwd, scopes) };
  });
}

async function listContainerRows(errors: string[]): Promise<ContainerRow[]> {
  try {
    return parseDockerPs(await runTool("docker", ["ps", "--format", "{{json .}}"]));
  } catch (error) {
    errors.push(`docker: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    return [];
  }
}

export async function snapshotRuntime(_input: object, context: PluginHandlerContext): Promise<RuntimeSnapshot> {
  const errors: string[] = [];
  const [scopes, sockets, rows] = await Promise.all([listScopes(context), listSockets(errors), listContainerRows(errors)]);
  const listeners = await resolveListeners(withoutPublishedPorts(sockets, rows), scopes, errors);
  const containers: Container[] = rows.map((row) => ({ ...row, ...attributeBoth(row.workingDir, scopes) }));
  return { ...scopes, listeners, containers, errors, takenAt: new Date().toISOString() };
}

/**
 * Only a process the panel just showed can be signalled: it must still be
 * listening, and it must not be the daemon this plugin runs under. The
 * second `lsof` is the check, not a cached snapshot the panel could be stale on.
 */
export async function signalProcess({ pid, signal }: RpcInput<typeof signalProcessRpc>): Promise<ActionResult> {
  const self = { pid: process.pid, ppid: process.ppid };
  let sockets: Socket[] = [];
  if (refuseReason(pid, [], self) !== "That process is Paseo itself.") {
    try {
      // -a ANDs the selectors; without it lsof lists every listener on the machine
      sockets = parseLsofListeners(await runTool("lsof", ["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN", "-F", "pcn"]));
    } catch (error) {
      if (!isEmptyMatch(error)) return { ok: false, message: `lsof: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  const refused = refuseReason(pid, sockets, self);
  if (refused !== null) return { ok: false, message: refused };
  try {
    process.kill(pid, signal === "KILL" ? "SIGKILL" : "SIGTERM");
  } catch (error) {
    const code = typeof error === "object" && error !== null ? Reflect.get(error, "code") : null;
    if (code === "EPERM") return { ok: false, message: `pid ${pid} belongs to another user.` };
    if (code === "ESRCH") return { ok: false, message: `pid ${pid} already exited.` };
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, message: signal === "KILL" ? `Killed pid ${pid}.` : `Asked pid ${pid} to stop.` };
}

export async function containerAction({ id, action }: RpcInput<typeof containerActionRpc>): Promise<ActionResult> {
  try {
    await run("docker", [action, id], { encoding: "utf8", timeout: 30_000 });
  } catch (error) {
    const stderr = typeof error === "object" && error !== null ? String(Reflect.get(error, "stderr") ?? "") : "";
    return { ok: false, message: (stderr.trim() || (error instanceof Error ? error.message : String(error))).split("\n")[0] ?? "docker failed" };
  }
  return { ok: true, message: action === "stop" ? `Stopped ${id.slice(0, 12)}.` : `Restarted ${id.slice(0, 12)}.` };
}
