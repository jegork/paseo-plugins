import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";
import { treeSettings, type TreeSettingsValues } from "../shared/settings";

export function TreeSettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(treeSettings);

  if (settings.status !== "ready") {
    return (
      <View style={{ padding: 16 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
          {settings.status === "loading" ? "Loading settings" : settings.error}
        </Text>
      </View>
    );
  }

  const { values, revision } = settings;
  function update(patch: Partial<TreeSettingsValues>) {
    void settings.save({ ...values, ...patch }, revision);
  }

  return (
    <View style={{ gap: 16 }}>
      <SettingsSection title="Filters">
        <SettingsCard>
          <SettingsSwitch
            label="Hide closed agents"
            hint="Closed means the daemon holds no live session, not that the work finished"
            value={values.hideClosed}
            onValueChange={(next) => update({ hideClosed: next })}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Bulk archive">
        <SettingsCard>
          <SettingsSelect
            label="Only sweep agents closed for"
            hint="The bulk button never offers a thread that went dormant more recently"
            value={values.sweepAgeDays}
            options={[
              { label: "1 day", value: "1" },
              { label: "3 days", value: "3" },
              { label: "7 days", value: "7" },
              { label: "30 days", value: "30" },
            ]}
            onValueChange={(next) => update({ sweepAgeDays: next as TreeSettingsValues["sweepAgeDays"] })}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Display">
        <SettingsCard>
          <SettingsSelect
            label="Density"
            value={values.density}
            options={[
              { label: "Comfortable", value: "comfortable" },
              { label: "Compact", value: "compact" },
            ]}
            onValueChange={(next) => update({ density: next as TreeSettingsValues["density"] })}
          />
          <SettingsSwitch
            label="Diff stats"
            hint="Additions and deletions on workspace headers"
            value={values.showDiffStats}
            onValueChange={(next) => update({ showDiffStats: next })}
          />
          <SettingsSwitch
            label="Model"
            hint="Show the model on each agent row"
            value={values.showModel}
            onValueChange={(next) => update({ showModel: next })}
          />
          <SettingsSwitch
            label="Last error"
            hint="Show the failure under an erroring agent"
            value={values.showLastError}
            onValueChange={(next) => update({ showLastError: next })}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Status">
        <SettingsCard>
          <SettingsAction
            label="Restore default settings"
            hint="Shared by every client connected to this host"
            actionLabel="Reset"
            onPress={() => void settings.reset()}
          />
        </SettingsCard>
      </SettingsSection>
      {settings.saveError === null ? null : (
        <Text style={{ color: theme.colors.statusDanger, fontSize: 12, paddingHorizontal: 16 }}>
          {settings.saveError}
        </Text>
      )}
    </View>
  );
}
