/**
 * A small markdown reader for the subset hub messages and skill bodies use:
 * paragraphs, headings, bullet and numbered lists, fenced code, and inline
 * code, bold and italic. Anything else stays literal text. No React here so
 * the parser is testable; the renderer maps these blocks to native Text.
 */

export type Span = { text: string; code?: true; bold?: true; italic?: true; href?: string };

export type Block =
  | { type: "paragraph"; spans: Span[] }
  | { type: "heading"; level: number; spans: Span[] }
  | { type: "list"; ordered: boolean; items: Span[][] }
  | { type: "code"; text: string; lang: string | null };

const INLINE =
  /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\*\*([^*]+)\*\*|(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])|(?<![\w_])_([^_\s][^_]*?)_(?![\w_])|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()\[\]]+?)(?=[.,;:!?)]*(?:\s|$))/g;

export function parseInline(text: string): Span[] {
  const spans: Span[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) spans.push({ text: text.slice(last, index) });
    if (match[2] !== undefined) spans.push({ text: match[2], code: true });
    else if (match[3] !== undefined) spans.push({ text: match[3], bold: true });
    else if (match[6] !== undefined) spans.push({ text: match[6], href: match[7] ?? "" });
    else if (match[8] !== undefined) spans.push({ text: match[8], href: match[8] });
    else spans.push({ text: match[4] ?? match[5] ?? "", italic: true });
    last = index + match[0].length;
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  return spans.length === 0 ? [{ text: "" }] : spans;
}

const FENCE = /^```(\w*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", spans: parseInline(paragraph.join(" ")) });
      paragraph = [];
    }
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const fence = FENCE.exec(line);
    if (fence !== null) {
      flush();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i] ?? "")) {
        code.push(lines[i] ?? "");
        i += 1;
      }
      blocks.push({ type: "code", text: code.join("\n"), lang: fence[1] === "" ? null : (fence[1] ?? null) });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      flush();
      blocks.push({ type: "heading", level: (heading[1] ?? "#").length, spans: parseInline(heading[2] ?? "") });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet === null ? NUMBERED.exec(line) : null;
    if (bullet !== null || numbered !== null) {
      flush();
      const ordered = numbered !== null;
      const item = parseInline((bullet ?? numbered)?.[1] ?? "");
      const previous = blocks[blocks.length - 1];
      if (previous?.type === "list" && previous.ordered === ordered) previous.items.push(item);
      else blocks.push({ type: "list", ordered, items: [item] });
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}
