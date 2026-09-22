import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon, copyText, useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { z } from "zod";

export const pasteCardSchema = z.object({
  preview: z.string(),
  text: z.string(),
  lineCount: z.number().int().nonnegative(),
  hadAnsi: z.boolean(),
});

type PasteCardData = z.output<typeof pasteCardSchema>;

export function PasteCard({ item, theme, layout }: PluginTimelineItemProps<PasteCardData>) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const styles = useMemo(
    () => ({
      card: {
        alignSelf: "flex-end" as const,
        maxWidth: "100%" as const,
        borderRadius: 12,
        backgroundColor: theme.colors.surface1,
        borderWidth: 1,
        borderColor: theme.colors.border,
        overflow: "hidden" as const,
      },
      text: {
        color: theme.colors.foreground,
        fontFamily: "monospace",
        fontSize: 12,
        lineHeight: 18,
        padding: layout.compact ? 12 : 16,
      },
      bar: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
      },
      muted: { color: theme.colors.foregroundMuted, fontSize: 12, flex: 1 },
      action: { color: theme.colors.accent, fontSize: 12 },
    }),
    [theme, layout.compact],
  );

  async function copyAll() {
    try {
      await copyText(item.data.text);
      toast.show("Pasted text copied", { variant: "success" });
    } catch {
      toast.error("Could not copy. Select the text and use Copy.");
    }
  }

  const hidden = Math.max(0, item.data.lineCount - item.data.preview.split("\n").length);
  const summary = open
    ? `${item.data.lineCount} lines${item.data.hadAnsi ? ", colour codes removed" : ""}`
    : `${hidden} more lines${item.data.hadAnsi ? ", colour codes removed" : ""}`;
  return (
    <View style={styles.card}>
      <Text selectable style={styles.text}>
        {open ? item.data.text : item.data.preview}
      </Text>
      <View style={styles.bar}>
        <Icon name="ClipboardPaste" size={14} color={theme.colors.foregroundMuted} />
        <Text style={styles.muted}>{summary}</Text>
        <Pressable accessibilityRole="button" onPress={copyAll}>
          <Text style={styles.action}>Copy</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? "Collapse pasted text" : "Show pasted text"}
          onPress={() => setOpen((value) => !value)}
        >
          <Text style={styles.action}>{open ? "Collapse" : "Show all"}</Text>
        </Pressable>
      </View>
    </View>
  );
}
