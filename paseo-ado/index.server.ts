import type { PluginServerContext } from "@getpaseo/plugin/server";
import { create, list, overview } from "./server/pull-requests";
import { complete, mergeState } from "./server/merge";
import { failure } from "./server/runs";
import { pullRequests, workItems } from "./server/search";
import { prComplete, prCreate, prList, prMergeState, prOverview, runFailure, searchPullRequests, searchWorkItems } from "./shared/ado";

export default function contribute(server: PluginServerContext) {
  server.handle(prOverview, overview);
  server.handle(prList, list);
  server.handle(prCreate, create);
  server.handle(runFailure, failure);
  server.handle(prMergeState, mergeState);
  server.handle(prComplete, complete);
  server.handle(searchWorkItems, workItems);
  server.handle(searchPullRequests, pullRequests);
  return () => {};
}
