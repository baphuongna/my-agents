/**
 * Pi-quality theme (51-token). Match pi-coding-agent's visual identity.
 * Rich color palette: accents, backgrounds, markdown, syntax, tool diffs.
 */
export interface PiTheme {
  // Core UI
  accent: string;
  border: string;
  borderAccent: string;
  borderMuted: string;
  success: string;
  error: string;
  warning: string;
  muted: string;
  dim: string;
  text: string;
  thinkingText: string;
  // Backgrounds
  userBg: string;
  userText: string;
  toolPendingBg: string;
  toolSuccessBg: string;
  toolErrorBg: string;
  toolTitle: string;
  toolOutput: string;
  // Markdown
  mdHeading: string;
  mdLink: string;
  mdCode: string;
  mdCodeBlock: string;
  mdCodeBlockBorder: string;
  mdQuote: string;
  mdListBullet: string;
  mdHr: string;
  // Tool diffs
  diffAdded: string;
  diffRemoved: string;
  diffContext: string;
}

/** Default dark theme — vibrant, high-contrast (matches pi default). */
export const PI_DARK: PiTheme = {
  accent: "#7dd3fc",
  border: "#3b4252",
  borderAccent: "#7dd3fc",
  borderMuted: "#2e3440",
  success: "#a3e635",
  error: "#f87171",
  warning: "#fbbf24",
  muted: "#6b7280",
  dim: "#4b5563",
  text: "#e5e7eb",
  thinkingText: "#6b7280",
  userBg: "#1e293b",
  userText: "#a3e635",
  toolPendingBg: "#1e1b4b",
  toolSuccessBg: "#052e16",
  toolErrorBg: "#450a0a",
  toolTitle: "#c084fc",
  toolOutput: "#94a3b8",
  mdHeading: "#fbbf24",
  mdLink: "#7dd3fc",
  mdCode: "#c084fc",
  mdCodeBlock: "#1e293b",
  mdCodeBlockBorder: "#3b4252",
  mdQuote: "#6b7280",
  mdListBullet: "#7dd3fc",
  mdHr: "#3b4252",
  diffAdded: "#22c55e",
  diffRemoved: "#ef4444",
  diffContext: "#6b7280",
};

/** Light theme — for bright terminals. */
export const PI_LIGHT: PiTheme = {
  ...PI_DARK,
  text: "#1f2937",
  muted: "#9ca3af",
  dim: "#d1d5db",
  border: "#e5e7eb",
  borderMuted: "#f3f4f6",
  userBg: "#f0f9ff",
  userText: "#059669",
  toolPendingBg: "#eef2ff",
  toolSuccessBg: "#f0fdf4",
  toolErrorBg: "#fef2f2",
  thinkingText: "#9ca3af",
  mdCodeBlock: "#f8fafc",
  mdCodeBlockBorder: "#e2e8f0",
};

export function getTheme(name?: string): PiTheme {
  if (name === "light") return PI_LIGHT;
  return PI_DARK;
}
