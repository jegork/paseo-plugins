import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { ChangedFile, ImpactReport, impactReportRpc } from "../shared/codegraph";
import { LIMITS, buildAffected, impactRootsIn, isFileIndexed, parseAffectedJson, parseImpactJson, parseNodeSymbols, pickSymbols, type FileImpact } from "../shared/parse";
import { codegraph, diffState, firstLine, mapLimit, resolveIndexRoot } from "./cli";

const CONCURRENCY = 4;

/** codegraph's built-in test detection misses pytest naming, so retry with it before giving up */
const TEST_GLOB_FALLBACKS = ["**/test_*.py", "**/*_test.*"];

const cache = new Map<string, ImpactReport>();

type Base = Pick<ImpactReport, "directory" | "indexRoot" | "baseRef" | "signature" | "errors" | "takenAt">;

function emptyReport(base: Base, changedFiles: ChangedFile[] = []): ImpactReport {
  return {
    ...base,
    indexed: base.indexRoot !== null,
    changedFiles,
    affectedCode: [],
    affectedTests: [],
    filesSkipped: 0,
    cached: false,
  };
}

async function symbolsOf(path: string, indexRoot: string, errors: string[]): Promise<ChangedFile> {
  const out = await codegraph(["node", "--file", path, "--symbols-only"], indexRoot);
  if (out.code !== 0) {
    errors.push(`codegraph node ${path}: ${firstLine(out.stderr)}`);
    return { path, indexed: false, symbols: [], skipped: 0 };
  }
  const { picked, skipped } = pickSymbols(parseNodeSymbols(out.stdout), LIMITS.symbolsPerFile);
  return {
    path,
    indexed: isFileIndexed(out.stdout),
    symbols: picked.map((symbol) => ({ name: symbol.name, kind: symbol.kind, filePath: path, startLine: symbol.line })),
    skipped,
  };
}

async function affectedTests(files: string[], indexRoot: string, errors: string[]): Promise<string[]> {
  const globs: (string | null)[] = [null, ...TEST_GLOB_FALLBACKS];
  for (const glob of globs) {
    const out = await codegraph(["affected", ...files, "--json", ...(glob === null ? [] : ["-f", glob])], indexRoot);
    if (out.code !== 0) {
      errors.push(`codegraph affected: ${firstLine(out.stderr)}`);
      return [];
    }
    const tests = parseAffectedJson(out.stdout);
    if (tests.length > 0) return tests;
  }
  return [];
}

export async function impactReport({ workspaceId, force }: RpcInput<typeof impactReportRpc>, context: PluginHandlerContext): Promise<ImpactReport> {
  const takenAt = new Date().toISOString();
  const errors: string[] = [];
  const handle = context.paseo.workspaces.ref(workspaceId);
  await handle.refresh();
  const directory = handle.directory;
  if (directory === null) {
    return emptyReport({ directory: null, indexRoot: null, baseRef: null, signature: "", errors: ["Workspace directory is unknown."], takenAt });
  }
  const [indexRoot, diff] = await Promise.all([resolveIndexRoot(directory), diffState(directory)]);
  const base: Base = { directory, indexRoot, baseRef: diff.baseRef, signature: diff.signature, errors, takenAt };
  if (indexRoot === null) {
    return emptyReport(base, diff.files.map((path) => ({ path, indexed: false, symbols: [], skipped: 0 })));
  }
  const previous = cache.get(workspaceId);
  if (force !== true && previous !== undefined && previous.signature === diff.signature && previous.indexRoot === indexRoot) {
    return { ...previous, cached: true };
  }

  const files = diff.files.slice(0, LIMITS.files);
  const changedFiles = await mapLimit(files, CONCURRENCY, (path) => symbolsOf(path, indexRoot, errors));
  const targets = changedFiles.flatMap((file) => file.symbols.map((symbol) => ({ file, symbol })));
  const impacts: FileImpact[] = [];
  const ambiguous = new Set<string>();
  await mapLimit(targets, CONCURRENCY, async ({ file, symbol }) => {
    const out = await codegraph(["impact", symbol.name, "--json", "-d", String(LIMITS.impactDepth)], indexRoot);
    if (out.code !== 0) {
      errors.push(`codegraph impact ${symbol.name}: ${firstLine(out.stderr)}`);
      return;
    }
    const parsed = parseImpactJson(out.stdout);
    if (parsed === null || !impactRootsIn(parsed, file.path)) {
      ambiguous.add(`${file.path}${symbol.name}`);
      return;
    }
    impacts.push({ filePath: file.path, symbol: symbol.name, impact: parsed });
  });
  // a symbol whose name resolved to another file says nothing about this change
  for (const file of changedFiles) {
    const kept = file.symbols.filter((symbol) => !ambiguous.has(`${file.path}${symbol.name}`));
    file.skipped += file.symbols.length - kept.length;
    file.symbols = kept;
  }
  const tests = files.length > 0 ? await affectedTests(files, indexRoot, errors) : [];
  const affected = buildAffected(impacts, tests);
  const report: ImpactReport = {
    ...base,
    indexed: true,
    changedFiles,
    affectedCode: affected.affectedCode,
    affectedTests: affected.affectedTests,
    filesSkipped: diff.files.length - files.length,
    cached: false,
  };
  cache.set(workspaceId, report);
  return report;
}
