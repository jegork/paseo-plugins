/**
 * Pure recognisers for user messages the timeline should not show verbatim.
 * No React, no Node: the client transformer and the tests share this file.
 */

export type SkillInvocation = {
  name: string;
  args: string;
  body: string;
};

// omp expands `/skill:name args` into the user turn as the command line, a
// marker sentence, then the whole SKILL.md; the model reads the same text
const SKILL_LINE = /^\/skill:([A-Za-z0-9_.-]+)(?:[ \t]+(.*))?$/;
const SKILL_MARKER =
  /^\[IMPORTANT: User invoked the "([^"]+)" skill; follow its instructions\. Full skill below\.\]$/;

export type SkillBody = {
  name: string;
  body: string;
};

/**
 * Paseo's omp mapper emits the injected skill as its own assistant row whose
 * text starts with the marker, separate from the `/skill:` user bubble. The
 * marker must be the first line: a reply that merely quotes it is left alone.
 */
// paseo's history rebuild labels omp's injected rows `[custom_message]`; the
// label is presentation, not content, so every recogniser looks past it
const CUSTOM_TAG = /\[custom_message\]\s*/g;

export function stripCustomTag(text: string): string {
  return text.replace(CUSTOM_TAG, "");
}

export function parseSkillBody(text: string): SkillBody | null {
  const [first = "", ...rest] = stripCustomTag(text).split("\n");
  const marker = SKILL_MARKER.exec(first);
  if (marker === null) return null;
  return { name: marker[1] ?? "", body: rest.join("\n").trim() };
}

export function parseSkillInvocation(text: string): SkillInvocation | null {
  const lines = text.split("\n");
  const command = SKILL_LINE.exec(lines[0] ?? "");
  if (command === null) return null;
  const markerIndex = lines.findIndex((line, index) => index > 0 && SKILL_MARKER.test(line));
  if (markerIndex === -1) return null;
  const marker = SKILL_MARKER.exec(lines[markerIndex] ?? "");
  if (marker === null || marker[1] !== command[1]) return null;
  return {
    name: command[1] ?? "",
    args: (command[2] ?? "").trim(),
    body: lines
      .slice(markerIndex + 1)
      .join("\n")
      .trim(),
  };
}

// CSI sequences (colour, cursor) and OSC sequences (titles, hyperlinks)
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

export type LongPaste = {
  preview: string;
  text: string;
  lineCount: number;
  hadAnsi: boolean;
};

export const LONG_PASTE_MIN_LINES = 24;
export const LONG_PASTE_MIN_CHARS = 4000;
export const PREVIEW_LINES = 3;

/**
 * A message long enough that it is almost certainly pasted output rather than
 * something typed. The preview keeps the first few lines so the reader still
 * sees what was pasted without the whole log unrolled in the thread.
 */
export function detectLongPaste(text: string): LongPaste | null {
  const hadAnsi = ANSI.test(text);
  ANSI.lastIndex = 0;
  const clean = hadAnsi ? stripAnsi(text) : text;
  const lines = clean.split("\n");
  if (lines.length < LONG_PASTE_MIN_LINES && clean.length < LONG_PASTE_MIN_CHARS) return null;
  return {
    preview: lines.slice(0, PREVIEW_LINES).join("\n"),
    text: clean,
    lineCount: lines.length,
    hadAnsi,
  };
}

export type IrcMessage = {
  from: string;
  body: string;
  replyTo: string | null;
};

export type IrcInbox = {
  messages: IrcMessage[];
};

// omp's hub delivers subagent replies into the parent as one assistant row
// made only of <irc> blocks, each with a sender line and delivery boilerplate
const IRC_BLOCK = /<irc>\s*([\s\S]*?)\s*<\/irc>/g;
// omp 18.1 wraps the sender in backticks and may add "(reply to <id>)"
const IRC_FROM = /^Incoming IRC message from agent `?([^\s:`]+)`?(?:\s*\(reply to ([^)]+)\))?:\s*/;
const IRC_TRAILER = [
  /^Sent while waiting\/working\..*$/m,
  /^If response expected, reply via hub .*$/m,
];

export function parseIrcInbox(rawText: string): IrcInbox | null {
  const text = stripCustomTag(rawText);
  const messages: IrcMessage[] = [];
  for (const match of text.matchAll(IRC_BLOCK)) {
    const inner = match[1] ?? "";
    const from = IRC_FROM.exec(inner);
    if (from === null) return null;
    let body = inner.slice(from[0].length);
    for (const trailer of IRC_TRAILER) body = body.replace(trailer, "");
    messages.push({ from: from[1] ?? "", body: body.trim(), replyTo: from[2] ?? null });
  }
  if (messages.length === 0) return null;
  // anything outside the blocks means the model also said something; leave it
  if (text.replace(IRC_BLOCK, "").trim() !== "") return null;
  return { messages };
}

/**
 * Paseo 0.8 splits a streaming assistant message into markdown blocks and
 * runs transformers per block, so an injected row can arrive as fragments.
 * These recognisers handle the fragments that carry no content of their own:
 * an <irc> opener names its sender, everything else is tag and boilerplate.
 */
export type IrcFragment = { kind: "opener"; from: string } | { kind: "noise" };

const IRC_FRAGMENT_LINES: RegExp[] = [
  /^<\/?irc>(<irc>)?$/,
  /^Sent while waiting\/working\..*$/,
  /^If response expected, reply via .*$/,
];
const IRC_OPENER_LINE = /^Incoming IRC message from agent `?([^\s:`]+)`?(?:\s*\(reply to [^)]+\))?:$/;

export function parseIrcFragment(rawText: string): IrcFragment | null {
  const lines = stripCustomTag(rawText)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines.length === 0) return null;
  let from: string | null = null;
  for (const line of lines) {
    const opener = IRC_OPENER_LINE.exec(line);
    if (opener !== null) {
      from = opener[1] ?? null;
      continue;
    }
    if (!IRC_FRAGMENT_LINES.some((pattern) => pattern.test(line))) return null;
  }
  return from === null ? { kind: "noise" } : { kind: "opener", from };
}

export type SystemNotice = {
  title: string;
  meta: string[];
  body: string;
};

// omp reports finished background jobs as a <system-notice> with a task-result
// envelope; the preview inside is the part worth folding
const NOTICE_META = /<(?:task-result|meta)\b([^>]*)\/?>/g;
const NOTICE_TAG_LINE = /^<\/?(?:system-notice|task-result|preview|meta)\b[^>]*>$/;

export function parseSystemNotice(rawText: string): SystemNotice | null {
  const text = stripCustomTag(rawText).trim();
  if (!text.startsWith("<system-notice>")) return null;
  const lines = text.split("\n");
  const title = (lines.find((line, index) => index > 0 && line.trim() !== "") ?? "")
    .trim()
    .replace(/\.\s.*$/, "");
  const meta: string[] = [];
  for (const match of text.matchAll(NOTICE_META)) {
    for (const attr of (match[1] ?? "").matchAll(/(\w+)="([^"]*)"/g)) {
      if (attr[1] === "duration" || attr[1] === "lines" || attr[1] === "status") {
        meta.push(`${attr[1]} ${attr[2]}`);
      }
    }
  }
  const body = lines
    .slice(lines.findIndex((line) => line.trim() === title || line.trim().startsWith(title)) + 1)
    .filter((line) => !NOTICE_TAG_LINE.test(line.trim()))
    .join("\n")
    .trim();
  return { title, meta, body };
}

// closing tags and the "full payload at agent://" pointer that end a notice
const NOTICE_TRAILER_LINE = /^(?:<\/(?:system-notice|task-result|preview)>|output: .*agent:\/\/.*)$/;

export function isSystemNoticeTrailer(rawText: string): boolean {
  const lines = stripCustomTag(rawText)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return lines.length > 0 && lines.every((line) => NOTICE_TRAILER_LINE.test(line));
}

export type RowSegment = { kind: "prose"; text: string } | { kind: "inbox"; messages: IrcMessage[] };

/**
 * Paseo can merge a hub delivery into the assistant row that was streaming
 * when it arrived, so the reply and the <irc> blocks share one row. This
 * splits such a row into prose and inbox segments in order; consecutive
 * blocks become one inbox. Null when the row has no complete block.
 */
export function splitIrcRow(rawText: string): RowSegment[] | null {
  const text = stripCustomTag(rawText);
  const segments: RowSegment[] = [];
  let cursor = 0;
  let messages: IrcMessage[] = [];
  const flushInbox = () => {
    if (messages.length > 0) segments.push({ kind: "inbox", messages });
    messages = [];
  };
  for (const match of text.matchAll(IRC_BLOCK)) {
    const index = match.index ?? 0;
    const single = parseIrcInbox(match[0]);
    if (single === null) return null;
    const prose = text.slice(cursor, index).trim();
    if (prose !== "") {
      flushInbox();
      segments.push({ kind: "prose", text: prose });
    }
    messages.push(...single.messages);
    cursor = index + match[0].length;
  }
  flushInbox();
  if (segments.length === 0) return null;
  const tail = text.slice(cursor).trim();
  if (tail !== "") segments.push({ kind: "prose", text: tail });
  return segments;
}
