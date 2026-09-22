import { defineAttachmentSource, defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const attachmentItem = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  url: z.url(),
  text: z.string(),
  resourceType: z.string(),
});

export const alertInstance = z.object({
  ruleUid: z.string(),
  ruleName: z.string(),
  folder: z.string(),
  group: z.string(),
  state: z.string(),
  activeAt: z.string().nullable(),
  labels: z.record(z.string(), z.string()),
  summary: z.string().nullable(),
  description: z.string().nullable(),
  dashboardUrl: z.string().nullable(),
  url: z.url(),
});

export const listAlerts = defineRpc({
  name: "grafana.alerts.list",
  input: z.object({ includeNormal: z.boolean().default(false) }),
  output: z.object({ context: z.string(), server: z.string(), items: z.array(alertInstance) }),
});

export const investigationPrompt = defineRpc({
  name: "grafana.alerts.investigation-prompt",
  input: z.object({ query: z.string() }),
  output: z.object({ ruleName: z.string(), prompt: z.string() }),
});

export const searchDashboards = defineRpc({
  name: "grafana.dashboards.search",
  input: z.object({ query: z.string() }),
  output: z.object({ items: z.array(attachmentItem) }),
});

export const searchAlertRules = defineRpc({
  name: "grafana.alert-rules.search",
  input: z.object({ query: z.string() }),
  output: z.object({ items: z.array(attachmentItem) }),
});

export const dashboardSource = defineAttachmentSource({
  id: "grafana-dashboard",
  title: "Grafana dashboard",
  icon: "LayoutDashboard",
  pickerTitle: "Attach dashboard",
  searchPlaceholder: "Search dashboards by title",
  search: searchDashboards,
});

export const alertRuleSource = defineAttachmentSource({
  id: "grafana-alert-rule",
  title: "Grafana alert rule",
  icon: "BellRing",
  pickerTitle: "Attach alert rule",
  searchPlaceholder: "Search alert rules by name",
  search: searchAlertRules,
});

// provider/model for agents spawned by Investigate and /grafana-investigate
export const INVESTIGATION_PROVIDER = "claude/claude-sonnet-5";

export type AlertInstance = z.infer<typeof alertInstance>;
