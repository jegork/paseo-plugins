import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginAttachmentItem, PluginAttachmentSearchPayload, RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { searchSymbolsRpc } from "../shared/codegraph";
import { LIMITS, parseQueryJson, truncateText, type QueryHit } from "../shared/parse";
import { codegraph, firstLine, mapLimit, resolveIndexRoot } from "./cli";

const EXPLORE_TTL_MS = 60_000;
const EXPLORE_CACHE_MAX = 200;
const CONCURRENCY = 4;

interface IndexedProject {
  root: string;
  name: string;
}

/**
 * The composer does not say which workspace it belongs to, so the search
 * covers every project with an open workspace, one query per project. A
 * project's worktrees share its symbols, so the main checkout's index is
 * preferred and a worktree's own index is only a fallback.
 */
async function indexedProjects(context: PluginHandlerContext): Promise<{ projects: IndexedProject[]; directories: string[] }> {
  const page = await context.paseo.workspaces.list();
  const candidates = new Map<string, { name: string; directories: string[] }>();
  const directories: string[] = [];
  for (const workspace of page.entries) {
    if (workspace.archivingAt !== null && workspace.archivingAt !== undefined) continue;
    const directory = workspace.workspaceDirectory ?? workspace.projectRootPath;
    directories.push(directory);
    const project = candidates.get(workspace.projectId) ?? { name: workspace.projectCustomName ?? workspace.projectDisplayName, directories: [workspace.projectRootPath] };
    project.directories.push(directory);
    candidates.set(workspace.projectId, project);
  }
  const projects = new Map<string, IndexedProject>();
  for (const { name, directories: dirs } of candidates.values()) {
    for (const dir of dirs) {
      const root = await resolveIndexRoot(dir);
      if (root === null) continue;
      if (!projects.has(root)) projects.set(root, { root, name });
      break;
    }
  }
  return { projects: [...projects.values()], directories };
}

const exploreCache = new Map<string, { at: number; text: string }>();

async function explore(root: string, name: string): Promise<string> {
  const key = `${root}${name}`;
  const hit = exploreCache.get(key);
  if (hit !== undefined && Date.now() - hit.at < EXPLORE_TTL_MS) return hit.text;
  const out = await codegraph(["explore", name, "--max-files", "6"], root);
  const text = out.code === 0 ? truncateText(out.stdout.trim(), LIMITS.exploreBytes) : `codegraph explore failed: ${firstLine(out.stderr)}`;
  if (exploreCache.size >= EXPLORE_CACHE_MAX) {
    const oldest = exploreCache.keys().next().value;
    if (oldest !== undefined) exploreCache.delete(oldest);
  }
  exploreCache.set(key, { at: Date.now(), text });
  return text;
}

function notIndexed(directory: string): PluginAttachmentItem {
  const text = [
    `No CodeGraph index was found for any open workspace (checked ${directory} and its main checkout).`,
    "CodeGraph keeps a per-project index in .codegraph/. To create one, run this in the project root:",
    "",
    "    codegraph init",
    "",
    "Indexing is the project owner's decision; the plugin never runs it.",
  ].join("\n");
  return {
    id: "not-indexed",
    identifier: "codegraph:",
    title: "No code graph index",
    subtitle: "Run `codegraph init` in the project root",
    url: pathToFileURL(directory).href,
    text,
    resourceType: "notice",
  };
}

function toItem(hit: QueryHit, project: IndexedProject, manyProjects: boolean, snapshot: string): PluginAttachmentItem {
  const location = `${hit.filePath}:${hit.startLine}`;
  const header = [`codegraph: ${hit.name}`, `${hit.kind} at ${location}${manyProjects ? ` in ${project.name}` : ""} (index: ${project.root})`];
  if (hit.signature !== null) header.push(`signature: ${hit.signature.replace(/\s+/g, " ").trim()}`);
  return {
    id: `${project.root}:${location}:${hit.name}`,
    identifier: "codegraph:",
    title: hit.name,
    subtitle: `${hit.kind} · ${location}${manyProjects ? ` · ${project.name}` : ""}`,
    url: `${pathToFileURL(join(project.root, hit.filePath)).href}#L${hit.startLine}`,
    text: `${header.join("\n")}\n\n${snapshot}`,
    resourceType: "symbol",
  };
}

export async function searchSymbols({ query }: RpcInput<typeof searchSymbolsRpc>, context: PluginHandlerContext): Promise<PluginAttachmentSearchPayload> {
  const text = query.trim();
  const { projects, directories } = await indexedProjects(context);
  if (projects.length === 0) return { items: [notIndexed(directories[0] ?? process.cwd())] };
  if (text === "") return { items: [] };

  const perProject = await Promise.all(
    projects.map(async (project) => {
      const out = await codegraph(["query", text, "--json", "-l", String(LIMITS.queryLimit)], project.root);
      if (out.code !== 0) {
        console.error(`codegraph query in ${project.root}: ${firstLine(out.stderr)}`);
        return [];
      }
      return parseQueryJson(out.stdout).map((hit) => ({ hit, project }));
    }),
  );
  const hits = perProject
    .flat()
    .sort((a, b) => b.hit.score - a.hit.score)
    .slice(0, LIMITS.queryLimit);

  // explore is per name, so hits sharing a name share one snapshot
  const keys = [...new Set(hits.map(({ hit, project }) => `${project.root}${hit.name}`))];
  const snapshots = new Map<string, string>();
  await mapLimit(keys, CONCURRENCY, async (key) => {
    const [root, name] = key.split("") as [string, string];
    snapshots.set(key, await explore(root, name));
  });
  return {
    items: hits.map(({ hit, project }) => toItem(hit, project, projects.length > 1, snapshots.get(`${project.root}${hit.name}`) ?? "")),
  };
}
