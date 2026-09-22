import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { View } from "react-native";
import { z } from "zod";
import { Markdown } from "./markdown";

export const proseCardSchema = z.object({ text: z.string() });

/** The model's own words from a row that also carried a hub delivery; no card chrome. */
export function ProseCard({ item, theme, layout }: PluginTimelineItemProps<z.output<typeof proseCardSchema>>) {
  return (
    <View style={{ paddingVertical: 4 }}>
      <Markdown text={item.data.text} theme={theme} compact={layout.compact} />
    </View>
  );
}
