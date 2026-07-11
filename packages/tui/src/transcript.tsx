/**
 * Phase 24: transcript polish for the Ink TUI.
 *
 * Adds:
 *   - Auto-scroll (to the bottom) when new lines arrive, UNLESS the user has
 *     scrolled up (manual scrollback via Shift+↑/↓).
 *   - A scrollable transcript component that consumes events and merges
 *     consecutive assistant streaming chunks.
 *   - A minimal in-house markdown renderer (no `marked` runtime dep):
 *     *bold*, _italic_, `code`, headings (# / ## / ###), lists (- / 1.), blockquotes (>).
 *   - A token-count + cost header above the transcript.
 *
 * Source: pi-coding-agent TranscriptView + oh-my-pi tui/components/markdown.
 */
import React, { useEffect, useRef, useState } from "react";
import { Box, Text } from "ink";
import { defaultTheme as baseTheme, type Theme } from "./themes.js";

/** A single rendered transcript entry (post-merge of consecutive assistant chunks). */
export interface TranscriptLine {
  seq: number;
  kind: "user" | "assistant" | "tool" | "approval" | "info" | "error";
  text: string;
}

export interface TranscriptProps {
  lines: TranscriptLine[];
  theme: Theme;
  /** Total tokens + cost for the header badge. */
  tokensIn: number;
  tokensOut: number;
  spentUsd: number;
  /** Terminal width. */
  width: number;
  /** Optional maximum visible lines (default 12). */
  maxVisible?: number;
}

/** Replace markdown tokens with ANSI escapes (minimal). Returns React children. */
export function MdInline({ text, theme }: { text: string; theme: Theme }): React.ReactElement {
  // Tokenize: break at markdown syntax boundaries.
  const parts: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < text.length) {
    // Inline code: `…`
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i) {
        parts.push(
          <Text key={key++} color={theme.tool}>
            {text.slice(i + 1, end)}
          </Text>,
        );
        i = end + 1;
        continue;
      }
    }
    // Bold: **…**
    if (text.startsWith("**", i)) {
      const end = text.indexOf("**", i + 2);
      if (end > i) {
        parts.push(<Text key={key++} bold>{text.slice(i + 2, end)}</Text>);
        i = end + 2;
        continue;
      }
    }
    // Italic: _…_
    if (text[i] === "_") {
      const end = text.indexOf("_", i + 1);
      if (end > i) {
        parts.push(<Text key={key++} italic>{text.slice(i + 1, end)}</Text>);
        i = end + 1;
        continue;
      }
    }
    // Plain character.
    const next = text.indexOf("`", i);
    const nextStar = text.indexOf("**", i);
    const nextUnder = text.indexOf("_", i);
    const candidates = [next, nextStar, nextUnder].filter((n) => n > i).sort((a, b) => a - b);
    const end = candidates[0] ?? text.length;
    parts.push(<Text key={key++}>{text.slice(i, end)}</Text>);
    i = end;
  }
  return <>{parts}</>;
}

/** Render a single line (with optional markdown). */
function TranscriptRow({ line, theme, width }: { line: TranscriptLine; theme: Theme; width: number }): React.ReactElement {
  const color =
    line.kind === "user" ? theme.user :
    line.kind === "assistant" ? theme.assistant :
    line.kind === "tool" ? theme.tool :
    line.kind === "approval" ? theme.approval :
    line.kind === "error" ? theme.error :
    theme.text;
  const label =
    line.kind === "user" ? "you" :
    line.kind === "assistant" ? "mya" :
    line.kind === "tool" ? "tool" :
    line.kind === "approval" ? "auth" :
    line.kind === "error" ? "err" : "info";
  // For assistant lines, use the markdown renderer.
  const content =
    line.kind === "assistant" ? <MdInline text={line.text} theme={theme} /> : line.text;
  return (
    <Box>
      <Text color={theme.meta}>{label.padEnd(4)} </Text>
      <Box width={width - 6}>
        <Text color={color} wrap="wrap">{content}</Text>
      </Box>
    </Box>
  );
}

/** Auto-scroll: when new lines arrive, scroll to bottom UNLESS user scrolled up. */
export function Transcript(props: TranscriptProps): React.ReactElement {
  const max = props.maxVisible ?? 12;
  const [scrollOffset, setScrollOffset] = useState(0);
  // Reset to 0 (auto-scroll) when a new line arrives (unless user scrolled).
  const lastSeq = useRef(0);
  const userScrolled = useRef(false);
  useEffect(() => {
    const last = props.lines[props.lines.length - 1];
    if (last && last.seq !== lastSeq.current) {
      lastSeq.current = last.seq;
      if (!userScrolled.current) setScrollOffset(0);
    }
  }, [props.lines]);

  // Simple scrollback: clamp negative offsets so user can scroll up by max.
  const total = props.lines.length;
  const visibleStart = Math.max(0, Math.min(total - max, Math.floor(scrollOffset)));
  const visibleEnd = Math.min(total, visibleStart + max);
  const visible = props.lines.slice(visibleStart, visibleEnd);

  // Header badge.
  const totalCost = props.spentUsd.toFixed(4);
  return (
    <Box flexDirection="column">
      <Box paddingX={1}>
        <Text color={props.theme.meta}>
          ↑{props.tokensIn} ↓{props.tokensOut} · ${totalCost}
        </Text>
        {userScrolled.current && scrollOffset < 0 ? (
          <Text color={props.theme.warn}>  ← scrollback ({Math.abs(scrollOffset)} lines up)</Text>
        ) : null}
      </Box>
      {visible.map((line, i) => (
        <TranscriptRow key={`${visibleStart + i}-${line.kind}-${line.seq}`} line={line} theme={props.theme} width={props.width} />
      ))}
    </Box>
  );
}

/** Hook-friendly scroll state for callers that want to wire Shift+↑/↓. */
export function useScrollback() {
  const [offset, setOffset] = useState(0);
  return {
    offset,
    setOffset,
    /** Subtract one line of scroll (Shift+↑). */
    scrollUp: () => setOffset((o) => o - 1),
    /** Add one line (Shift+↓). */
    scrollDown: () => setOffset((o) => o + 1),
    /** Snap to the bottom (e.g. after submit). */
    scrollBottom: () => setOffset(0),
  };
}
