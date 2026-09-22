import type { PluginTimelineItem } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { BannerCard, bannerCardSchema } from "./client/banner-card";
import { InboxCard, inboxCardSchema } from "./client/inbox-card";
import { PasteCard, pasteCardSchema } from "./client/paste-card";
import { ProseCard, proseCardSchema } from "./client/prose-card";
import { SkillCard, skillCardSchema } from "./client/skill-card";
import {
  detectLongPaste,
  isSystemNoticeTrailer,
  parseIrcFragment,
  parseSkillBody,
  parseSkillInvocation,
  parseSystemNotice,
  splitIrcRow,
} from "./shared/detect";

const HIDE = { items: [] };

function banner(icon: string, title: string, meta: string[] = [], body = "") {
  return { items: [{ type: "plugin" as const, kind: "banner-card", version: 1, data: { icon, title, meta, body } }] };
}

export default function contribute(client: PluginClientContext) {
  client.addTimelineTransformer({
    id: "tidy-user-message",
    query: { itemType: "user_message" },
    transform({ item }) {
      const skill = parseSkillInvocation(item.text);
      if (skill !== null) {
        return {
          items: [{ type: "plugin", kind: "skill-card", version: 1, data: { ...skill, origin: "user" } }],
        };
      }
      const paste = detectLongPaste(item.text);
      if (paste !== null) {
        return { items: [{ type: "plugin", kind: "paste-card", version: 1, data: paste }] };
      }
      return undefined;
    },
  });
  // omp's injected rows reach the timeline as assistant messages; while a
  // message streams, paseo 0.8 hands each markdown block over on its own
  client.addTimelineTransformer({
    id: "tidy-assistant-message",
    query: { itemType: "assistant_message" },
    transform({ item }) {
      // a delivery can share its row with the reply that was streaming; the
      // reply keeps its place, rendered by the plugin since a transformer
      // may only emit plugin items
      const segments = splitIrcRow(item.text);
      if (segments !== null) {
        const items: PluginTimelineItem[] = segments.map((segment, index): PluginTimelineItem => {
          if (segment.kind === "inbox") {
            return { type: "plugin", id: `inbox-${index}`, kind: "inbox-card", version: 1, data: { messages: segment.messages } };
          }
          return { type: "plugin", id: `prose-${index}`, kind: "prose-card", version: 1, data: { text: segment.text } };
        });
        return { items };
      }
      const fragment = parseIrcFragment(item.text);
      if (fragment !== null) {
        return fragment.kind === "opener" ? banner("Inbox", `Message from ${fragment.from}`) : HIDE;
      }
      const skill = parseSkillBody(item.text);
      if (skill !== null) {
        return {
          items: [
            {
              type: "plugin",
              kind: "skill-card",
              version: 1,
              data: { name: skill.name, args: "", body: skill.body, origin: "assistant" },
            },
          ],
        };
      }
      const notice = parseSystemNotice(item.text);
      if (notice !== null) return banner("BellRing", notice.title, notice.meta, notice.body);
      if (isSystemNoticeTrailer(item.text)) return HIDE;
      return undefined;
    },
  });
  client.addTimelineRenderer({ kind: "skill-card", version: 1, schema: skillCardSchema, Component: SkillCard });
  client.addTimelineRenderer({ kind: "paste-card", version: 1, schema: pasteCardSchema, Component: PasteCard });
  client.addTimelineRenderer({ kind: "inbox-card", version: 1, schema: inboxCardSchema, Component: InboxCard });
  client.addTimelineRenderer({ kind: "banner-card", version: 1, schema: bannerCardSchema, Component: BannerCard });
  client.addTimelineRenderer({ kind: "prose-card", version: 1, schema: proseCardSchema, Component: ProseCard });
  return () => {};
}
