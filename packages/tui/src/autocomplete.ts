/**
 * Phase 20: fuzzy autocomplete overlay for the Ink TUI.
 *
 * Pi-style popup above the input that filters slash commands (and, when
 * typing `@<path>`, file matches) as the user types.
 */
import React, { useMemo, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { filterCommands, type SlashCommand } from "./ink-commands.js";
import { defaultTheme as DARK_THEME, type Theme } from "./themes.js";

export interface Suggestion {
  label: string;
  description?: string;
  kbd?: string;
  insert: string;
}

export interface AutocompleteProps {
  draft: string;
  commands: SlashCommand[];
  theme: Theme;
  highlighted: number;
  onAccept: (suggestion: Suggestion | null) => void;
  onDismiss: () => void;
  onHighlightChange: (idx: number) => void;
}

/** Pure derivation — given a draft, return the matching suggestions. */
export function computeSuggestions(draft: string, commands: SlashCommand[]): Suggestion[] {
  if (draft.startsWith("/")) {
    const after = draft.slice(1);
    const space = after.indexOf(" ");
    const query = (space >= 0 ? after.slice(0, space) : after).trim();
    return filterCommands(query).map((c) => ({
      label: "/" + c.name,
      description: c.description,
      kbd: c.kbd,
      insert: space >= 0 ? "/" + c.name + " " + after.slice(space + 1) : "/" + c.name + " ",
    }));
  }
  const atMatch = draft.match(/@([^\s]*)$/);
  if (atMatch) {
    const path = atMatch[1] ?? "";
    if (path.length === 0) return [{ label: "@...", description: "type a relative path", insert: "@" }];
    return [{ label: "@" + path, description: "path (file picker coming in a later phase)", insert: "@" + path }];
  }
  return [];
}

/** The visible popup. Purely controlled. */
export function Autocomplete(props: AutocompleteProps): React.ReactElement | null {
  const suggestions = useMemo(() => computeSuggestions(props.draft, props.commands), [props.draft, props.commands]);

  useEffect(() => {
    props.onHighlightChange(0);
  }, [props.draft, props.onHighlightChange]);

  useInput((input, key) => {
    if (suggestions.length === 0) return;
    if (key.upArrow) {
      const i = props.highlighted <= 0 ? suggestions.length - 1 : props.highlighted - 1;
      props.onHighlightChange(i);
      return;
    }
    if (key.downArrow) {
      const i = props.highlighted >= suggestions.length - 1 ? 0 : props.highlighted + 1;
      props.onHighlightChange(i);
      return;
    }
    if (key.tab || (key.return && props.highlighted >= 0)) {
      const picked = suggestions[props.highlighted] ?? null;
      props.onAccept(picked);
      return;
    }
    if (key.escape || input === "\x1b") {
      props.onDismiss();
      return;
    }
  });

  if (suggestions.length === 0) return null;
  const visible = suggestions.slice(0, 5);
  const maxWidth = Math.max.apply(null, visible.map((s) => s.label.length).concat([10]));
  const t = props.theme;
  return React.createElement(
    Box,
    { flexDirection: "column", paddingX: 2 },
    ...visible.map((s, i) => {
      const highlighted = i === props.highlighted;
      const kbdText = s.kbd ? "  <" + String(s.kbd) + ">" : "";
      return React.createElement(
        Box,
        { key: s.label },
        React.createElement(Text, { color: highlighted ? t.user : t.meta }, s.label.padEnd(maxWidth) + " "),
        React.createElement(Text, { color: highlighted ? t.text : t.meta }, " " + (s.description ?? "")),
        s.kbd ? React.createElement(Text, { color: t.assistant }, kbdText) : null,
      );
    }),
  );
}

/** Re-export default theme for backward callers that imported baseTheme. */
export const baseTheme = DARK_THEME;
