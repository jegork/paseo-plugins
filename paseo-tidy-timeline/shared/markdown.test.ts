import { describe, expect, test } from "vitest";
import { parseInline, parseMarkdown } from "./markdown";

describe("parseInline", () => {
  test("splits code, bold and italic out of prose", () => {
    expect(parseInline("Mixins use `from x import *` and **do NOT merge**, see *service.py*.")).toEqual([
      { text: "Mixins use " },
      { text: "from x import *", code: true },
      { text: " and " },
      { text: "do NOT merge", bold: true },
      { text: ", see " },
      { text: "service.py", italic: true },
      { text: "." },
    ]);
  });

  test("leaves asterisks inside words and unclosed markers alone", () => {
    expect(parseInline("a*b*c and 2 * 3 and **open")).toEqual([{ text: "a*b*c and 2 * 3 and **open" }]);
  });

  test("keeps file references and underscores in identifiers literal", () => {
    expect(parseInline("service.py:76-100 overrides __getattribute__ and index_at_intake")).toEqual([
      { text: "service.py:76-100 overrides __getattribute__ and index_at_intake" },
    ]);
  });

  test("handles a code span containing a backtick via double fences", () => {
    expect(parseInline("use `` a`b `` here")).toEqual([{ text: "use " }, { text: " a`b ", code: true }, { text: " here" }]);
  });

  test("turns markdown links and bare urls into link spans without eating punctuation", () => {
    expect(parseInline("see [the card](https://hf.co/x) and https://a.ai/m/deepseek-v4-1, then https://b.io/p).")).toEqual([
      { text: "see " },
      { text: "the card", href: "https://hf.co/x" },
      { text: " and " },
      { text: "https://a.ai/m/deepseek-v4-1", href: "https://a.ai/m/deepseek-v4-1" },
      { text: ", then " },
      { text: "https://b.io/p", href: "https://b.io/p" },
      { text: ")." },
    ]);
  });

  test("returns one empty span for empty input", () => {
    expect(parseInline("")).toEqual([{ text: "" }]);
  });
});

describe("parseMarkdown", () => {
  test("joins wrapped lines into one paragraph and splits on blank lines", () => {
    expect(parseMarkdown("first line\nstill first\n\nsecond")).toEqual([
      { type: "paragraph", spans: [{ text: "first line still first" }] },
      { type: "paragraph", spans: [{ text: "second" }] },
    ]);
  });

  test("reads headings, bullet and numbered lists, and keeps list runs together", () => {
    const blocks = parseMarkdown("## Process\n- one\n- **two**\n1. first\n2) second\n- again");
    expect(blocks.map((b) => b.type)).toEqual(["heading", "list", "list", "list"]);
    expect(blocks[1]).toMatchObject({ ordered: false, items: [[{ text: "one" }], [{ text: "two", bold: true }]] });
    expect(blocks[2]).toMatchObject({ ordered: true });
    expect(blocks[3]).toMatchObject({ ordered: false });
  });

  test("keeps fenced code verbatim, including blank lines, and reads the language", () => {
    const blocks = parseMarkdown("before\n```bash\ngit diff\n\n# not a heading\n```\nafter");
    expect(blocks).toEqual([
      { type: "paragraph", spans: [{ text: "before" }] },
      { type: "code", text: "git diff\n\n# not a heading", lang: "bash" },
      { type: "paragraph", spans: [{ text: "after" }] },
    ]);
  });

  test("an unclosed fence swallows the rest rather than corrupting later blocks", () => {
    expect(parseMarkdown("```\nx\ny")).toEqual([{ type: "code", text: "x\ny", lang: null }]);
  });
});
