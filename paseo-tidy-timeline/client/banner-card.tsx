import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon, copyText, useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { z } from "zod";

export const bannerCardSchema = z.object({
  icon: z.string(),
  title: z.string(),
  meta: z.array(z.string()),
  body: z.string(),
});

type BannerCardData = z.output<typeof bannerCardSchema>;

/** One line with an icon and metadata; expands to a monospace body when there is one. */
export function BannerCard({ item, theme, layout }: PluginTimelineItemProps<BannerCardData>) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const hasBody = item.data.body !== "";
  const styles = useMemo(
    () => ({
      card: {
        alignSelf: "flex-start" as const,
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
      title: { color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const },
      meta: { color: theme.colors.foregroundMuted, fontSize: 12 },
      body: {
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        padding: layout.compact ? 12 : 16,
        backgroundColor: theme.colors.surface0,
      },
      bodyText: { color: theme.colors.foreground, fontFamily: "monospace", fontSize: 12, lineHeight: 18 },
      footer: {
        flexDirection: "row" as const,
        justifyContent: "flex-end" as const,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
      },
      action: { color: theme.colors.accent, fontSize: 12 },
    }),
    [theme, layout.compact],
  );

  async function copyBody() {
    try {
      await copyText(item.data.body);
      toast.show("Copied", { variant: "success" });
    } catch {
      toast.error("Could not copy. Select the text and use Copy.");
    }
  }

  const header = (
    <>
      {hasBody ? (
        <Icon name={open ? "ChevronDown" : "ChevronRight"} size={16} color={theme.colors.foregroundMuted} />
      ) : null}
      <Icon name={item.data.icon} size={16} color={theme.colors.accent} />
      <Text style={styles.title}>{item.data.title}</Text>
      {item.data.meta.map((entry) => (
        <Text key={entry} style={styles.meta}>
          {entry}
        </Text>
      ))}
    </>
  );
  return (
    <View style={styles.card}>
      {hasBody ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${open ? "Collapse" : "Expand"} ${item.data.title}`}
          onPress={() => setOpen((value) => !value)}
          style={styles.header}
        >
          {header}
        </Pressable>
      ) : (
        <View style={styles.header}>{header}</View>
      )}
      {hasBody && open ? (
        <>
          <View style={styles.body}>
            <Text selectable style={styles.bodyText}>
              {item.data.body}
            </Text>
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
