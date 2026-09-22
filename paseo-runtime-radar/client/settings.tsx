import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { Text } from "react-native";
import { preferences } from "../shared/runtime";

export function RuntimeSettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(preferences);
  if (settings.status !== "ready") {
    return <Text style={{ color: theme.colors.foregroundMuted }}>{settings.status === "loading" ? "Loading…" : "Settings could not be read."}</Text>;
  }
  const { values, revision } = settings;
  return (
    <SettingsSection title="Display">
      <SettingsCard>
        <SettingsSelect
          label="Group by"
          hint="How the radar and the workspace panel bucket ports and containers."
          value={values.groupBy}
          options={[
            { label: "Workspace", value: "workspace" },
            { label: "Project", value: "project" },
            { label: "Kind (ports, then containers)", value: "kind" },
          ]}
          onValueChange={(groupBy) => void settings.save({ ...values, groupBy: groupBy as typeof values.groupBy }, revision)}
        />
        <SettingsSwitch
          label="Allow stop and kill"
          hint="Shows Stop, Force kill, Restart on rows. Every action asks first."
          value={values.allowActions}
          onValueChange={(allowActions) => void settings.save({ ...values, allowActions }, revision)}
        />
      </SettingsCard>
    </SettingsSection>
  );
}
