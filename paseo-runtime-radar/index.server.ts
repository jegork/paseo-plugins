import type { PluginServerContext } from "@getpaseo/plugin/server";
import { containerAction, signalProcess, snapshotRuntime } from "./server/runtime.server";
import { containerActionRpc, preferences, runtimeSnapshotRpc, signalProcessRpc } from "./shared/runtime";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(preferences);
  server.handle(runtimeSnapshotRpc, snapshotRuntime);
  server.handle(signalProcessRpc, signalProcess);
  server.handle(containerActionRpc, containerAction);
  return () => {};
}
