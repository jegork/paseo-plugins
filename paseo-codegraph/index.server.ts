import type { PluginServerContext } from "@getpaseo/plugin/server";
import { impactReport } from "./server/impact";
import { searchSymbols } from "./server/search";
import { impactReportRpc, searchSymbolsRpc } from "./shared/codegraph";

export default function contribute(server: PluginServerContext) {
  server.handle(searchSymbolsRpc, searchSymbols);
  server.handle(impactReportRpc, impactReport);
  return () => {};
}
