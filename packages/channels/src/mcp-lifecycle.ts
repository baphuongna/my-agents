/**
 * MCP server lifecycle (§12.1) — 11-phase FSM + DegradedServer + startup outcomes.
 *
 * Phases (validated_unconfigured → discovered → ... → stopped/quarantine):
 *   Unconfigured → Discovered → Validated → Initializing → Healthy
 *     ↘ Degraded (a server stays USABLE in healthy_servers)
 *     ↘ Failed (excluded from healthy_servers)
 *   → Restarting → Draining → Stopped
 *   → Quarantine (repeated failures; manual review required)
 *
 * Source: §12.1 MCP lifecycle, claw-code PluginLifecycle/PluginState, R25-6.
 */
import type { ComponentHealth } from "@my-agent/core";

export type McpPhase =
  | "Unconfigured"
  | "Discovered"
  | "Validated"
  | "Initializing"
  | "Healthy"
  | "Degraded"
  | "Failed"
  | "Restarting"
  | "Draining"
  | "Stopped"
  | "Quarantine";

export interface McpServer {
  id: string;
  command: string;
  args: string[];
  phase: McpPhase;
  health: ComponentHealth;
  capabilities: string[];
  lastError?: string;
  consecutiveFailures: number;
  /** Tools the server exposes (populated after Validated). */
  tools: string[];
}

const QUARANTINE_AFTER = 5; // N consecutive failures → Quarantine

/** Transition a server to the next phase; returns the updated server. */
export function transition(s: McpServer, to: McpPhase, opts: { error?: string } = {}): McpServer {
  const next: McpServer = { ...s, phase: to };
  if (opts.error !== undefined) {
    next.lastError = opts.error;
  }
  if (to === "Failed") {
    next.consecutiveFailures = (next.consecutiveFailures ?? 0) + 1; // defensive (partial servers)
    if (next.consecutiveFailures >= QUARANTINE_AFTER) {
      next.phase = "Quarantine";
      next.health = "Failed";
    } else {
      next.health = "Failed";
    }
  } else if (to === "Healthy") {
    next.consecutiveFailures = 0;
    next.health = "Healthy";
  } else if (to === "Degraded") {
    next.health = "Degraded";
  }
  return next;
}

/** Aggregate server health → single ComponentHealth (§6 partial-success). */
export function aggregateHealth(servers: McpServer[]): ComponentHealth {
  if (servers.length === 0) return "Healthy"; // no servers = no failure
  const usable = servers.filter((s) => s.phase === "Healthy" || s.phase === "Degraded").length;
  const failed = servers.filter((s) => s.phase === "Failed" || s.phase === "Quarantine").length;
  if (usable === servers.length) return "Healthy";
  if (usable === 0) return "Failed";
  return "Degraded";
}

/** The set of usable tools across all healthy/degraded servers. */
export function availableTools(servers: McpServer[]): string[] {
  const out = new Set<string>();
  for (const s of servers) {
    if (s.phase === "Healthy" || s.phase === "Degraded") {
      for (const t of s.tools) out.add(t);
    }
  }
  return [...out];
}