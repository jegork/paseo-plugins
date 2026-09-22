import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SpacePanel } from "./client/panel";
import { SpaceSurface } from "./client/surface";

export default function contribute(client: PluginClientContext) {
  client.addSurface("space", SpaceSurface);
  client.addSidebarItem({ id: "space", title: "Space", icon: "HardDrive", surface: "space" });
  client.addWorkspacePanel({
    id: "space",
    title: "Space",
    icon: "HardDrive",
    context: "workspace",
    locations: ["explorer", "workspace"],
    Component: SpacePanel,
  });
  client.addCommandCenterItem({
    id: "open-space",
    title: "Open space manager",
    icon: "HardDrive",
    keywords: ["disk", "worktrees", "node_modules", "cleanup"],
    context: "global",
    onSelect({ openSurface }) {
      openSurface("space");
    },
  });
  client.addCommandCenterItem({
    id: "open-space-panel",
    title: "Open space panel",
    icon: "HardDrive",
    keywords: ["disk", "worktrees", "node_modules", "cleanup"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("space");
    },
  });
  return () => {};
}
