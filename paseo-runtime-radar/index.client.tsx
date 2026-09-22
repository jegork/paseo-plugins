import type { PluginClientContext } from "@getpaseo/plugin/client";
import { RuntimePanel } from "./client/panel";
import { RuntimeSettings } from "./client/settings";
import { RuntimeSurface } from "./client/surface";

export default function contribute(client: PluginClientContext) {
  client.addSurface("radar", RuntimeSurface);
  client.addSidebarItem({ id: "radar", title: "Runtime radar", icon: "RadioTower", surface: "radar" });
  client.addWorkspacePanel({
    id: "runtime",
    title: "Runtime",
    icon: "RadioTower",
    context: "workspace",
    locations: ["explorer", "workspace"],
    Component: RuntimePanel,
  });
  client.addCommandCenterItem({
    id: "open-runtime",
    title: "Open runtime panel",
    icon: "RadioTower",
    keywords: ["ports", "docker", "containers"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("runtime");
    },
  });
  client.addSettingsScreen({ id: "display", title: "Runtime radar", icon: "RadioTower", Component: RuntimeSettings });
  client.addCommandCenterItem({
    id: "open-radar",
    title: "Open runtime radar",
    icon: "RadioTower",
    keywords: ["ports", "docker", "containers"],
    context: "global",
    onSelect({ openSurface }) {
      openSurface("radar");
    },
  });
  return () => {};
}
