import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon, copyText, useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { z } from "zod";
import { Markdown } from "./markdown";

export const skillCardSchema = z.object({
  name: z.string(),
  args: z.string(),
  body: z.string(),
  /** which side of the thread the source row sat on */
  origin: z.enum(["user", "assistant"]),
});

type SkillCardData = z.output<typeof skillCardSchema>;

export function SkillCard({ item, theme, layout }: PluginTimelineItemProps<SkillCardData>) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const styles = useMemo(
    () => ({
      card: {
        alignSelf: (item.data.origin === "user" ? "flex-end" : "flex-start") as "flex-end" | "flex-start",
        maxWidth: "100%" as const,
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
      label: { color: theme.colors.foregroundMuted, fontSize: 12 },
      name: { color: theme.colors.foreground, fontSize: 14, fontWeight: "600" as const },
      args: { color: theme.colors.foreground, fontSize: 13, fontFamily: "monospace", flexShrink: 1 },
      body: {
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        padding: layout.compact ? 12 : 16,
        backgroundColor: theme.colors.surface0,
      },
      footer: {
        flexDirection: "row" as const,
        justifyContent: "flex-end" as const,
        gap: 16,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
      },
      action: { color: theme.colors.accent, fontSize: 12 },
    }),
    [theme, layout.compact, item.data.origin],
  );

  async function copyBody() {
    try {
      await copyText(item.data.body);
      toast.show("Skill copied", { variant: "success" });
    } catch {
      toast.error("Could not copy. Select the text and use Copy.");
    }
  }

  const hasBody = item.data.body !== "";
  const lineCount = item.data.body.split("\n").length;
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${open ? "Collapse" : "Expand"} skill ${item.data.name}`}
        disabled={!hasBody}
        onPress={() => setOpen((value) => !value)}
        style={styles.header}
      >
        {hasBody ? (
          <Icon name={open ? "ChevronDown" : "ChevronRight"} size={16} color={theme.colors.foregroundMuted} />
        ) : null}
        <Icon name="Sparkles" size={16} color={theme.colors.accent} />
        <Text style={styles.label}>Skill</Text>
        <Text style={styles.name}>{item.data.name}</Text>
        {item.data.args !== "" ? (
          <Text style={styles.args} numberOfLines={1}>
            {item.data.args}
          </Text>
        ) : null}
        {hasBody && !open ? <Text style={styles.label}>{`${lineCount} lines`}</Text> : null}
      </Pressable>
      {hasBody && open ? (
        <>
          <View style={styles.body}>
            <Markdown text={item.data.body} theme={theme} compact={layout.compact} />
          </View>
          <View style={styles.footer}>
            <Pressable accessibilityRole="button" onPress={copyBody}>
              <Text style={styles.action}>Copy</Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </View>
  );
}
