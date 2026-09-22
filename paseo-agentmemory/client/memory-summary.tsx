import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { z } from "zod";

export const memorySummarySchema = z.object({
  title: z.string(),
  narrative: z.string(),
  keyDecisions: z.array(z.string()),
  concepts: z.array(z.string()),
  filesModified: z.array(z.string()),
  observationCount: z.number(),
  createdAt: z.string(),
});

type Data = z.output<typeof memorySummarySchema>;

/** What agentmemory kept from this session, appended once consolidation ran. */
export function MemorySummary({ item, theme, layout }: PluginTimelineItemProps<Data>) {
  const [open, setOpen] = useState(false);
  const styles = useMemo(
    () => ({
      card: { alignSelf: "stretch" as const, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1, overflow: "hidden" as const },
      header: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
      label: { color: theme.colors.foregroundMuted, fontSize: 12 },
      title: { color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const, flexShrink: 1 },
      body: { borderTopWidth: 1, borderTopColor: theme.colors.border, padding: layout.compact ? 12 : 16, gap: 10 },
      text: { color: theme.colors.foreground, fontSize: 13, lineHeight: 20 },
      heading: { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" as const },
      item: { flexDirection: "row" as const, gap: 8 },
      chip: { color: theme.colors.foregroundMuted, fontSize: 12 },
    }),
    [theme, layout.compact],
  );
  const d = item.data;
  return (
    <View style={styles.card}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${open ? "Collapse" : "Expand"} memory summary`} onPress={() => setOpen((v) => !v)} style={styles.header}>
        <Icon name={open ? "ChevronDown" : "ChevronRight"} size={16} color={theme.colors.foregroundMuted} />
        <Icon name="Brain" size={16} color={theme.colors.accent} />
        <Text style={styles.label}>Memory</Text>
        <Text style={styles.title} numberOfLines={open ? undefined : 1}>{d.title || "Session summary"}</Text>
        {!open ? <Text style={styles.label}>{`${d.keyDecisions.length} decisions`}</Text> : null}
      </Pressable>
      {open ? (
        <View style={styles.body}>
          {d.narrative ? <Text selectable style={styles.text}>{d.narrative}</Text> : null}
          {d.keyDecisions.length > 0 ? (
            <View style={{ gap: 4 }}>
              <Text style={styles.heading}>Decisions</Text>
              {d.keyDecisions.map((decision, i) => (
                <View key={i} style={styles.item}>
                  <Text style={styles.text}>•</Text>
                  <Text selectable style={[styles.text, { flex: 1 }]}>{decision}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {d.concepts.length > 0 ? <Text style={styles.chip}>{d.concepts.join(" · ")}</Text> : null}
          <Text style={styles.chip}>{`${d.observationCount} observations · ${d.filesModified.length} files`}</Text>
        </View>
      ) : null}
    </View>
  );
}
