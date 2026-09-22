import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createBridge } from "./server/bridge.server";

export default function contribute(server: PluginServerContext) {
  return createBridge(server);
}
