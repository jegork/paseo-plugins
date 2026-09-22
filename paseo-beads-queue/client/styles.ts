import type { PluginTheme } from "@getpaseo/plugin";

export function makeStyles(theme: PluginTheme, compact: boolean) {
  const c = theme.colors;
  const pad = compact ? 12 : 16;
  return {
    screen: { flex: 1, backgroundColor: c.surface0 },
    header: { paddingHorizontal: pad, paddingTop: pad, paddingBottom: 8, gap: 8 },
    row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
    wrap: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, flexWrap: "wrap" as const },
    heading: { color: c.foreground, fontSize: compact ? 15 : 16, fontWeight: "600" as const },
    body: { color: c.foreground, fontSize: 13, lineHeight: 18 },
    muted: { color: c.foregroundMuted, fontSize: 12 },
    mono: { color: c.foregroundMuted, fontSize: 12 },
    danger: { color: c.statusDanger, fontSize: 12 },
    board: { flexDirection: "row" as const, gap: 12, paddingHorizontal: pad, paddingBottom: pad, alignItems: "flex-start" as const },
    column: { flex: 1, minWidth: 240, maxWidth: 420, gap: 8 },
    columnHeader: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, paddingHorizontal: 2, paddingBottom: 2 },
    columnTitle: { color: c.foreground, fontSize: 12, fontWeight: "600" as const, textTransform: "uppercase" as const, letterSpacing: 0.6 },
    count: { color: c.foregroundMuted, fontSize: 12, backgroundColor: c.surface1, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1, overflow: "hidden" as const },
    empty: { borderWidth: 1, borderStyle: "dashed" as const, borderColor: c.border, borderRadius: 10, padding: 14, alignItems: "center" as const },
    emptyText: { color: c.foregroundMuted, fontSize: 12 },
    card: { backgroundColor: c.surface1, borderRadius: 10, padding: 10, gap: 6, borderWidth: 1, borderColor: c.border },
    cardTop: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 8 },
    priority: { fontSize: 11, fontWeight: "700" as const, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, overflow: "hidden" as const },
    chip: { paddingVertical: 1, paddingHorizontal: 7, borderRadius: 999, backgroundColor: c.surface2 },
    chipText: { color: c.foregroundMuted, fontSize: 11 },
    tab: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: c.border },
    tabOn: { backgroundColor: c.accent, borderColor: c.accent },
    tabText: { color: c.foreground, fontSize: 12 },
    tabTextOn: { color: c.accentForeground, fontSize: 12, fontWeight: "600" as const },
    button: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 7, backgroundColor: c.accent },
    buttonText: { color: c.accentForeground, fontSize: 12, fontWeight: "600" as const },
    ghost: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 7, borderWidth: 1, borderColor: c.border },
    ghostText: { color: c.foreground, fontSize: 12 },
    iconButton: { padding: 6, borderRadius: 7 },
    input: { color: c.foreground, backgroundColor: c.surface2, borderColor: c.border, borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 14 },
    modalMeta: { color: c.foregroundMuted, fontSize: 12 },
  };
}

export function priorityStyle(priority: number, theme: PluginTheme): { color: string; backgroundColor: string } {
  const c = theme.colors;
  if (priority === 0) return { color: c.accentForeground, backgroundColor: c.statusDanger };
  if (priority === 1) return { color: c.accentForeground, backgroundColor: c.statusWarning };
  return { color: c.foregroundMuted, backgroundColor: c.surface2 };
}
