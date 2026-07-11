/**
 * Pi-quality transcript rendering. Rich markdown + tool cards + spinner.
 *
 * Key visual features (matching pi-coding-agent):
 *   - Markdown: # headers, ```code blocks``` (highlighted box), **bold**,
 *     _italic_, `inline code`, > quotes, - lists, --- hr
 *   - Tool calls: bordered box with colored title (toolPendingBg/toolSuccessBg)
 *   - Spinner: animated ● while model is thinking
 *   - Thinking text: dimmed <think>...</think> blocks
 *   - User messages: distinct background (userBg)
 */
import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { PiTheme } from "./pi-theme.js";
import { sanitize } from "./sanitize.js";

export interface RichLine {
  seq: number;
  kind: "user" | "assistant" | "tool" | "tool-result" | "approval" | "info" | "error" | "thinking";
  text: string;
  toolName?: string;
  toolResult?: string;
}

export interface RichTranscriptProps {
  lines: RichLine[];
  theme: PiTheme;
  busy: boolean;
  width: number;
  maxVisible?: number;
}

/** Animated spinner — cycles ●○ while busy. */
export function Spinner({ theme }: { theme: PiTheme }): React.ReactElement {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % frames.length), 80);
    return () => clearInterval(id);
  }, []);
  return <Text color={theme.accent}>{frames[frame]}</Text>;
}

/** Render markdown text — headers, bold, italic, code, quotes, lists. */
function Markdown({ text, theme }: { text: string; theme: PiTheme }): React.ReactNode {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    const t = sanitize(line);
    // Headers
    if (/^#{1,3}\s/.test(t)) {
      return <Text key={i} color={theme.mdHeading} bold>{t.replace(/^#+\s/, "")}</Text>;
    }
    // Code block delimiter
    if (t.startsWith("```")) {
      return <Text key={i} color={theme.mdCodeBlockBorder}>{t}</Text>;
    }
    // Inline code
    const parts = parseInline(t, theme);
    // Quote
    if (t.startsWith(">")) {
      return <Box key={i}><Text color={theme.mdQuote}>{t}</Text></Box>;
    }
    // List item
    if (/^[-*]\s/.test(t)) {
      return <Box key={i} paddingLeft={1}><Text color={theme.mdListBullet}>• </Text>{parts}</Box>;
    }
    // Numbered list
    if (/^\d+\.\s/.test(t)) {
      return <Box key={i} paddingLeft={1}>{parts}</Box>;
    }
    // HR
    if (/^---+$/.test(t.trim())) {
      return <Text key={i} color={theme.mdHr}>{"─".repeat(40)}</Text>;
    }
    // Normal
    if (!t.trim()) return <Text key={i}> </Text>;
    return <Text key={i}>{parts}</Text>;
  });
}

/** Parse inline markdown: **bold**, _italic_, `code`, [link](url). */
function parseInline(text: string, theme: PiTheme): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;
  while (remaining.length > 0) {
    // **bold**
    const bold = remaining.match(/^\*\*(.+?)\*\*/);
    if (bold) {
      parts.push(<Text key={key++} bold>{bold[1]}</Text>);
      remaining = remaining.slice(bold[0].length);
      continue;
    }
    // `code`
    const code = remaining.match(/^`([^`]+)`/);
    if (code) {
      parts.push(<Text key={key++} color={theme.mdCode} backgroundColor={theme.mdCodeBlock}> {code[1]} </Text>);
      remaining = remaining.slice(code[0].length);
      continue;
    }
    // _italic_
    const ital = remaining.match(/^_([^_]+)_/);
    if (ital) {
      parts.push(<Text key={key++} italic>{ital[1]}</Text>);
      remaining = remaining.slice(ital[0].length);
      continue;
    }
    // [link](url)
    const link = remaining.match(/^\[([^\]]+)\]\(([^)]+\))/);
    if (link) {
      parts.push(<Text key={key++} color={theme.mdLink}>{link[1]}</Text>);
      parts.push(<Text key={key++} color={theme.muted}> ({link[2]})</Text>);
      remaining = remaining.slice(link[0].length);
      continue;
    }
    // Normal text until next marker
    const next = remaining.search(/[*_`\[]/);
    if (next < 0 || next >= remaining.length) {
      parts.push(<Text key={key++}>{remaining}</Text>);
      break;
    }
    if (next > 0) {
      parts.push(<Text key={key++}>{remaining.slice(0, next)}</Text>);
      remaining = remaining.slice(next);
    } else {
      // Single char that didn't match a pattern
      parts.push(<Text key={key++}>{remaining[0]}</Text>);
      remaining = remaining.slice(1);
    }
  }
  return parts;
}

/** Tool card — bordered box with tool name + result. */
function ToolCard({ line, theme }: { line: RichLine; theme: PiTheme }): React.ReactElement {
  const name = sanitize(line.toolName ?? "tool");
  const result = sanitize(line.toolResult ?? line.text ?? "");
  const bg = line.kind === "error" ? theme.toolErrorBg : theme.toolSuccessBg;
  const shortResult = result.length > 200 ? result.slice(0, 200) + " …" : result;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.borderMuted} marginTop={0} marginBottom={0}>
      <Box>
        <Text backgroundColor={bg} color={theme.toolTitle} bold> {name} </Text>
      </Box>
      {shortResult ? (
        <Box paddingLeft={1}>
          <Text color={theme.toolOutput}>{shortResult}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

/** Single transcript row — dispatches by kind. */
function RichRow({ line, theme }: { line: RichLine; theme: PiTheme }): React.ReactNode {
  switch (line.kind) {
    case "user":
      return (
        <Box marginTop={0} marginBottom={0}>
          <Text backgroundColor={theme.userBg} color={theme.userText} bold> you </Text>
          <Text> {sanitize(line.text)}</Text>
        </Box>
      );
    case "assistant":
      return (
        <Box flexDirection="column" marginTop={0} marginBottom={0}>
          <Markdown text={line.text} theme={theme} />
        </Box>
      );
    case "thinking":
      return (
        <Box>
          <Text color={theme.thinkingText} dimColor>{sanitize(line.text)}</Text>
        </Box>
      );
    case "tool":
    case "tool-result":
      return <ToolCard line={line} theme={theme} />;
    case "approval":
      return (
        <Box>
          <Text color={theme.warning} bold>⚡ approval</Text>
          <Text color={theme.muted}> {sanitize(line.text)}</Text>
        </Box>
      );
    case "error":
      return (
        <Box>
          <Text color={theme.error} bold>✗ error</Text>
          <Text color={theme.error}> {sanitize(line.text)}</Text>
        </Box>
      );
    default:
      return (
        <Box>
          <Text color={theme.muted}> {sanitize(line.text)}</Text>
        </Box>
      );
  }
}

/** The main transcript component — renders lines + spinner when busy. */
export function RichTranscript(props: RichTranscriptProps): React.ReactElement {
  const max = props.maxVisible ?? 30;
  const visible = props.lines.slice(-max);
  return (
    <Box flexDirection="column" flexGrow={1}>
      {visible.map((line, i) => (
        <RichRow key={`${i}-${line.seq}-${line.kind}`} line={line} theme={props.theme} />
      ))}
      {props.busy && (
        <Box marginTop={1}>
          <Spinner theme={props.theme} />
          <Text color={props.theme.accent}> thinking…</Text>
        </Box>
      )}
    </Box>
  );
}
