import type { PluginClientContext } from "@getpaseo/plugin/client";
import { MemorySummary, memorySummarySchema } from "./client/memory-summary";

export default function contribute(client: PluginClientContext) {
  client.addTimelineRenderer({ kind: "memory-summary", version: 1, schema: memorySummarySchema, Component: MemorySummary });
  return () => {};
}
