import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const WorkspaceRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  directory: z.string(),
});

export const ProjectRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  rootPath: z.string(),
});

export const ListenerSchema = z.object({
  port: z.number().int(),
  address: z.string(),
  pid: z.number().int(),
  command: z.string(),
  cwd: z.string().nullable(),
  workspaceId: z.string().nullable(),
  projectId: z.string().nullable(),
});

export const ContainerSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string(),
  status: z.string(),
  ports: z.array(z.string()),
  project: z.string().nullable(),
  workingDir: z.string().nullable(),
  workspaceId: z.string().nullable(),
  projectId: z.string().nullable(),
});

export const RuntimeSnapshotSchema = z.object({
  workspaces: z.array(WorkspaceRefSchema),
  projects: z.array(ProjectRefSchema),
  listeners: z.array(ListenerSchema),
  containers: z.array(ContainerSchema),
  errors: z.array(z.string()),
  takenAt: z.string(),
});

export type WorkspaceRef = z.output<typeof WorkspaceRefSchema>;
export type ProjectRef = z.output<typeof ProjectRefSchema>;
export type Listener = z.output<typeof ListenerSchema>;
export type Container = z.output<typeof ContainerSchema>;
export type RuntimeSnapshot = z.output<typeof RuntimeSnapshotSchema>;

export const runtimeSnapshotRpc = defineRpc({
  name: "runtime.snapshot",
  input: z.object({}),
  output: RuntimeSnapshotSchema,
});

export const ActionResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
});

/** SIGTERM asks a dev server to exit; SIGKILL is for the one that ignores it. */
export const signalProcessRpc = defineRpc({
  name: "runtime.signal",
  input: z.object({ pid: z.number().int().positive(), signal: z.enum(["TERM", "KILL"]) }),
  output: ActionResultSchema,
});

export const containerActionRpc = defineRpc({
  name: "runtime.container",
  input: z.object({ id: z.string().regex(/^[a-f0-9]{6,64}$/), action: z.enum(["stop", "restart"]) }),
  output: ActionResultSchema,
});

export const preferences = defineSettings({
  id: "display",
  scope: "host",
  version: 1,
  schema: z.object({
    groupBy: z.enum(["workspace", "project", "kind"]).default("workspace"),
    allowActions: z.boolean().default(true),
  }),
});

/**
 * `lsof -nP -iTCP -sTCP:LISTEN -F pcn` prints one field per line: `p<pid>`
 * starts a process, `c<command>` names it, and each `n<addr>:<port>` is a
 * socket it listens on. A process listening on several ports repeats `n`.
 */
export type Socket = Pick<Listener, "port" | "address" | "pid" | "command">;

export function parseLsofListeners(output: string): Socket[] {
  const out: Socket[] = [];
  let pid: number | null = null;
  let command = "";
  const seen = new Set<string>();
  for (const line of output.split("\n")) {
    const tag = line[0];
    const value = line.slice(1);
    if (tag === "p") {
      pid = Number.parseInt(value, 10);
      command = "";
    } else if (tag === "c") {
      command = value;
    } else if (tag === "n" && pid !== null) {
      const colon = value.lastIndexOf(":");
      if (colon === -1) continue;
      const port = Number.parseInt(value.slice(colon + 1), 10);
      if (!Number.isInteger(port)) continue;
      const address = value.slice(0, colon);
      const key = `${pid}:${address}:${port}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ port, address, pid, command });
    }
  }
  return out.sort((a, b) => a.port - b.port || a.pid - b.pid);
}

/** `lsof -a -d cwd -p <pids> -F pn` prints `p<pid>` then `n<path>` per process. */
export function parseLsofCwds(output: string): Map<number, string> {
  const cwds = new Map<number, string>();
  let pid: number | null = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) pid = Number.parseInt(line.slice(1), 10);
    else if (line.startsWith("n") && pid !== null) cwds.set(pid, line.slice(1));
  }
  return cwds;
}

const COMPOSE_DIR = "com.docker.compose.project.working_dir";
const COMPOSE_PROJECT = "com.docker.compose.project";

function labelsOf(raw: string): Map<string, string> {
  const labels = new Map<string, string>();
  if (raw === "") return labels;
  for (const pair of raw.split(",")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    labels.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  return labels;
}

/** One line of `docker ps --format '{{json .}}'` per container. */
export type ContainerRow = Omit<Container, "workspaceId" | "projectId">;

export function parseDockerPs(output: string): ContainerRow[] {
  const containers: ContainerRow[] = [];
  for (const line of output.split("\n")) {
    if (line.trim() === "") continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const labels = labelsOf(typeof row.Labels === "string" ? row.Labels : "");
    const ports = typeof row.Ports === "string" && row.Ports !== "" ? row.Ports.split(", ") : [];
    containers.push({
      id: String(row.ID ?? ""),
      name: String(row.Names ?? ""),
      image: String(row.Image ?? ""),
      status: String(row.Status ?? ""),
      ports,
      project: labels.get(COMPOSE_PROJECT) ?? null,
      workingDir: labels.get(COMPOSE_DIR) ?? null,
    });
  }
  return containers;
}

function normalize(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/**
 * The workspace whose directory contains the path, preferring the deepest
 * match so a worktree under a project root wins over the root itself.
 */
export function attribute(path: string | null, scopes: { id: string; directory: string }[]): string | null {
  if (path === null) return null;
  const target = normalize(path);
  let best: { id: string; directory: string } | null = null;
  for (const scope of scopes) {
    const dir = normalize(scope.directory);
    if (target === dir || target.startsWith(`${dir}/`)) {
      if (best === null || dir.length > normalize(best.directory).length) best = scope;
    }
  }
  return best?.id ?? null;
}

/** Host ports a container publishes, from docker's `0.0.0.0:5434->5432/tcp` notation. */
export function publishedPorts(containers: ContainerRow[]): Set<number> {
  const ports = new Set<number>();
  for (const container of containers) {
    for (const mapping of container.ports) {
      const arrow = mapping.indexOf("->");
      if (arrow === -1) continue;
      const host = mapping.slice(0, arrow);
      const range = host.slice(host.lastIndexOf(":") + 1);
      const [from, to = from] = range.split("-").map((value) => Number.parseInt(value, 10));
      if (!Number.isInteger(from) || !Number.isInteger(to)) continue;
      for (let port = from; port <= to; port += 1) ports.add(port);
    }
  }
  return ports;
}

/**
 * Docker's proxy holds every published port on the host, so without this the
 * same service shows twice: once as the container and once as an unattributed
 * `OrbStack Helper` or `com.docker.backend` listener.
 */
export function withoutPublishedPorts(sockets: Socket[], containers: ContainerRow[]): Socket[] {
  const published = publishedPorts(containers);
  return sockets.filter((socket) => !published.has(socket.port));
}

/**
 * Why a pid may not be signalled, or null when it may. The socket list must
 * come from an `lsof -a -p <pid>` query so it describes that process alone;
 * any Paseo process is refused by name as a second line of defence.
 */
export function refuseReason(pid: number, sockets: Socket[], self: { pid: number; ppid: number }): string | null {
  if (pid <= 1 || pid === self.pid || pid === self.ppid) return "That process is Paseo itself.";
  const own = sockets.filter((socket) => socket.pid === pid);
  if (own.length === 0) return `pid ${pid} is not listening on any port any more.`;
  if (own.some((socket) => /paseo/i.test(socket.command))) return "That process is Paseo itself.";
  return null;
}
