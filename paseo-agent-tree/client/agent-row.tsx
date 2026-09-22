import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Pressable, Text, View } from "react-native";
import {
  agentTitle,
  bucketOf,
  formatAge,
  modelLabel,
  stateLabel,
  waitingSince,
  type AgentFields,
  type TreeNode,
} from "../shared/tree";

const INDENT = 18;

export interface RowOptions {
  readonly showModel: boolean;
  readonly showLastError: boolean;
  readonly compact: boolean;
  readonly dense: boolean;
}

function statusColor(theme: PluginTheme, agent: AgentFields): string {
  const bucket = bucketOf(agent);
  if (agent.status === "error") return theme.colors.statusDanger;
  if (bucket === "attention") return theme.colors.statusWarning;
  if (bucket === "running") return theme.colors.accent;
  if (bucket === "closed") return theme.colors.border;
  return theme.colors.foregroundMuted;
}

export interface AgentRowProps {
  readonly node: TreeNode;
  readonly depth: number;
  readonly theme: PluginTheme;
  readonly options: RowOptions;
  readonly now: number;
  /** the workspace the branch is filed under, so a child elsewhere can say where it lives */
  readonly workspaceKey: string;
  readonly collapsed: ReadonlySet<string>;
  readonly armedAgentId: string | null;
  readonly onToggle: (agentId: string) => void;
  readonly onArchive: (agentId: string) => void;
  readonly onOpen: ((agentId: string) => void) | undefined;
}

export function AgentRow(props: AgentRowProps) {
  const { node, depth, theme, options, now, workspaceKey, collapsed, armedAgentId } = props;
  const { agent } = node;
  const elsewhere = (agent.workspaceId ?? agent.cwd) !== workspaceKey;
  const isCollapsed = collapsed.has(node.id);
  const armed = armedAgentId === node.id;
  const title = agentTitle(agent);
  const state = stateLabel(agent);
  const age = formatAge(waitingSince(agent), now);
  const attention = bucketOf(agent) === "attention";
  const error = options.showLastError && agent.status === "error" ? agent.lastError : undefined;

  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        {node.children.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${isCollapsed ? "Expand" : "Collapse"} subagents of ${title}`}
            onPress={() => props.onToggle(node.id)}
            style={{ paddingLeft: 6 + depth * INDENT, paddingRight: 2, paddingVertical: 6 }}
          >
            <Icon
              name={isCollapsed ? "ChevronRight" : "ChevronDown"}
              size={12}
              color={theme.colors.foregroundMuted}
            />
          </Pressable>
        ) : (
          <View style={{ width: 12 + 8 + depth * INDENT }} />
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open agent ${title}`}
          disabled={props.onOpen === undefined}
          onPress={() => props.onOpen?.(node.id)}
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingVertical: options.dense ? 4 : 7,
          }}
        >
          <View
            style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: statusColor(theme, agent) }}
          />
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              fontSize: 13,
              color: node.matched ? theme.colors.foreground : theme.colors.foregroundMuted,
              fontWeight: node.openTab ? "600" : "400",
            }}
          >
            {title}
          </Text>
          {isCollapsed && node.descendants > 0 ? (
            <Text style={{ fontSize: 11, color: theme.colors.foregroundMuted }}>
              {`${node.descendants} subagent${node.descendants === 1 ? "" : "s"}`}
            </Text>
          ) : null}
          {node.openTab ? <Icon name="AppWindow" size={12} color={theme.colors.foregroundMuted} /> : null}
          {options.showModel && !options.compact ? (
            <Text style={{ fontSize: 11, color: theme.colors.foregroundMuted }}>{modelLabel(agent)}</Text>
          ) : null}
          <Text
            style={{
              fontSize: 11,
              color: attention ? theme.colors.statusWarning : theme.colors.foregroundMuted,
              textAlign: "right",
            }}
          >
            {age === "" ? state : `${state} · ${age}`}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={armed ? `Confirm archiving ${title}` : `Archive ${title}`}
          onPress={() => props.onArchive(node.id)}
          style={{ paddingHorizontal: 10, paddingVertical: 6 }}
        >
          <Icon
            name={armed ? "Check" : "Archive"}
            size={13}
            color={armed ? theme.colors.statusDanger : theme.colors.foregroundMuted}
          />
        </Pressable>
      </View>
      {error !== undefined && error !== "" ? (
        <Text
          numberOfLines={2}
          style={{
            fontSize: 11,
            color: theme.colors.statusDanger,
            paddingLeft: 32 + depth * INDENT,
            paddingRight: 12,
            paddingBottom: 4,
          }}
        >
          {error}
        </Text>
      ) : null}
      {elsewhere ? (
        <Text
          style={{
            fontSize: 11,
            color: theme.colors.foregroundMuted,
            paddingLeft: 32 + depth * INDENT,
            paddingBottom: 4,
          }}
        >
          {node.project.workspaceName ?? agent.cwd}
        </Text>
      ) : null}
      {isCollapsed
        ? null
        : node.children.map((child) => (
            <AgentRow key={child.id} {...props} node={child} depth={depth + 1} />
          ))}
    </>
  );
}
