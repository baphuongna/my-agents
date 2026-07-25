/**
 * Badge mapping helpers — typed badge-config lookups.
 *
 * Port of Hermes's badge-mapping pattern (ChannelsPage STATE_BADGE,
 * McpPage TRANSPORT_TONE, SkillsPage TRUST/VERDICT). Each mapping turns a
 * string key (state, transport, trust level) into a {@link BadgeConfig}
 * (label + tailwind colour classes). {@link resolveBadge} centralises the
 * safe fallback so unknown/undefined keys never crash a render.
 */

export interface BadgeConfig {
  label: string;
  className: string; // tailwind colour classes
}

/** Channel / connection lifecycle states. */
export const STATE_BADGE: Record<string, BadgeConfig> = {
  connected: { label: "Connected", className: "bg-green-500/15 text-green-400" },
  disconnected: { label: "Disconnected", className: "bg-red-500/15 text-red-400" },
  connecting: { label: "Connecting", className: "bg-amber-500/15 text-amber-400" },
  error: { label: "Error", className: "bg-red-500/15 text-red-400" },
  healthy: { label: "Connected", className: "bg-green-500/15 text-green-400" },
  ok: { label: "Connected", className: "bg-green-500/15 text-green-400" },
  degraded: { label: "Degraded", className: "bg-amber-500/15 text-amber-400" },
  unhealthy: { label: "Error", className: "bg-red-500/15 text-red-400" },
};

/** MCP transport types. */
export const TRANSPORT_BADGE: Record<string, BadgeConfig> = {
  stdio: { label: "stdio", className: "bg-blue-500/15 text-blue-400" },
  sse: { label: "SSE", className: "bg-purple-500/15 text-purple-400" },
  http: { label: "HTTP", className: "bg-cyan-500/15 text-cyan-400" },
};

/** Skill trust levels. */
export const TRUST_BADGE: Record<string, BadgeConfig> = {
  low: { label: "Low Trust", className: "bg-red-500/15 text-red-400" },
  medium: { label: "Medium Trust", className: "bg-amber-500/15 text-amber-400" },
  high: { label: "High Trust", className: "bg-green-500/15 text-green-400" },
};

/** Fallback used when the key is missing or unmapped. */
export const UNKNOWN_BADGE: BadgeConfig = {
  label: "Unknown",
  className: "bg-zinc-500/15 text-zinc-400",
};

/**
 * Resolve a badge config from a mapping for the given key.
 *
 * Returns {@link UNKNOWN_BADGE} when `key` is undefined, and a
 * label-bearing fallback (label = key) when the key is present but not in
 * the map — so an unmapped value still renders readably instead of
 * collapsing to "Unknown".
 */
export function resolveBadge(
  map: Record<string, BadgeConfig>,
  key: string | undefined,
): BadgeConfig {
  if (!key) return UNKNOWN_BADGE;
  return (
    map[key] ?? { label: key, className: UNKNOWN_BADGE.className }
  );
}
