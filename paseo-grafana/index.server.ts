import type { PluginServerContext } from "@getpaseo/plugin/server";
import { buildInvestigationPrompt, list, searchRules } from "./server/alerts";
import { search } from "./server/dashboards";
import { investigationPrompt, listAlerts, searchAlertRules, searchDashboards } from "./shared/grafana";

export default function contribute(server: PluginServerContext) {
  server.handle(listAlerts, list);
  server.handle(investigationPrompt, buildInvestigationPrompt);
  server.handle(searchAlertRules, searchRules);
  server.handle(searchDashboards, search);
  return () => {};
}
