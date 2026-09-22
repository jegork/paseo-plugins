import type { PluginClientContext, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { LineagePanel } from "./client/lineage-panel";
import { contributeLineage } from "./client/lineage";
import { TreeSettingsScreen } from "./client/settings-screen";
import { TreeSurface } from "./client/tree-surface";

export default function contribute(client: PluginClientContext) {
  function Surface(props: PluginSurfaceProps) {
    return <TreeSurface {...props} onOpenSettings={() => client.openSettings("tree")} />;
  }

  const removeSettings = client.addSettingsScreen({
    id: "tree",
    title: "Tree settings",
    icon: "Settings",
    Component: TreeSettingsScreen,
  });
  const removeSurface = client.addSurface("tree", Surface);
  const removeSidebarItem = client.addSidebarItem({
    id: "tree",
    title: "Tree",
    icon: "ListTree",
    surface: "tree",
  });
  const removePanel = client.addWorkspacePanel({
    id: "lineage",
    title: "Lineage",
    icon: "CornerLeftUp",
    context: "agent",
    Component: LineagePanel,
  });
  const removeOpen = client.addCommandCenterItem({
    id: "open-tree",
    title: "Open agent tree",
    icon: "ListTree",
    keywords: ["agents", "handoff", "subagents", "navigate", "tabs"],
    context: "global",
    onSelect({ openSurface }) {
      openSurface("tree");
    },
  });
  const removeConfigure = client.addCommandCenterItem({
    id: "configure-tree",
    title: "Configure agent tree",
    icon: "Settings",
    keywords: ["settings", "preferences", "tree"],
    context: "global",
    onSelect({ openSettings }) {
      openSettings("tree");
    },
  });
  const removeLineage = contributeLineage(client);

  return () => {
    removeLineage();
    removeConfigure();
    removeOpen();
    removePanel();
    removeSidebarItem();
    removeSurface();
    removeSettings();
  };
}
