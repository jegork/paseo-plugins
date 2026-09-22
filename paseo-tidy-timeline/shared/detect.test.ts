import { describe, expect, test } from "vitest";
import {
  detectLongPaste,
  isSystemNoticeTrailer,
  parseIrcFragment,
  parseIrcInbox,
  parseSkillBody,
  parseSkillInvocation,
  parseSystemNotice,
  splitIrcRow,
  stripAnsi,
} from "./detect";

const ESC = "\x1b";

const SKILL_TEXT = [
  "/skill:bossman-diff-review fix/companyid-sql-string",
  '[IMPORTANT: User invoked the "bossman-diff-review" skill; follow its instructions. Full skill below.]',
  "",
  "Two-axis review of the diff between `HEAD` and a fixed point.",
  "",
  "## Process",
].join("\n");

describe("parseSkillInvocation", () => {
  test("splits an omp skill expansion into name, args and body", () => {
    expect(parseSkillInvocation(SKILL_TEXT)).toEqual({
      name: "bossman-diff-review",
      args: "fix/companyid-sql-string",
      body: "Two-axis review of the diff between `HEAD` and a fixed point.\n\n## Process",
    });
  });

  test("accepts an invocation without arguments", () => {
    const text = SKILL_TEXT.replace(
      "/skill:bossman-diff-review fix/companyid-sql-string",
      "/skill:commit",
    ).replace('"bossman-diff-review"', '"commit"');
    expect(parseSkillInvocation(text)).toMatchObject({ name: "commit", args: "" });
  });

  test("leaves a plain message that merely starts with a slash alone", () => {
    expect(parseSkillInvocation("/skill:commit\nplease commit this")).toBeNull();
    expect(parseSkillInvocation("/tdd then carry on")).toBeNull();
  });

  test("ignores a marker whose name does not match the command line", () => {
    const text = SKILL_TEXT.replace('"bossman-diff-review" skill', '"other" skill');
    expect(parseSkillInvocation(text)).toBeNull();
  });

  test("does not fire on a message that only quotes the marker", () => {
    expect(
      parseSkillInvocation(
        'some notes\n[IMPORTANT: User invoked the "x" skill; follow its instructions. Full skill below.]',
      ),
    ).toBeNull();
  });
});

describe("stripAnsi", () => {
  test("removes colour codes and keeps the words", () => {
    expect(stripAnsi(`${ESC}[90m2026-03-24${ESC}[0m ${ESC}[31mERR${ESC}[0m boom`)).toBe(
      "2026-03-24 ERR boom",
    );
  });

  test("removes terminal hyperlinks", () => {
    expect(stripAnsi(`see ${ESC}]8;;https://x.test\x07here${ESC}]8;;\x07`)).toBe("see here");
  });
});

describe("detectLongPaste", () => {
  test("leaves a typed message alone", () => {
    expect(detectLongPaste("carry on")).toBeNull();
    expect(detectLongPaste(Array.from({ length: 23 }, (_, i) => `line ${i}`).join("\n"))).toBeNull();
  });

  test("collapses a message with many lines and keeps a short preview", () => {
    const text = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    expect(detectLongPaste(text)).toMatchObject({
      preview: "line 0\nline 1\nline 2",
      lineCount: 40,
      hadAnsi: false,
    });
  });

  test("collapses a single very long line too", () => {
    expect(detectLongPaste("x".repeat(5000))?.lineCount).toBe(1);
  });

  test("strips ansi from both preview and text and says it did", () => {
    const text = Array.from({ length: 30 }, () => `${ESC}[31mERR${ESC}[0m failed`).join("\n");
    const paste = detectLongPaste(text);
    expect(paste?.hadAnsi).toBe(true);
    expect(paste?.preview).toBe("ERR failed\nERR failed\nERR failed");
    expect(paste?.text).not.toContain(ESC);
  });
});

describe("parseSkillBody", () => {
  test("reads the skill omp injects as an assistant row", () => {
    const text =
      '[IMPORTANT: User invoked the "improve-codebase-architecture" skill; follow its instructions. Full skill below.]\n\n# Improve Codebase Architecture\n\nSurface friction.';
    expect(parseSkillBody(text)).toEqual({
      name: "improve-codebase-architecture",
      body: "# Improve Codebase Architecture\n\nSurface friction.",
    });
  });

  test("looks past the custom_message label paseo 0.8.0 adds", () => {
    const text =
      '[custom_message] [IMPORTANT: User invoked the "commit" skill; follow its instructions. Full skill below.]\n\nCommit it.';
    expect(parseSkillBody(text)).toEqual({ name: "commit", body: "Commit it." });
  });

  test("accepts a block that is only the marker, as paseo 0.8 streams it", () => {
    expect(
      parseSkillBody(
        '[IMPORTANT: User invoked the "commit" skill; follow its instructions. Full skill below.]',
      ),
    ).toEqual({ name: "commit", body: "" });
  });

  test("leaves a reply that quotes the marker later on alone", () => {
    expect(
      parseSkillBody('As the marker said:\n[IMPORTANT: User invoked the "x" skill; follow its instructions. Full skill below.]'),
    ).toBeNull();
  });

  test("leaves an ordinary reply alone", () => {
    expect(parseSkillBody("Bossman, I'll start with the hot spots.")).toBeNull();
  });
});

const IRC_ONE = `<irc>
Incoming IRC message from agent ConsultationDepth:
Best candidate: replace hidden facade-global synchronization.
Second line of evidence.
Sent while waiting/working. Active interruptible wait stopped early for immediate reading.
If response expected, reply via hub (op: "send", to: "ConsultationDepth"); may finish current step first. No one replies on your behalf.
</irc>`;

const IRC_TWO = `<irc>
Incoming IRC message from agent SessionDepth:
Additional evidence: timerPolling.ts:1-28.
Sent while waiting/working. Active interruptible wait stopped early for immediate reading.
If response expected, reply via hub (op: "send", to: "SessionDepth"); may finish current step first. No one replies on your behalf.
</irc>`;

describe("parseIrcInbox", () => {
  test("extracts sender and body and drops the delivery boilerplate", () => {
    expect(parseIrcInbox(IRC_ONE)).toEqual({
      messages: [
        {
          from: "ConsultationDepth",
          body: "Best candidate: replace hidden facade-global synchronization.\nSecond line of evidence.",
          replyTo: null,
        },
      ],
    });
  });

  test("strips the backticks omp 18.1 puts around the sender name", () => {
    const inbox = parseIrcInbox(IRC_ONE.replace("agent ConsultationDepth:", "agent `ConsultationDepth`:"));
    expect(inbox?.messages[0]?.from).toBe("ConsultationDepth");
  });

  test("reads the backticked sender and reply id omp 18.1 writes", () => {
    const text = IRC_ONE.replace(
      "agent ConsultationDepth:",
      "agent `GrafanaTargetsCleanup` (reply to 157e2fdb6177196e):",
    );
    expect(parseIrcInbox(text)?.messages[0]).toMatchObject({
      from: "GrafanaTargetsCleanup",
      replyTo: "157e2fdb6177196e",
    });
    expect(parseIrcFragment("<irc>\nIncoming IRC message from agent `X` (reply to abc):")).toEqual({
      kind: "opener",
      from: "X",
    });
  });

  test("keeps every block of a batch in order, even when glued together", () => {
    const inbox = parseIrcInbox(`${IRC_ONE}${IRC_TWO}`);
    expect(inbox?.messages.map((message) => message.from)).toEqual([
      "ConsultationDepth",
      "SessionDepth",
    ]);
    expect(inbox?.messages[1]?.body).toBe("Additional evidence: timerPolling.ts:1-28.");
  });

  test("looks past a custom_message label before every block", () => {
    const inbox = parseIrcInbox(`[custom_message] ${IRC_ONE}[custom_message] ${IRC_TWO}`);
    expect(inbox?.messages.map((message) => message.from)).toEqual([
      "ConsultationDepth",
      "SessionDepth",
    ]);
  });

  test("leaves a reply that discusses the messages alongside them alone", () => {
    expect(parseIrcInbox(`${IRC_ONE}\n\nBossman, both agents agree.`)).toBeNull();
    expect(parseIrcInbox("Bossman, nothing arrived.")).toBeNull();
  });

  test("leaves a block without a sender line alone", () => {
    expect(parseIrcInbox("<irc>\nhello\n</irc>")).toBeNull();
  });
});

describe("parseIrcFragment", () => {
  test("names the sender from an opener block", () => {
    expect(parseIrcFragment("<irc>\nIncoming IRC message from agent `ConsultationDepth`:")).toEqual({
      kind: "opener",
      from: "ConsultationDepth",
    });
  });

  test("treats a trailer glued to the next opener as an opener for that sender", () => {
    const block =
      'If response expected, reply via `hub` (`op: "send"`, `to: "ConsultationDepth"`); may finish current step first. No one replies on your behalf.\n</irc>[custom_message] <irc>\nIncoming IRC message from agent `InsightDepth`:';
    expect(parseIrcFragment(block)).toEqual({ kind: "opener", from: "InsightDepth" });
  });

  test("treats trailer lines and closing tags alone as noise", () => {
    expect(
      parseIrcFragment("Sent while waiting/working. Active interruptible wait stopped early for immediate reading."),
    ).toEqual({ kind: "noise" });
    expect(parseIrcFragment("</irc>")).toEqual({ kind: "noise" });
  });

  test("leaves a content paragraph alone", () => {
    expect(parseIrcFragment("Best candidate: replace hidden facade-global synchronization.")).toBeNull();
    expect(parseIrcFragment("<irc>\nIncoming IRC message from agent X:\nand then some content")).toBeNull();
  });
});

const NOTICE = `<system-notice>
Background job InsightDepth has completed. Resume your work using the result below.
<task-result id="InsightDepth" agent="scout" status="completed" duration="1m47s">
<meta lines="51" size="8.0KB" />
<preview full-output="agent://InsightDepth">
{
"summary": "One supported deepening candidate."
}
</preview>
</task-result>
</system-notice>`;

describe("parseSystemNotice", () => {
  test("lifts the job, its metadata and the preview out of the envelope", () => {
    expect(parseSystemNotice(`[custom_message] ${NOTICE}`)).toEqual({
      title: "Background job InsightDepth has completed",
      meta: ["status completed", "duration 1m47s", "lines 51"],
      body: '{\n"summary": "One supported deepening candidate."\n}',
    });
  });

  test("handles the multi-job wording and a header-only block", () => {
    const head = "<system-notice>\n2 background jobs have completed. Resume your work using the results below.";
    expect(parseSystemNotice(head)).toEqual({
      title: "2 background jobs have completed",
      meta: [],
      body: "",
    });
  });

  test("leaves ordinary replies alone", () => {
    expect(parseSystemNotice("Bossman, the job finished.")).toBeNull();
  });
});

describe("isSystemNoticeTrailer", () => {
  test("recognises the closing tags and the payload pointer", () => {
    expect(
      isSystemNoticeTrailer(
        "</preview>\n</task-result>\noutput: schema valid; full payload at agent://InsightDepth, fields via agent://InsightDepth?q=.<field>\n</system-notice>",
      ),
    ).toBe(true);
  });

  test("does not swallow content", () => {
    expect(isSystemNoticeTrailer('"summary": "x"\n</system-notice>')).toBe(false);
  });
});

describe("splitIrcRow", () => {
  test("separates a reply from the block glued onto its end, even mid-line", () => {
    const row = `Results are pending.[custom_message] ${IRC_ONE}`;
    expect(splitIrcRow(row)).toEqual([
      { kind: "prose", text: "Results are pending." },
      { kind: "inbox", messages: [expect.objectContaining({ from: "ConsultationDepth" })] },
    ]);
  });

  test("keeps prose on both sides and merges adjacent blocks", () => {
    const row = `Before.\n\n${IRC_ONE}${IRC_TWO}\n\nAfter.`;
    const segments = splitIrcRow(row);
    expect(segments?.map((s) => s.kind)).toEqual(["prose", "inbox", "prose"]);
    expect(segments?.[1]).toMatchObject({ messages: [{ from: "ConsultationDepth" }, { from: "SessionDepth" }] });
    expect(segments?.[2]).toEqual({ kind: "prose", text: "After." });
  });

  test("returns a lone inbox for a pure delivery and null for plain prose", () => {
    expect(splitIrcRow(IRC_ONE)?.map((s) => s.kind)).toEqual(["inbox"]);
    expect(splitIrcRow("Bossman, nothing arrived.")).toBeNull();
    expect(splitIrcRow("<irc>\nno sender line\n</irc>")).toBeNull();
  });
});
