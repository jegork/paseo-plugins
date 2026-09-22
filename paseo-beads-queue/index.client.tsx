import type { PluginClientContext } from "@getpaseo/plugin/client";
import { BeadsPanel } from "./client/panel";
import { QueueSettings } from "./client/settings";
import { BeadsTimelineRow } from "./client/timeline-row";
import { issueCreate, issueSource, timelineRow } from "./shared/beads";

const PANEL_ID = "beads-queue";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: PANEL_ID,
    title: "Beads",
    icon: "ListTodo",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: BeadsPanel,
  });
  client.addSettingsScreen({ id: "queue", title: "Beads queue", icon: "ListTodo", Component: QueueSettings });
  client.addTimelineRenderer({ kind: "beads-issue", version: 1, schema: timelineRow, Component: BeadsTimelineRow });
  client.addAttachmentSource(issueSource);

  client.addCommandCenterItem({
    id: "open-queue",
    title: "Open Beads queue",
    icon: "ListTodo",
    keywords: ["beads", "issues", "queue", "br"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel(PANEL_ID);
    },
  });

  client.addSlashCommand({
    name: "beads",
    description: "Quick-capture a Beads issue for this project",
    argumentHint: "<title>",
    context: "workspace",
    async onSubmit({ args, workspace, rpc, openPanel }) {
      if (!args.trim()) throw new Error("Usage: /beads <title>");
      await rpc(issueCreate, { root: workspace.projectRootPath, title: args.trim() });
      openPanel(PANEL_ID);
    },
  });

  return () => {};
}
