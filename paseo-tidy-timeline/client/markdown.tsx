import type { PluginHostProps } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import { Linking, Platform, Text, View } from "react-native";
import { parseMarkdown, type Block, type Span } from "../shared/markdown";

type Theme = PluginHostProps["theme"];

function useMarkdownStyles(theme: Theme, compact: boolean) {
  return useMemo(
    () => ({
      stack: { gap: compact ? 8 : 10 },
      text: { color: theme.colors.foreground, fontSize: 13, lineHeight: 20 },
      code: {
        color: theme.colors.foreground,
        fontFamily: "monospace",
        fontSize: 12,
        backgroundColor: theme.colors.surface2,
        borderRadius: 4,
        paddingHorizontal: 3,
      },
      bold: { fontWeight: "600" as const },
      link: { color: theme.colors.accent, textDecorationLine: "underline" as const },
      italic: { fontStyle: "italic" as const },
      heading: (level: number) => ({
        color: theme.colors.foreground,
        fontSize: level <= 2 ? 16 : 14,
        fontWeight: "600" as const,
        lineHeight: 22,
      }),
      item: { flexDirection: "row" as const, gap: 8, paddingLeft: 4 },
      marker: { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 20, minWidth: 16 },
      block: {
        fontFamily: "monospace",
        fontSize: 12,
        lineHeight: 18,
        color: theme.colors.foreground,
        backgroundColor: theme.colors.surface0,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 8,
        padding: 10,
      },
    }),
    [theme, compact],
  );
}

type Styles = ReturnType<typeof useMarkdownStyles>;

// the plugin typechecks without the dom lib; declare only what the web branch uses
declare const window: { open(url: string, target: string, features: string): unknown };

function openLink(url: string): void {
  if (Platform.OS === "web") {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  void Linking.openURL(url);
}

function Spans({ spans, styles }: { spans: Span[]; styles: Styles }) {
  return (
    <>
      {spans.map((span, index) => (
        <Text
          key={index}
          style={[span.code ? styles.code : null, span.bold ? styles.bold : null, span.italic ? styles.italic : null, span.href ? styles.link : null]}
          onPress={span.href ? () => openLink(span.href as string) : undefined}
          accessibilityRole={span.href ? "link" : undefined}
        >
          {span.text}
        </Text>
      ))}
    </>
  );
}

function BlockView({ block, styles }: { block: Block; styles: Styles }) {
  switch (block.type) {
    case "paragraph":
      return (
        <Text selectable style={styles.text}>
          <Spans spans={block.spans} styles={styles} />
        </Text>
      );
    case "heading":
      return (
        <Text selectable style={styles.heading(block.level)}>
          <Spans spans={block.spans} styles={styles} />
        </Text>
      );
    case "list":
      return (
        <View style={styles.stack}>
          {block.items.map((item, index) => (
            <View key={index} style={styles.item}>
              <Text style={styles.marker}>{block.ordered ? `${index + 1}.` : "•"}</Text>
              <Text selectable style={[styles.text, { flex: 1 }]}>
                <Spans spans={item} styles={styles} />
              </Text>
            </View>
          ))}
        </View>
      );
    case "code":
      return (
        <Text selectable style={styles.block}>
          {block.text}
        </Text>
      );
  }
}

/** Renders the markdown subset the parser understands; everything else is literal. */
export function Markdown({ text, theme, compact }: { text: string; theme: Theme; compact: boolean }) {
  const styles = useMarkdownStyles(theme, compact);
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <View style={styles.stack}>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} styles={styles} />
      ))}
    </View>
  );
}
