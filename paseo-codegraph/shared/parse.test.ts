import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  buildAffected,
  impactRootsIn,
  isFileIndexed,
  isTestPath,
  parseAffectedJson,
  parseChangedFiles,
  parseImpactJson,
  parseNodeSymbols,
  parseQueryJson,
  pickSymbols,
  truncateText,
  type ImpactResult,
} from "./parse";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

describe("parseQueryJson", () => {
  test("reads name, kind, file and line from each hit, keeping the score order", () => {
    const hits = parseQueryJson(fixture("query-user.json"));
    expect(hits).toHaveLength(5);
    expect(hits[0]).toMatchObject({ name: "User", kind: "class", filePath: "powerbyai_backend/users/entities/user.py", startLine: 32, signature: null });
    expect(hits[1]?.signature).toContain("AsyncGenerator[entities.User]");
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? 0);
  });

  test("no hits and non-JSON error text both parse as empty", () => {
    expect(parseQueryJson(fixture("query-empty.json"))).toEqual([]);
    expect(parseQueryJson(fixture("query-not-initialized.txt"))).toEqual([]);
    expect(parseQueryJson("")).toEqual([]);
  });

  test("drops malformed rows instead of failing the whole search", () => {
    const text = JSON.stringify([{ node: { name: "ok", kind: "function", filePath: "a.py", startLine: 3 }, score: 1 }, { node: { name: "no-line", filePath: "b.py" } }, { score: 2 }, null]);
    expect(parseQueryJson(text).map((hit) => hit.name)).toEqual(["ok"]);
  });
});

describe("parseNodeSymbols", () => {
  test("reads every bullet including variables with values and multi-line signatures", () => {
    const symbols = parseNodeSymbols(fixture("node-file-workos.txt"));
    expect(symbols).toHaveLength(9);
    expect(symbols[0]).toEqual({ name: "logger", kind: "variable", line: 16 });
    expect(symbols[1]).toEqual({ name: "WorkOSAuthProvider", kind: "class", line: 19 });
    expect(symbols[4]).toEqual({ name: "get_authorization_url", kind: "method", line: 49 });
    expect(symbols[8]).toEqual({ name: "verify_access_token", kind: "method", line: 154 });
  });

  test("a single-symbol file and an unknown file", () => {
    expect(parseNodeSymbols(fixture("node-file-user.txt"))).toEqual([{ name: "User", kind: "class", line: 32 }]);
    expect(parseNodeSymbols(fixture("node-file-missing.txt"))).toEqual([]);
    expect(isFileIndexed(fixture("node-file-missing.txt"))).toBe(false);
    expect(isFileIndexed(fixture("node-file-user.txt"))).toBe(true);
  });
});

describe("parseImpactJson", () => {
  test("reads the root symbol and every affected node", () => {
    const impact = parseImpactJson(fixture("impact-upsert-user.json"));
    expect(impact?.symbol).toBe("_upsert_user");
    expect(impact?.affected).toHaveLength(11);
    expect(impact?.affected[2]).toEqual({ name: "workos_callback", kind: "function", filePath: "powerbyai_backend/auth/routers/workos_auth.py", startLine: 83 });
  });

  test("an unknown symbol prints an info line, not JSON", () => {
    expect(parseImpactJson(fixture("impact-not-found.txt"))).toBeNull();
    expect(parseImpactJson("{}")).toBeNull();
  });
});

describe("parseAffectedJson", () => {
  test("returns the affected test paths", () => {
    const tests = parseAffectedJson(fixture("affected-tests.json"));
    expect(tests).toHaveLength(272);
    expect(tests).toContain("tests/integration/auth/test_workos_service.py");
  });

  test("no tests, and non-JSON, are both empty", () => {
    expect(parseAffectedJson(fixture("affected-empty.json"))).toEqual([]);
    expect(parseAffectedJson("ℹ No files provided.")).toEqual([]);
  });
});

describe("parseChangedFiles", () => {
  test("merges tracked and untracked files, deduped and sorted", () => {
    const diff = "src/b.py\nsrc/a.py\nsrc/b.py\n";
    const porcelain = " M src/a.py\n?? src/new.py\n?? docs/\nA  src/staged.py\n?? \"src/with space.py\"\n";
    expect(parseChangedFiles(diff, porcelain)).toEqual(["src/a.py", "src/b.py", "src/new.py", "src/with space.py"]);
  });

  test("real git output: a modified tracked file plus an untracked one", () => {
    expect(parseChangedFiles(fixture("git-diff-names.txt"), fixture("git-status-porcelain.txt"))).toEqual([
      "powerbyai_backend/auth/providers/workos.py",
      "powerbyai_backend/scratch/verify_tmp.py",
    ]);
  });

  test("empty output means no changes", () => {
    expect(parseChangedFiles("", "")).toEqual([]);
    expect(parseChangedFiles("\n", "\n")).toEqual([]);
  });
});

describe("isTestPath", () => {
  test("recognises python, javascript and go conventions", () => {
    for (const path of ["tests/integration/auth/test_x.py", "pkg/test_x.py", "pkg/x_test.go", "src/x.test.ts", "src/x.spec.tsx", "src/__tests__/x.ts", "tests/conftest.py", "spec/models/x_spec.rb"]) {
      expect(isTestPath(path), path).toBe(true);
    }
  });

  test("does not match source that merely mentions test", () => {
    for (const path of ["src/latest.py", "src/contest/x.py", "src/testing_utils.py", "src/attest.ts"]) {
      expect(isTestPath(path), path).toBe(false);
    }
  });
});

describe("pickSymbols", () => {
  test("keeps callables and classes, drops variables and dunders, caps and counts the rest", () => {
    const symbols = parseNodeSymbols(fixture("node-file-workos.txt"));
    const { picked, skipped } = pickSymbols(symbols, 3);
    expect(picked.map((s) => s.name)).toEqual(["WorkOSAuthProvider", "resolve_user", "get_authorization_url"]);
    expect(skipped).toBe(4);
  });

  test("a cap above the eligible count skips nothing", () => {
    expect(pickSymbols([{ name: "a", kind: "function", line: 1 }, { name: "x", kind: "import", line: 2 }], 5)).toEqual({ picked: [{ name: "a", kind: "function", line: 1 }], skipped: 0 });
  });
});

describe("impactRootsIn", () => {
  test("accepts the result only when the root lives in the changed file", () => {
    const impact = parseImpactJson(fixture("impact-upsert-user.json")) as ImpactResult;
    expect(impactRootsIn(impact, "powerbyai_backend/auth/providers/workos.py")).toBe(true);
    expect(impactRootsIn(impact, "powerbyai_backend/other/workos.py")).toBe(false);
  });
});

describe("buildAffected", () => {
  const workos = "powerbyai_backend/auth/providers/workos.py";
  const upsert = parseImpactJson(fixture("impact-upsert-user.json")) as ImpactResult;

  test("splits dependents into code and tests, excluding the changed symbols", () => {
    const { affectedCode, affectedTests } = buildAffected([{ filePath: workos, symbol: "_upsert_user", impact: upsert }], []);
    expect(affectedCode.map((f) => f.filePath)).toEqual([workos, "powerbyai_backend/auth/routers/workos_auth.py"]);
    expect(affectedCode[0]?.dependents.map((d) => d.name)).toEqual(["authenticate_with_code"]);
    expect(affectedTests).toHaveLength(1);
    expect(affectedTests[0]?.dependents).toHaveLength(8);
    expect(affectedTests[0]?.dependents[0]).toMatchObject({ name: "test_links_existing_user_by_workos_id", startLine: 25, via: ["_upsert_user"] });
  });

  test("a node reached from two changed symbols appears once with both in via", () => {
    const second: ImpactResult = {
      symbol: "authenticate_with_code",
      affected: [
        { name: "authenticate_with_code", kind: "method", filePath: workos, startLine: 66 },
        { name: "workos_callback", kind: "function", filePath: "powerbyai_backend/auth/routers/workos_auth.py", startLine: 83 },
      ],
    };
    const { affectedCode } = buildAffected(
      [
        { filePath: workos, symbol: "_upsert_user", impact: upsert },
        { filePath: workos, symbol: "authenticate_with_code", impact: second },
      ],
      [],
    );
    // authenticate_with_code is now itself a changed symbol, so it leaves the dependents
    expect(affectedCode.map((f) => f.filePath)).toEqual(["powerbyai_backend/auth/routers/workos_auth.py"]);
    expect(affectedCode[0]?.dependents).toEqual([{ name: "workos_callback", kind: "function", filePath: "powerbyai_backend/auth/routers/workos_auth.py", startLine: 83, via: ["_upsert_user", "authenticate_with_code"] }]);
  });

  test("tests named by codegraph affected are added once, without dependents", () => {
    const named = ["tests/integration/auth/test_workos_service.py", "tests/unit/core/auth/test_workos_service.py"];
    const { affectedTests } = buildAffected([{ filePath: workos, symbol: "_upsert_user", impact: upsert }], named);
    expect(affectedTests.map((f) => [f.filePath, f.dependents.length])).toEqual([
      ["tests/integration/auth/test_workos_service.py", 8],
      ["tests/unit/core/auth/test_workos_service.py", 0],
    ]);
  });

  test("files sort by dependent count, then path", () => {
    const impact: ImpactResult = {
      symbol: "root",
      affected: [
        { name: "root", kind: "function", filePath: "src/root.py", startLine: 1 },
        { name: "z", kind: "function", filePath: "src/z.py", startLine: 9 },
        { name: "a1", kind: "function", filePath: "src/a.py", startLine: 20 },
        { name: "a0", kind: "function", filePath: "src/a.py", startLine: 3 },
        { name: "m", kind: "function", filePath: "src/m.py", startLine: 1 },
      ],
    };
    const { affectedCode } = buildAffected([{ filePath: "src/root.py", symbol: "root", impact }], []);
    expect(affectedCode.map((f) => f.filePath)).toEqual(["src/a.py", "src/m.py", "src/z.py"]);
    expect(affectedCode[0]?.dependents.map((d) => d.startLine)).toEqual([3, 20]);
  });

  test("nothing changed means nothing affected", () => {
    expect(buildAffected([], [])).toEqual({ affectedCode: [], affectedTests: [] });
  });
});

describe("truncateText", () => {
  test("leaves short text alone", () => {
    expect(truncateText("hello", 24)).toBe("hello");
  });

  test("cuts at a line break and reports the dropped bytes", () => {
    const text = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    const out = truncateText(text, 100);
    const [kept, note] = out.split("\n\n");
    expect(new TextEncoder().encode(kept).length).toBeLessThanOrEqual(100);
    expect(kept?.endsWith("\n")).toBe(false);
    expect(note).toMatch(/^\[truncated \d+ bytes; run `codegraph explore` for the rest\]$/);
  });

  test("counts bytes, not characters, for multibyte text", () => {
    const text = "é".repeat(100);
    const out = truncateText(text, 50);
    const kept = out.split("\n\n")[0] as string;
    expect(new TextEncoder().encode(kept).length).toBeLessThanOrEqual(50);
    expect(kept.length).toBeGreaterThan(0);
  });
});
