/**
 * Pi theme system — exact color tokens from pi-coding-agent dark.json.
 * Uses truecolor (24-bit) ANSI for hex colors, matching pi's rendering.
 */

// ─── Pi dark theme vars (from dark.json) ──────────────────────────────
export const PI_COLORS = {
  cyan: "#00d7ff",
  blue: "#5f87ff",
  green: "#b5bd68",
  red: "#cc6666",
  yellow: "#ffff00",
  text: "#d4d4d4",
  gray: "#808080",
  dimGray: "#666666",
  darkGray: "#505050",
  accent: "#8abeb7",

  // Backgrounds
  selectedBg: "#3a3a4a",
  userMsgBg: "#343541",
  toolPendingBg: "#282832",
  toolSuccessBg: "#283228",
  toolErrorBg: "#3c2828",
  customMsgBg: "#2d2838",

  // Markdown
  mdHeading: "#f0c674",
  mdLink: "#81a2be",
  mdLinkUrl: "#666666",
  mdCode: "#8abeb7",     // = accent
  mdCodeBlock: "#b5bd68", // = green
  mdCodeBlockBorder: "#808080",
  mdQuote: "#808080",
  mdQuoteBorder: "#808080",
  mdHr: "#808080",
  mdListBullet: "#8abeb7",

  // Tool diffs
  toolDiffAdded: "#b5bd68",
  toolDiffRemoved: "#cc6666",
  toolDiffContext: "#808080",

  // Syntax highlighting (VS Code dark+)
  syntaxComment: "#6A9955",
  syntaxKeyword: "#569CD6",
  syntaxFunction: "#DCDCAA",
  syntaxVariable: "#9CDCFE",
  syntaxString: "#CE9178",
  syntaxNumber: "#B5CEA8",
  syntaxType: "#4EC9B0",
  syntaxOperator: "#D4D4D4",
  syntaxPunctuation: "#D4D4D4",

  // Thinking levels
  thinkingOff: "#505050",
  thinkingMinimal: "#6e6e6e",
  thinkingLow: "#5f87af",
  thinkingMedium: "#81a2be",
  thinkingHigh: "#b294bb",
  thinkingXhigh: "#d183e8",
  thinkingMax: "#ff5fff",

  // Misc
  bashMode: "#b5bd68",
  customMessageLabel: "#9575cd",
} as const;

// ─── ANSI conversion ──────────────────────────────────────────────────
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** Foreground color: \x1b[38;2;R;G;Bm + text + \x1b[39m */
export function fg(color: keyof typeof PI_COLORS | string, text: string): string {
  const hex = PI_COLORS[color as keyof typeof PI_COLORS] ?? color;
  if (hex.startsWith("#")) {
    const { r, g, b } = hexToRgb(hex);
    return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
  }
  return text;
}

/** Background color: \x1b[48;2;R;G;Bm + text + \x1b[49m */
export function bg(color: keyof typeof PI_COLORS | string, text: string): string {
  const hex = PI_COLORS[color as keyof typeof PI_COLORS] ?? color;
  if (hex.startsWith("#")) {
    const { r, g, b } = hexToRgb(hex);
    return `\x1b[48;2;${r};${g};${b}m${text}\x1b[49m`;
  }
  return text;
}

/** Bold: \x1b[1m + text + \x1b[22m */
export function bold(text: string): string {
  return `\x1b[1m${text}\x1b[22m`;
}

/** Italic: \x1b[3m + text + \x1b[23m */
export function italic(text: string): string {
  return `\x1b[3m${text}\x1b[23m`;
}

/** Underline: \x1b[4m + text + \x1b[24m */
export function underline(text: string): string {
  return `\x1b[4m${text}\x1b[24m`;
}

/** Dim: \x1b[2m + text + \x1b[22m */
export function dim(text: string): string {
  return `\x1b[2m${text}\x1b[22m`;
}

// ─── Markdown theme for pi-tui ────────────────────────────────────────
import type { MarkdownTheme, EditorTheme } from "@earendil-works/pi-tui";

export const piMarkdownTheme: MarkdownTheme = {
  heading: (t) => fg("mdHeading", bold(t)),
  link: (t) => fg("mdLink", underline(t)),
  linkUrl: (t) => fg("mdLinkUrl", t),
  code: (t) => fg("mdCode", t),
  codeBlock: (t) => fg("mdCodeBlock", t),
  codeBlockBorder: (t) => fg("mdCodeBlockBorder", t),
  quote: (t) => fg("mdQuote", italic(t)),
  quoteBorder: (t) => fg("mdQuoteBorder", t),
  hr: (t) => fg("mdHr", t),
  listBullet: (t) => fg("mdListBullet", t),
  bold: (t) => bold(t),
  italic: (t) => italic(t),
  strikethrough: (t) => `\x1b[9m${t}\x1b[29m`,
  underline: (t) => underline(t),
};

export const piEditorTheme: EditorTheme = {
  borderColor: (t) => fg("darkGray", t),
  selectList: {
    selectedPrefix: (t) => fg("accent", t),
    selectedText: (t) => bold(t),
    description: (t) => fg("gray", t),
    scrollInfo: (t) => fg("gray", t),
    noMatch: (t) => fg("gray", t),
  },
};
