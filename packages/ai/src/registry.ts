/**
 * Provider registry (§6). Manages an ordered ProviderProfile list + per-profile
 * taint (auth/quota failures that disqualify fallback reuse).
 *
 * The loop's streamWithFallback tries profiles in order, SKIPPING tainted ones.
 * A tainted profile is cooled down; it can recover (health() flips back to Healthy)
 * or be manually cleared.
 *
 * Source: §6 Provider Abstraction, R25-9 (auth/quota taint), R27-1/D7.
 */
import type { ComponentHealth, ProviderProfile } from "@my-agent/core";
import { nowWallclock } from "@my-agent/core";

/** Why a profile is currently disqualified from the fallback chain. */
export type TaintReason = "auth" | "quota" | "rate_limited" | "network" | "unhealthy";

export interface TaintedProfile {
  profile: ProviderProfile;
  reason: TaintReason;
  since: number;
}

export class ProviderRegistry {
  private profiles: ProviderProfile[] = [];
  private tainted = new Map<string, TaintedProfile>();
  private cooldownMs: number;

  constructor(opts: { cooldownMs?: number } = {}) {
    this.cooldownMs = opts.cooldownMs ?? 60_000;
  }

  /** Register a profile (appended to the fallback order). */
  register(profile: ProviderProfile): void {
    if (this.profiles.some((p) => p.id === profile.id)) {
      throw new Error(`provider already registered: ${profile.id}`);
    }
    this.profiles.push(profile);
  }

  /** All registered profiles, in fallback order. */
  all(): readonly ProviderProfile[] {
    return this.profiles;
  }

  /** Mark a profile tainted (disqualified from fallback until cooldown). */
  taint(id: string, reason: TaintReason): void {
    const profile = this.profiles.find((p) => p.id === id);
    if (!profile) return;
    this.tainted.set(id, { profile, reason, since: nowWallclock() });
  }

  /** Manually clear taint (e.g. after a credential refresh). */
  clear(id: string): void {
    this.tainted.delete(id);
  }

  /** Is a profile currently eligible (not tainted, or cooldown expired)? */
  eligible(id: string, now: number = nowWallclock()): boolean {
    const t = this.tainted.get(id);
    if (!t) return true;
    if (now - t.since >= this.cooldownMs) {
      this.tainted.delete(id); // cooldown expired
      return true;
    }
    return false;
  }

  /** The fallback-ordered list, skipping tainted/cooled profiles. */
  available(now: number = nowWallclock()): ProviderProfile[] {
    return this.profiles.filter((p) => this.eligible(p.id, now));
  }

  /** Aggregate health across all profiles (§6 partial-success). */
  health(): ComponentHealth {
    if (this.profiles.length === 0) return "Failed";
    const avail = this.available();
    if (avail.length === this.profiles.length) return "Healthy";
    if (avail.length === 0) return "Failed";
    return "Degraded";
  }
}
