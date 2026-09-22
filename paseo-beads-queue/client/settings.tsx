import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsInput, SettingsRow, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Text } from "react-native";
import { configGet, configRemoveProject, configSetGlobal, configSetProject } from "../shared/beads";

export function QueueSettings({ theme }: PluginSurfaceProps) {
  const getConfig = useRpc(configGet);
  const setGlobal = useRpc(configSetGlobal);
  const setProject = useRpc(configSetProject);
  const removeProject = useRpc(configRemoveProject);
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: ["beads", "config"], queryFn: () => getConfig({}), refetchInterval: 15_000 });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["beads", "config"] });
  const global = useMutation({ mutationFn: setGlobal, onSuccess: refresh });
  const project = useMutation({ mutationFn: setProject, onSuccess: refresh });
  const remove = useMutation({ mutationFn: removeProject, onSuccess: refresh });

  if (!config.data) return <Text style={{ color: theme.colors.foregroundMuted }}>Loading…</Text>;
  const { global: g, projects, status } = config.data;

  return (
    <>
      <SettingsSection title="Dispatcher">
        <SettingsCard>
          <SettingsSwitch label="Paused" hint="Stops automatic dispatch on every project. Manual dispatch still works." value={g.paused} onValueChange={(paused) => global.mutate({ paused })} />
          <SettingsInput label="Poll interval (seconds)" initialValue={String(g.pollSeconds)} onChangeText={(v) => { const n = Number(v); if (Number.isInteger(n) && n >= 10) global.mutate({ pollSeconds: n }); }} />
          <SettingsInput label="Default provider" hint="provider/model for dispatched agents" initialValue={g.provider} onChangeText={(provider) => { if (provider.includes("/")) global.mutate({ provider }); }} />
          <SettingsInput label="Actor name" hint="Recorded on claims and comments made by the dispatcher" initialValue={g.actor} onChangeText={(actor) => { if (actor.trim()) global.mutate({ actor: actor.trim() }); }} />
          <SettingsRow label="Status" hint={status.lastError ?? undefined}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
              {status.active.length} active · last poll {status.lastPollAt ? status.lastPollAt.slice(11, 19) : "never"}
            </Text>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Projects" info="Enable a project from its Beads workspace panel">
        {projects.length === 0 ? <Text style={{ color: theme.colors.foregroundMuted }}>No projects enabled.</Text> : null}
        {projects.map((p) => (
          <SettingsCard key={p.root}>
            <SettingsRow label={p.root.split("/").pop() ?? p.root} hint={p.root} />
            <SettingsSelect label="Storage" value={p.mode} options={[{ label: "External (~/.paseo/beads)", value: "external" }, { label: "In repo (.beads)", value: "repo" }]} onValueChange={(mode) => project.mutate({ root: p.root, mode })} />
            <SettingsSwitch label="Auto-dispatch" value={p.autoDispatch} onValueChange={(autoDispatch) => project.mutate({ root: p.root, autoDispatch })} />
            <SettingsSelect label="Isolation" value={p.isolation} options={[{ label: "Worktree per issue", value: "worktree" }, { label: "Project directory", value: "directory" }]} onValueChange={(isolation) => project.mutate({ root: p.root, isolation })} />
            <SettingsSelect label="Concurrent agents" value={String(p.maxConcurrent)} options={[1, 2, 3, 4].map((n) => ({ label: String(n), value: String(n) }))} onValueChange={(v) => project.mutate({ root: p.root, maxConcurrent: Number(v) })} />
            <SettingsInput label="Provider override" hint="Leave empty to use the default" initialValue={p.provider ?? ""} onChangeText={(v) => project.mutate({ root: p.root, provider: v.includes("/") ? v : null })} />
            <SettingsAction label="Remove" hint="Forgets the configuration; issues are kept on disk" actionLabel="Remove" onPress={() => remove.mutate({ root: p.root })} />
          </SettingsCard>
        ))}
      </SettingsSection>
    </>
  );
}
