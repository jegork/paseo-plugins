import type { AffectedFile, Dependent, SymbolRef } from "./codegraph";

export const LIMITS = {
  files: 40,
  symbolsPerFile: 12,
  impactDepth: 2,
  exploreBytes: 24 * 1024,
  queryLimit: 20,
};

export interface QueryHit extends SymbolRef {
  signature: string | null;
  score: number;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asSymbolRef(value: unknown): SymbolRef | null {
  const row = asObject(value);
  if (row === null) return null;
  const startLine = Number(row.startLine);
  if (typeof row.name !== "string" || typeof row.filePath !== "string" || !Number.isInteger(startLine)) return null;
  return { name: row.name, kind: typeof row.kind === "string" ? row.kind : "symbol", filePath: row.filePath, startLine };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** `codegraph query <text> --json` prints an array of `{ node, score }`; anything else is no hits. */
export function parseQueryJson(text: string): QueryHit[] {
  const rows = parseJson(text);
  if (!Array.isArray(rows)) return [];
  const hits: QueryHit[] = [];
  for (const row of rows) {
    const entry = asObject(row);
    const node = asObject(entry?.node);
    const ref = asSymbolRef(node);
    if (entry === null || ref === null) continue;
    const score = Number(entry.score);
    hits.push({
      ...ref,
      signature: typeof node?.signature === "string" ? node.signature : null,
      score: Number.isFinite(score) ? score : 0,
    });
  }
  return hits;
}

export interface NodeSymbol {
  name: string;
  kind: string;
  line: number;
}

/**
 * `codegraph node --file <f> --symbols-only` lists one symbol per bullet:
 * `- \`name\` (kind) [= value | signature] — :line`. A file the index does not
 * know produces prose with no bullets, which parses as no symbols.
 */
export function parseNodeSymbols(text: string): NodeSymbol[] {
  const symbols: NodeSymbol[] = [];
  const pattern = /^- `([^`]+)` \(([^)]+)\).*— :(\d+)\s*$/;
  for (const line of text.split("\n")) {
    const match = pattern.exec(line);
    if (match === null) continue;
    symbols.push({ name: match[1] as string, kind: match[2] as string, line: Number.parseInt(match[3] as string, 10) });
  }
  return symbols;
}

export function isFileIndexed(nodeOutput: string): boolean {
  return !nodeOutput.trimStart().startsWith("No indexed file matches");
}

export interface ImpactResult {
  symbol: string;
  affected: SymbolRef[];
}

/** `codegraph impact <symbol> --json`; an unknown symbol prints an info line instead of JSON. */
export function parseImpactJson(text: string): ImpactResult | null {
  const body = asObject(parseJson(text));
  if (body === null || typeof body.symbol !== "string" || !Array.isArray(body.affected)) return null;
  const affected: SymbolRef[] = [];
  for (const row of body.affected) {
    const ref = asSymbolRef(row);
    if (ref !== null) affected.push(ref);
  }
  return { symbol: body.symbol, affected };
}

/** `codegraph affected <files> --json` → its `affectedTests` paths. */
export function parseAffectedJson(text: string): string[] {
  const body = asObject(parseJson(text));
  if (body === null || !Array.isArray(body.affectedTests)) return [];
  return body.affectedTests.filter((entry): entry is string => typeof entry === "string");
}

function unquote(path: string): string {
  return path.length > 1 && path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path;
}

/**
 * Tracked changes come from `git diff --name-only <merge-base>`; untracked files
 * from `git status --porcelain` rows starting with `??`. Paths are unique and sorted.
 */
export function parseChangedFiles(diffNames: string, porcelain: string): string[] {
  const files = new Set<string>();
  for (const line of diffNames.split("\n")) {
    const path = unquote(line.trim());
    if (path !== "") files.add(path);
  }
  for (const line of porcelain.split("\n")) {
    if (!line.startsWith("?? ")) continue;
    const path = unquote(line.slice(3).trim());
    if (path !== "" && !path.endsWith("/")) files.add(path);
  }
  return [...files].sort();
}

const TEST_PATH = /(^|\/)(tests?|__tests__|specs?)\/|(^|\/)test_[^/]*$|_test\.[^/]+$|\.(test|spec)\.[^/]+$|(^|\/)conftest\.py$/;

export function isTestPath(path: string): boolean {
  return TEST_PATH.test(path);
}

const ANALYZABLE_KINDS = new Set(["function", "method", "class"]);

/**
 * Which of a file's symbols get an impact query: callables and classes only,
 * no dunder methods (impact resolves by bare name, so `__init__` lands on an
 * arbitrary file), capped per file.
 */
export function pickSymbols(symbols: NodeSymbol[], cap: number): { picked: NodeSymbol[]; skipped: number } {
  const eligible = symbols.filter((symbol) => ANALYZABLE_KINDS.has(symbol.kind) && !/^__\w+__$/.test(symbol.name));
  return { picked: eligible.slice(0, cap), skipped: Math.max(0, eligible.length - cap) };
}

/** impact resolves by bare name; its answer only counts when the root sits in the changed file. */
export function impactRootsIn(impact: ImpactResult, filePath: string): boolean {
  return impact.affected.some((node) => node.name === impact.symbol && node.filePath === filePath);
}

export interface FileImpact {
  filePath: string;
  symbol: string;
  impact: ImpactResult;
}

const SEP = "";

function sortFiles(groups: Map<string, Dependent[]>): AffectedFile[] {
  return [...groups.entries()]
    .map(([filePath, dependents]) => ({ filePath, dependents: dependents.sort((a, b) => a.startLine - b.startLine) }))
    .sort((a, b) => b.dependents.length - a.dependents.length || a.filePath.localeCompare(b.filePath));
}

/**
 * Every node any changed symbol reaches, minus the changed symbols themselves,
 * deduped and grouped by file. Nodes in test files form the tests section,
 * together with files `codegraph affected` named that no graph walk reached.
 */
export function buildAffected(impacts: FileImpact[], affectedTests: string[]): { affectedCode: AffectedFile[]; affectedTests: AffectedFile[] } {
  const roots = new Set(impacts.map(({ filePath, symbol }) => `${filePath}${SEP}${symbol}`));
  const nodes = new Map<string, Dependent>();
  for (const { symbol, impact } of impacts) {
    for (const node of impact.affected) {
      if (roots.has(`${node.filePath}${SEP}${node.name}`)) continue;
      const key = `${node.filePath}${SEP}${node.name}${SEP}${node.startLine}`;
      const existing = nodes.get(key);
      if (existing) {
        if (!existing.via.includes(symbol)) existing.via.push(symbol);
      } else {
        nodes.set(key, { ...node, via: [symbol] });
      }
    }
  }
  const code = new Map<string, Dependent[]>();
  const tests = new Map<string, Dependent[]>();
  for (const node of nodes.values()) {
    const bucket = isTestPath(node.filePath) ? tests : code;
    const list = bucket.get(node.filePath) ?? [];
    list.push(node);
    bucket.set(node.filePath, list);
  }
  for (const path of affectedTests) {
    if (!tests.has(path)) tests.set(path, []);
  }
  return { affectedCode: sortFiles(code), affectedTests: sortFiles(tests) };
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Keeps roughly the first `limit` bytes and says how much was dropped. */
export function truncateText(text: string, limit: number): string {
  const total = byteLength(text);
  if (total <= limit) return text;
  let cut = text.slice(0, limit);
  while (byteLength(cut) > limit) cut = cut.slice(0, Math.floor(cut.length * 0.95));
  const lastBreak = cut.lastIndexOf("\n");
  if (lastBreak > limit / 2) cut = cut.slice(0, lastBreak);
  return `${cut}\n\n[truncated ${total - byteLength(cut)} bytes; run \`codegraph explore\` for the rest]`;
}
