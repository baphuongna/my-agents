/**
 * §13 R31 readiness probes — 3-phase readiness registry.
 *
 * liveness (alive) vs readiness (can serve) vs functional (deps healthy).
 * Standalone: components register health checks; the probes aggregate them.
 */

/** 3-phase readiness: liveness (alive) vs readiness (can serve) vs functional
 * (deps healthy). MyAgents readiness-state. */
export type ReadinessState = "live" | "ready" | "functional";

export interface ProbeResult {
  state: ReadinessState;
  ok: boolean;
  /** 503 + Retry-After when not ready (§13). */
  retryAfterS?: number;
  detail?: string;
}

/** A readiness registry: components register health; the probe aggregates. */
export class ReadinessRegistry {
  private readonly checks = new Map<string, () => boolean>();
  private booted = false;

  register(name: string, check: () => boolean): void {
    this.checks.set(name, check);
  }
  markBooted(): void {
    this.booted = true;
  }

  /** /health/live — process is alive (always 200 once the server is up). */
  liveness(): ProbeResult {
    return { state: "live", ok: true };
  }
  /** /ready — booted + all registered checks pass (503 + Retry-After otherwise). */
  readiness(): ProbeResult {
    if (!this.booted) return { state: "ready", ok: false, retryAfterS: 2, detail: "booting" };
    const failed: string[] = [];
    for (const [name, check] of this.checks) {
      try {
        if (!check()) failed.push(name);
      } catch {
        failed.push(name);
      }
    }
    if (failed.length > 0) {
      return { state: "ready", ok: false, retryAfterS: 2, detail: `failed: ${failed.join(",")}` };
    }
    return { state: "ready", ok: true };
  }
  /** /functional — ready + the loop has produced at least one healthy turn. */
  functional(healthyTurns: number): ProbeResult {
    const r = this.readiness();
    if (!r.ok) return { ...r, state: "functional" };
    if (healthyTurns < 1) return { state: "functional", ok: false, retryAfterS: 5, detail: "no healthy turn yet" };
    return { state: "functional", ok: true };
  }
}
