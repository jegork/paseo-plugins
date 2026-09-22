import type { PluginClientContext } from "@getpaseo/plugin/client";
import { AlertsSurface } from "./client/alerts-surface";
import { alertRuleSource, dashboardSource, INVESTIGATION_PROVIDER, investigationPrompt } from "./shared/grafana";

const SURFACE_ID = "alerts";

export default function contribute(client: PluginClientContext) {
  client.addSurface(SURFACE_ID, AlertsSurface);
  client.addSidebarItem({
    id: SURFACE_ID,
    title: "Grafana",
    icon: "BellRing",
    surface: SURFACE_ID,
  });

  client.addAttachmentSource(dashboardSource);
  client.addAttachmentSource(alertRuleSource);

  client.addCommandCenterItem({
    id: "open-alerts",
    title: "Open Grafana alerts",
    icon: "BellRing",
    keywords: ["grafana", "alert", "firing"],
    context: "global",
    onSelect({ openSurface }) {
      openSurface(SURFACE_ID);
    },
  });

  client.addSlashCommand({
    name: "grafana-investigate",
    description: "Spawn an agent here to investigate a Grafana alert",
    argumentHint: "<rule name or uid>",
    context: "workspace",
    async onSubmit({ args, workspace, paseo, rpc }) {
      if (!args.trim()) throw new Error("Usage: /grafana-investigate <rule name or uid>");
      const { prompt, ruleName } = await rpc(investigationPrompt, { query: args });
      await paseo.workspaces.ref(workspace.id).agents.create({
        config: { provider: INVESTIGATION_PROVIDER },
        title: `Investigate: ${ruleName}`,
        prompt,
      });
    },
  });

  return () => {};
}
