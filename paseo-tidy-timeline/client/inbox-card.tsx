import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon, copyText, useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { z } from "zod";
import { Markdown } from "./markdown";

export const inboxCardSchema = z.object({
  messages: z.array(
    z.object({ from: z.string(), body: z.string(), replyTo: z.string().nullable().default(null) }),
  ),
});

type InboxCardData = z.output<typeof inboxCardSchema>;

const PREVIEW_CHARS = 140;

function preview(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS - 1)}…` : flat;
}

/** Subagent replies omp's hub delivers into the parent, one row per message. */
export function InboxCard({ item, theme, layout }: PluginTimelineItemProps<InboxCardData>) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const toast = useToast();
  const styles = useMemo(
    () => ({
      card: {
        alignSelf: "stretch" as const,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        overflow: "hidden" as const,
      },
      header: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
      },
      title: { color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const },
      row: {
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
      },
      rowHeader: {
        flexDirection: "row" as const,
        alignItems: "flex-start" as const,
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
      },
      from: { color: theme.colors.accent, fontSize: 13, fontWeight: "600" as const },
      preview: { color: theme.colors.foregroundMuted, fontSize: 13, flex: 1 },
      body: {
        paddingHorizontal: layout.compact ? 12 : 16,
        paddingBottom: 12,
        paddingLeft: 36,
      },
      copy: { color: theme.colors.accent, fontSize: 12, paddingTop: 8 },
    }),
    [theme, layout.compact],
  );

  async function copy(body: string) {
    try {
      await copyText(body);
      toast.show("Message copied", { variant: "success" });
    } catch {
      toast.error("Could not copy. Select the text and use Copy.");
    }
  }

  const count = item.data.messages.length;
  const senders = [...new Set(item.data.messages.map((message) => message.from))];
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Icon name="Inbox" size={16} color={theme.colors.accent} />
        <Text style={styles.title}>
          {`${count} ${count === 1 ? "message" : "messages"} from ${senders.join(", ")}`}
        </Text>
      </View>
      {item.data.messages.map((message, index) => {
        const expanded = open[index] === true;
        return (
          <View key={`${message.from}-${index}`} style={styles.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${expanded ? "Collapse" : "Expand"} message from ${message.from}`}
              onPress={() => setOpen((state) => ({ ...state, [index]: !expanded }))}
              style={styles.rowHeader}
            >
              <Icon
                name={expanded ? "ChevronDown" : "ChevronRight"}
                size={16}
                color={theme.colors.foregroundMuted}
              />
              <Text style={styles.from}>{message.from}</Text>
              {message.replyTo !== null ? (
                <Text style={styles.preview}>{`reply · ${message.replyTo.slice(0, 8)}`}</Text>
              ) : null}
              {!expanded ? (
                <Text style={styles.preview} numberOfLines={2}>
                  {preview(message.body)}
                </Text>
              ) : null}
            </Pressable>
            {expanded ? (
              <View style={styles.body}>
                <Markdown text={message.body} theme={theme} compact={layout.compact} />
                <Pressable accessibilityRole="button" onPress={() => copy(message.body)}>
                  <Text style={styles.copy}>Copy</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
