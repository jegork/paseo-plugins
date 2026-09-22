import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Text, View } from "react-native";
import type { TimelineRow } from "../shared/beads";

export function BeadsTimelineRow({ theme, item }: PluginTimelineItemProps<TimelineRow>) {
  const data = item.data;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 }}>
      <Icon name="ListTodo" size={14} color={theme.colors.accent} />
      <Text style={{ color: theme.colors.foreground, fontSize: 13, flexShrink: 1 }} numberOfLines={2}>
        {data.issueId} {data.title}
      </Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
        {data.status}{data.note ? ` · ${data.note}` : ""}
      </Text>
    </View>
  );
}
