# tidy-timeline

A Paseo plugin that folds noisy user messages into compact cards.

- **Skill card** — omp expands `/skill:name` into the conversation as a marker sentence followed by
  the whole SKILL.md, which Paseo shows as a reply-sized wall of text. The card shows
  `Skill · name` with a line count; tap to expand the body, copy it from the footer. Both shapes are
  recognised: the body as its own assistant row (what Paseo's omp mapper emits) and the body bundled
  into the user message.
- **Inbox card** — omp's hub delivers subagent replies into the parent as one assistant row of
  `<irc>` blocks. The card lists one collapsed row per message with the sender and a two-line
  preview; tap to read, Copy underneath. The two delivery boilerplate lines are dropped. When Paseo
  merges a delivery into the reply that was streaming, the row is split: the reply's own words stay
  in place, rendered by the plugin, and the blocks become the card.
- **Notice card** — omp's `<system-notice>` for a finished background job becomes one line,
  "Background job X has completed · status · duration · lines", expanding to the result preview.
  The closing tags and the "full payload at agent://" pointer are dropped.
- **Paste card** — a user message with 24 or more lines, or 4000 or more characters, is almost
  certainly pasted output. The card shows the first three lines and a "more lines" bar with
  Show all and Copy. ANSI colour codes are stripped and the bar says so.

Card bodies render a small markdown subset of their own, since Paseo exposes no markdown component
to plugins: paragraphs, headings, bullet and numbered lists, fenced code, and inline code, bold and
italic, plus links, which open in the browser. Anything else stays literal.

Client-only. Nothing runs on the daemon and nothing is stored.

## Install

```sh
paseo plugin add jegork/paseo-tidy-timeline
```

Requires Paseo 0.8.

## Streamed rows arrive in pieces

Paseo 0.8 splits an assistant message into markdown blocks while it streams and runs transformers
per block, so an injected row can reach the plugin as fragments. Whole rows get the full cards
above. Fragments degrade rather than break: a skill marker on its own becomes a header-only skill
card, an `<irc>` opener becomes "Message from X", trailer lines and closing tags are hidden, and a
notice header becomes a banner. The message paragraphs in between stay as ordinary markdown. A
reload of the agent refetches whole rows and restores the full cards.

 Transformers may only target user, assistant, reasoning, tool-call, todo,
error, and compaction rows, so omp's "mounted tool" notifications stay as they are.
