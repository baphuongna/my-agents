/**
 * Phase 22: interactive selectors (modal pickers) for the Ink TUI.
 *
 * Three components, all `↑/↓ + Enter` driven:
 *   - <ModelSelector>  — single-select list of models from provider.list()
 *   - <SkillSelector>  — single-select list of loaded skills
 *   - <ToolSelector>   — multi-select checkbox list of registered tools
 *
 * Each component is shown as a modal overlay; on selection (or cancel) it
 * resolves a promise via `onResolve(value | null)` and unmounts.
 */
import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { defaultTheme as base, type Theme } from "./themes.js";

/** Common selector props. */
interface SelectorProps<T> {
  items: T[];
  /** Returns the display label for each item. */
  labelOf: (item: T) => string;
  /** Returns the optional description. */
  descOf?: (item: T) => string | undefined;
  /** Title bar at the top of the modal. */
  title: string;
  /** Multi-select? (default: false). */
  multi?: boolean;
  /** Theme to render with. */
  theme: Theme;
  /** Resolves with the chosen value (single) or values (multi). */
  onResolve: (value: T | T[] | null) => void;
  /** Optional getter for an item's stable id. */
  keyOf?: (item: T) => string;
}

function uniqBy<T>(items: T[], k: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const id = k(it);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(it);
  }
  return out;
}

interface ItemBase<T> {
  item: T;
  highlighted: boolean;
  selected: boolean;
}

/** A generic vertical list picker — backing both single + multi. */
function Picker<T>(props: SelectorProps<T>): React.ReactElement {
  const { items, title, multi = false, theme, onResolve } = props;
  const dedup = props.keyOf ? uniqBy(items, props.keyOf) : items;
  const [idx, setIdx] = useState(0);
  const [checked, setChecked] = useState<Set<number>>(new Set());

  useInput((input, key) => {
    if (key.upArrow) {
      setIdx((i) => (i <= 0 ? dedup.length - 1 : i - 1));
      return;
    }
    if (key.downArrow) {
      setIdx((i) => (i >= dedup.length - 1 ? 0 : i + 1));
      return;
    }
    if (input === " " && multi) {
      // Space toggles the current item.
      setChecked((prev) => {
        const next = new Set(prev);
        if (next.has(idx)) next.delete(idx);
        else next.add(idx);
        return next;
      });
      return;
    }
    if (key.return) {
      if (multi) {
        const picked = Array.from(checked).map((i) => dedup[i]!);
        onResolve(picked.length > 0 ? picked : dedup[idx] ? [dedup[idx]!] : null);
      } else {
        onResolve(dedup[idx] ?? null);
      }
      return;
    }
    if (key.escape || (input === "\u001b")) {
      onResolve(null);
      return;
    }
  });

  if (dedup.length === 0) {
    useEffect(() => {
      onResolve(null);
    }, []);
    return (
      <Box borderStyle="round" borderColor={theme.warn} paddingX={1} flexDirection="column">
        <Text color={theme.warn}>{title}</Text>
        <Text dimColor>(empty)</Text>
      </Box>
    );
  }

  return (
    <Box borderStyle="round" borderColor={theme.meta} paddingX={1} flexDirection="column">
      <Text color={theme.meta}>
        {title}
        {multi ? "  (Space to toggle, Enter to confirm, Esc to cancel)" : "  (↑/↓ + Enter, Esc to cancel)"}
      </Text>
      {dedup.map((it, i) => {
        const isHi = i === idx;
        const isCk = multi && checked.has(i);
        return (
          <Box key={i}>
            <Text color={isHi ? theme.user : theme.text}>
              {isHi ? "> " : "  "}
              {multi ? (isCk ? "[x] " : "[ ] ") : ""}
              {props.labelOf(it)}
            </Text>
            <Text color={theme.meta}> {props.descOf?.(it) ?? ""}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

/** Single-select modal — returns the chosen item (or null). */
export interface ModelSelectorProps<T> extends SelectorProps<T> {}
export function ModelSelector<T>(props: ModelSelectorProps<T>): React.ReactElement {
  return <Picker {...props} title="select a model" multi={false} />;
}

/** Single-select modal for skills. */
export function SkillSelector<T>(props: SelectorProps<T>): React.ReactElement {
  return <Picker {...props} title="select a skill" multi={false} />;
}

/** Multi-select modal for tools. */
export function ToolSelector<T>(props: SelectorProps<T>): React.ReactElement {
  return <Picker {...props} title="select tools (Space to toggle, Enter to confirm)" multi={true} />;
}

/** Convenience: render the right picker given a kind. */
export interface SelectorKind {
  kind: "model" | "skill" | "tool";
  items: unknown[];
  labelOf: (x: unknown) => string;
  descOf?: (x: unknown) => string | undefined;
  keyOf?: (x: unknown) => string;
  multi?: boolean;
  theme: Theme;
  onResolve: (v: unknown | unknown[] | null) => void;
}
export function renderSelector(props: SelectorKind): React.ReactElement {
  const base = {
    title: "select",
    items: props.items,
    labelOf: props.labelOf,
    descOf: props.descOf,
    keyOf: props.keyOf,
    onResolve: props.onResolve,
    theme: props.theme,
  };
  if (props.kind === "model") return <Picker {...base} title="select a model" />;
  if (props.kind === "skill") return <Picker {...base} title="select a skill" />;
  return <Picker {...base} title="select tools (Space to toggle, Enter)" multi={true} />;
}
