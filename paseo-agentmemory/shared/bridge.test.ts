import { describe, expect, test } from "vitest";
import { collectObservations, configFromEnv, formatRecall, providerId, recallQuery, sessionSummary, toolFields, truncate, withRecall } from "./bridge";

const shell = (status: "completed" | "failed" | "running", output = "ok"): any => ({
  type: "tool_call",
  callId: "c1",
  name: "bash",
  status,
  error: status === "failed" ? { message: "boom" } : null,
  detail: { type: "shell", command: "ls", cwd: "/p", output, exitCode: status === "failed" ? 1 : 0 },
});

describe("providerId", () => {
  test("keeps the provider before the model", () => {
    expect(providerId("omp/openai-codex/gpt-6-astra")).toBe("omp");
    expect(providerId("omp")).toBe("omp");
    expect(providerId("omp-plugin")).toBe("omp-plugin");
  });
});

describe("toolFields", () => {
  test("splits a shell call into command input and output with exit code", () => {
    expect(toolFields(shell("completed"))).toEqual({
      tool_name: "bash",
      tool_input: { command: "ls", cwd: "/p" },
      tool_output: "ok\n[exit 0]",
    });
  });

  test("appends the failure to the output of a failed call", () => {
    expect(toolFields(shell("failed")).tool_output).toBe('ok\n[exit 1]\n[failed] {"message":"boom"}');
  });

  test("bounds output like the hooks do", () => {
    const out = toolFields(shell("completed", "x".repeat(10_000))).tool_output;
    expect(out.length).toBeLessThan(8_100);
    expect(out).toMatch(/truncated 2009 chars/);
  });

  test("handles every detail type without throwing", () => {
    const details = [
      { type: "read", filePath: "a.ts", content: "x" },
      { type: "edit", filePath: "a.ts", oldString: "a", newString: "b", unifiedDiff: "-a+b" },
      { type: "write", filePath: "a.ts", content: "z" },
      { type: "search", query: "q", filePaths: ["a", "b"] },
      { type: "fetch", url: "https://x", result: "r" },
      { type: "sub_agent", description: "d", log: "l" },
      { type: "plan", text: "t" },
      { type: "unknown", input: { a: 1 }, output: { b: 2 } },
      { type: "worktree_setup", worktreePath: "/w", branchName: "b", log: "", commands: [] },
    ];
    for (const detail of details) {
      const f = toolFields({ type: "tool_call", callId: "x", name: "t", status: "completed", error: null, detail } as any);
      expect(typeof f.tool_output).toBe("string");
      expect(f.tool_input).toBeDefined();
    }
    expect(toolFields({ type: "tool_call", callId: "x", name: "t", status: "completed", error: null, detail: { type: "search", query: "q", filePaths: ["a", "b"] } } as any).tool_output).toBe("a\nb");
  });
});

describe("collectObservations", () => {
  const timeline: any[] = [
    { type: "user_message", text: "fix the bug" },
    { type: "reasoning", text: "…" },
    shell("running"),
    { type: "assistant_message", text: "done" },
  ];

  test("emits the prompt, skips reasoning and running tool calls, and advances the cursor", () => {
    const r = collectObservations(timeline, 0, { prompts: true, tools: true });
    expect(r.observations.map((o) => o.hookType)).toEqual(["prompt_submit"]);
    expect(r.seen).toBe(4);
  });

  test("only sends items added since the last turn", () => {
    const next = [...timeline.slice(0, 2), shell("completed"), timeline[3], { type: "user_message", text: "and tests" }];
    const r = collectObservations(next, 4, { prompts: true, tools: true });
    expect(r.observations.map((o) => o.hookType)).toEqual(["prompt_submit"]);
    // the finished tool call at index 2 sits before the cursor; the next turn's snapshot must re-list it to be seen
  });

  test("starts over after a rewind and honours the capture switches", () => {
    const r = collectObservations([timeline[0], shell("completed")], 4, { prompts: false, tools: true });
    expect(r.observations.map((o) => o.hookType)).toEqual(["post_tool_use"]);
    expect(r.seen).toBe(2);
  });

  test("skips blank prompts", () => {
    expect(collectObservations([{ type: "user_message", text: "   " }] as any, 0, { prompts: true, tools: true }).observations).toEqual([]);
  });
});

describe("truncate", () => {
  test("leaves short text alone", () => {
    expect(truncate("abc")).toBe("abc");
  });
});

describe("configFromEnv", () => {
  test("defaults to the local engine and the omp providers", () => {
    expect(configFromEnv({})).toEqual({ url: "http://localhost:3111", providers: ["omp", "omp-plugin"] });
  });

  test("reads overrides and trims a trailing slash", () => {
    expect(configFromEnv({ AGENTMEMORY_URL: "http://10.0.0.2:3111/", PASEO_AGENTMEMORY_PROVIDERS: " omp , pi " })).toEqual({
      url: "http://10.0.0.2:3111",
      providers: ["omp", "pi"],
    });
  });
});

describe("recallQuery", () => {
  test("uses the title without a bracketed prefix, else the directory name", () => {
    expect(recallQuery({ title: "[Handoff] Fix memory erasure replay", cwd: "/p/x" })).toBe("Fix memory erasure replay");
    expect(recallQuery({ title: null, cwd: "/Users/me/projects/liesbeth/" })).toBe("liesbeth");
  });
});

describe("formatRecall", () => {
  test("keeps scored hits above the floor, flattens whitespace and bounds each line", () => {
    const block = formatRecall([
      { observation: { title: "Erasure fix", narrative: "Restructured\n\n account   deletion." }, score: 0.9 },
      { observation: { title: "Facts only", facts: ["a", "b", "c", "d"] }, score: 0.8 },
      { observation: "ignored", score: 0.05 },
      { observation: { content: "x".repeat(700) }, score: 0.5 },
    ]);
    expect(block).toContain("- Erasure fix: Restructured account deletion.");
    expect(block).toContain("- Facts only: a; b; c");
    expect(block).not.toContain("ignored");
    expect(block?.split("\n").filter((l) => l.startsWith("- ")).length).toBe(3);
    expect(block).toMatch(/…$/);
  });

  test("returns null when nothing qualifies", () => {
    expect(formatRecall([])).toBeNull();
    expect(formatRecall([{ observation: "", score: 1 }])).toBeNull();
  });

  test("withRecall appends to an existing system prompt or stands alone", () => {
    expect(withRecall("Be terse.", "## Memory")).toBe("Be terse.\n\n## Memory");
    expect(withRecall(undefined, "## Memory")).toBe("## Memory");
  });
});

describe("sessionSummary", () => {
  test("reads a consolidated summary and ignores sessions without one", () => {
    expect(sessionSummary({ id: "s", summary: { title: "T", narrative: "N", keyDecisions: ["d", 3], concepts: ["c"], filesModified: [], observationCount: 4, createdAt: "2026-09-14T10:00:00Z" } })).toEqual({
      title: "T", narrative: "N", keyDecisions: ["d"], concepts: ["c"], filesModified: [], observationCount: 4, createdAt: "2026-09-14T10:00:00Z",
    });
    expect(sessionSummary({ id: "s" })).toBeNull();
    expect(sessionSummary(null)).toBeNull();
  });
});
