import type { PluginServerContext } from "@getpaseo/plugin/server";
import { treeSettings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(treeSettings);
  return () => {};
}
