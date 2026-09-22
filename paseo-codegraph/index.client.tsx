import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ImpactPanel } from "./client/panel";
import { symbolAttachments } from "./shared/codegraph";

export default function contribute(client: PluginClientContext) {
  client.addAttachmentSource(symbolAttachments);
  client.addWorkspacePanel({
    id: "impact",
    title: "Impact",
    icon: "Waypoints",
    context: "workspace",
    locations: ["explorer", "workspace"],
    Component: ImpactPanel,
  });
  client.addCommandCenterItem({
    id: "open-impact",
    title: "Open impact panel",
    icon: "Waypoints",
    keywords: ["codegraph", "impact", "affected", "dependents", "tests"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("impact");
    },
  });
  return () => {};
}
