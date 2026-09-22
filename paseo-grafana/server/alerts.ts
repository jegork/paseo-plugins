import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { AlertInstance, investigationPrompt, listAlerts, searchAlertRules } from "../shared/grafana";
import { currentContext, gcx } from "./gcx";

interface GcxAlertInstance {
  ruleUid: string;
  ruleName: string;
  groupName: string;
  folderUid: string;
  state: string;
  activeAt: string | null;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

interface GcxRule {
  name: string;
  uid: string;
  state: string;
  health: string;
  type: string;
  query: string;
  folderUid: string;
  isPaused: boolean;
  labels: Record<string, string>;
  annotations: Record<string, string>;
}

interface GcxRuleGroup {
  name: string;
  file: string;
  folderUid: string;
  rules: GcxRule[];
}

function ruleUrl(server: string, uid: string): string {
  return `${server}/alerting/grafana/${uid}/view`;
}

function withAnnotations(instance: GcxAlertInstance) {
  const annotations = instance.annotations ?? {};
  return {
    summary: annotations.summary ?? null,
    description: annotations.description ?? null,
    dashboardUrl: annotations.dashboard_url ?? null,
  };
}

function isActive(state: string): boolean {
  return /firing|pending|alerting/i.test(state);
}

export async function list({ includeNormal }: RpcInput<typeof listAlerts>): Promise<RpcOutput<typeof listAlerts>> {
  const [context, instances] = await Promise.all([currentContext(), gcx<GcxAlertInstance[]>(["alert", "instances", "list"])]);
  const items: AlertInstance[] = instances
    .filter((instance) => includeNormal || isActive(instance.state))
    .map((instance) => ({
      ...withAnnotations(instance),
      ruleUid: instance.ruleUid,
      ruleName: instance.ruleName,
      folder: instance.labels?.grafana_folder ?? instance.folderUid,
      group: instance.groupName,
      state: instance.state,
      activeAt: instance.activeAt ?? null,
      labels: Object.fromEntries(Object.entries(instance.labels ?? {}).filter(([key]) => !key.startsWith("__"))),
      url: ruleUrl(context.server, instance.ruleUid),
    }))
    .sort((a, b) => Number(isActive(b.state)) - Number(isActive(a.state)) || a.ruleName.localeCompare(b.ruleName));
  return { context: context.name, server: context.server, items };
}

async function findRules(query: string): Promise<GcxRule[]> {
  const groups = await gcx<GcxRuleGroup[]>(["alert", "rules", "list", "--limit", "0"]);
  const needle = query.trim().toLowerCase();
  return groups.flatMap((group) => group.rules).filter(
    (rule) => !needle || rule.uid === query.trim() || rule.name.toLowerCase().includes(needle),
  );
}

function describeRule(rule: GcxRule, server: string): string {
  const labels = Object.entries(rule.labels ?? {}).map(([k, v]) => `${k}=${v}`).join(", ");
  return [
    `Alert rule: ${rule.name} (uid ${rule.uid})`,
    `State: ${rule.state} · Health: ${rule.health}${rule.isPaused ? " · paused" : ""}`,
    labels ? `Labels: ${labels}` : "",
    rule.annotations?.summary ? `Summary: ${rule.annotations.summary}` : "",
    rule.annotations?.description ? `Description: ${rule.annotations.description}` : "",
    rule.annotations?.runbook_url ? `Runbook: ${rule.annotations.runbook_url}` : "",
    rule.annotations?.dashboard_url ? `Dashboard: ${rule.annotations.dashboard_url}` : "",
    `URL: ${ruleUrl(server, rule.uid)}`,
    rule.query ? `\nQuery:\n${rule.query}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function searchRules({ query }: RpcInput<typeof searchAlertRules>): Promise<RpcOutput<typeof searchAlertRules>> {
  const [context, rules] = await Promise.all([currentContext(), findRules(query)]);
  return {
    items: rules.slice(0, 25).map((rule) => ({
      id: rule.uid,
      identifier: "",
      title: rule.name,
      subtitle: [rule.state, rule.health].join(" · "),
      url: ruleUrl(context.server, rule.uid),
      text: describeRule(rule, context.server),
      resourceType: "alert-rule",
    })),
  };
}

export async function buildInvestigationPrompt({ query }: RpcInput<typeof investigationPrompt>): Promise<RpcOutput<typeof investigationPrompt>> {
  const [context, rules] = await Promise.all([currentContext(), findRules(query)]);
  const rule = rules.find((candidate) => candidate.uid === query.trim()) ?? rules[0];
  if (!rule) throw new Error(`No Grafana alert rule matches "${query}"`);
  const prompt = [
    `Investigate the Grafana alert "${rule.name}" on context ${context.name} (${context.server}).`,
    "",
    describeRule(rule, context.server),
    "",
    "Use the investigate-alert and debug-with-grafana skills with the gcx CLI. Establish why the alert is in its current state, its scope, and the likely root cause. Do not change alert rules or dashboards. Finish with a short report: what fired, what the data shows, root cause or best hypothesis, and suggested next steps.",
  ].join("\n");
  return { ruleName: rule.name, prompt };
}
