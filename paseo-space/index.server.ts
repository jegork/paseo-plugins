import type { PluginServerContext } from "@getpaseo/plugin/server";
import { cleanCaches, pruneWorktrees, removeWorktree, snapshotSpace } from "./server/space.server";
import { cleanRpc, pruneRpc, removeWorktreeRpc, snapshotRpc } from "./shared/space";

export default function contribute(server: PluginServerContext) {
  server.handle(snapshotRpc, snapshotSpace);
  server.handle(cleanRpc, cleanCaches);
  server.handle(removeWorktreeRpc, removeWorktree);
  server.handle(pruneRpc, pruneWorktrees);
  return () => {};
}
