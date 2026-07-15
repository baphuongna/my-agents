/**
 * key-rotation.ts — API key rotation for multi-key provider configs.
 *
 * Ported from pi-soly/packages/pi-keyrouter, adapted to my-agent conventions:
 *   - nowWallclock() from @my-agent/core (single time helper, invariant #10)
 *   - ~/.mya/keyrouter.json config path (never project-scoped — security)
 *   - KeyState/KeyRouter classes per task spec
 *
 * Error regexes classify provider responses:
 *   OVERLOADED (529)      → provider-wide cooldown on ALL keys, NO rotation
 *   RATE_LIMITED (429)    → mark current key bad, rotate to next
 *   UNAUTHORIZED (401/403)→ mark current key bad, rotate to next
 *
 * Complementary to ProviderRegistry (which taints provider-profiles in the
 * fallback chain): KeyRouter operates at the API-key level within a single
 * provider.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { nowWallclock } from "@my-agent/core";

// ── Config types ──

/** A single API key entry. `name` is for logging; `value` is the literal key. */
export interface ApiKey {
  name: string;
  value: string;
}

/** Configuration for a single provider. */
export interface ProviderConfig {
  name: string;
  match: string[];
  keys: ApiKey[];
}

/** Top-level config. */
export interface KeyRouterConfig {
  providers: ProviderConfig[];
  maxRetries: number;
  cooldownMs: number;
  overloadedCooldownMs: number;
}

export type KeyStatus = "ok" | "rate-limited" | "unauthorized" | "untried";
export type RotationReason = "rate-limited" | "unauthorized";

// ── Error regexes ──

/** Overloaded-style errors: "overloaded", HTTP 529. Provider-wide cooldown. */
export const OVERLOADED_RE = /\boverloaded\b|\b529\b/i;

/** Rate-limit errors: HTTP 429, "rate limit", "too many requests". Key-specific. */
export const RATE_LIMITED_RE = /\b429\b|rate.?limit|too many requests/i;

/** Auth errors: HTTP 401/403, "unauthorized", "forbidden". Key-specific. */
export const UNAUTHORIZED_RE = /\b40[13]\b|unauthorized|forbidden/i;

// ── KeyState ──

/**
 * Tracks runtime state for a single API key: availability, cooldowns,
 * overload windows, usage stats.
 */
export class KeyState {
  name: string;
  value: string;
  lastStatus: KeyStatus = "untried";
  cooldownUntil = 0;
  overloadedUntil = 0;
  uses = 0;
  failures = 0;

  constructor(opts: { name: string; value: string }) {
    this.name = opts.name;
    this.value = opts.value;
  }

  /** True if the key is past cooldown AND not in a provider-wide overload window. */
  isAvailable(now: number = nowWallclock()): boolean {
    if (this.cooldownUntil !== 0 && this.cooldownUntil > now) return false;
    if (this.overloadedUntil !== 0 && this.overloadedUntil > now) return false;
    return true;
  }

  /** True if this key's provider is currently marked overloaded. */
  isOverloaded(now: number = nowWallclock()): boolean {
    return this.overloadedUntil !== 0 && this.overloadedUntil > now;
  }

  /** Mark a key as bad (rate-limited or unauthorized) for `cooldownMs`. */
  markBad(reason: RotationReason, cooldownMs: number, now: number = nowWallclock()): void {
    this.lastStatus = reason === "rate-limited" ? "rate-limited" : "unauthorized";
    this.cooldownUntil = now + cooldownMs;
    this.failures += 1;
  }

  /**
   * Mark this key's PROVIDER as overloaded. Provider-wide: call on EVERY key
   * of the affected provider. Does NOT count as a failure or change lastStatus.
   */
  markOverloaded(cooldownMs: number, now: number = nowWallclock()): void {
    this.overloadedUntil = now + cooldownMs;
  }

  /** Mark a key as used successfully. Clears cooldown. */
  markOk(): void {
    this.lastStatus = "ok";
    this.cooldownUntil = 0;
  }

  /** Record that a key was attempted (regardless of outcome). */
  recordUse(): void {
    this.uses += 1;
  }
}

// ── Pure helpers ──

/** Build initial KeyState[] from a list of key definitions. */
export function initKeyStates(
  keys: ReadonlyArray<{ name: string; value: string }>,
): KeyState[] {
  return keys.map((k) => new KeyState(k));
}

/**
 * Pick the next key to try.
 *
 * Priority:
 * 1. The key at `preferredIndex` if available.
 * 2. The next available key in rotation order (round-robin from preferred+1).
 * 3. If all on cooldown/overloaded, the one that becomes available soonest.
 *
 * Returns the picked index, or -1 if no keys.
 */
export function pickNextKey(
  states: KeyState[],
  preferredIndex: number,
  now: number = nowWallclock(),
): number {
  if (states.length === 0) return -1;

  // 1. Preferred if available
  const preferred = states[preferredIndex];
  if (preferred && preferred.isAvailable(now)) {
    return preferredIndex;
  }

  // 2. Next available in rotation order
  for (let offset = 1; offset <= states.length; offset++) {
    const idx = (preferredIndex + offset) % states.length;
    const s = states[idx];
    if (s && s.isAvailable(now)) {
      return idx;
    }
  }

  // 3. All on cooldown/overloaded — pick the one available soonest
  const soonest = (s: KeyState | undefined): number => {
    if (!s) return Number.POSITIVE_INFINITY;
    return Math.max(s.cooldownUntil, s.overloadedUntil);
  };
  let bestIdx = 0;
  let bestUntil = soonest(states[0]);
  for (let i = 1; i < states.length; i++) {
    const u = soonest(states[i]);
    if (u < bestUntil) {
      bestUntil = u;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** Find the provider config whose `match` substrings hit the URL (case-insensitive). */
export function matchProvider<T extends { name: string; match: string[] }>(
  providers: T[],
  url: string,
): T | undefined {
  const lower = url.toLowerCase();
  for (const p of providers) {
    for (const m of p.match) {
      if (lower.includes(m.toLowerCase())) return p;
    }
  }
  return undefined;
}

/**
 * Compute the delay (ms) before the soonest key becomes available.
 * Returns 0 if at least one key is available now.
 */
export function waitForNextKey(states: KeyState[], now: number = nowWallclock()): number {
  let minWait = Number.POSITIVE_INFINITY;
  for (const s of states) {
    if (s.isAvailable(now)) return 0;
    const wait = s.cooldownUntil - now;
    if (wait < minWait) minWait = wait;
  }
  return minWait === Number.POSITIVE_INFINITY ? 0 : minWait;
}

// ── Config loader ──

/** Default config: empty providers, sensible retry/cooldown values. */
export function defaultConfig(): KeyRouterConfig {
  return {
    providers: [],
    maxRetries: 3,
    cooldownMs: 60_000,
    overloadedCooldownMs: 30_000,
  };
}

/**
 * Resolve the config path. Always under ~/.mya/, never project-scoped.
 * API keys are personal credentials that do not belong inside a project.
 *
 * @param _cwd ignored — config is always user-level
 * @param home override home dir (for testing)
 */
export function configPath(_cwd?: string, home?: string): string {
  const homeDir = home ?? os.homedir();
  return path.join(homeDir, ".mya", "keyrouter.json");
}

/** Load config from ~/.mya/keyrouter.json. Returns defaults if missing/malformed. */
export function loadConfig(_cwd?: string, home?: string): KeyRouterConfig {
  const file = configPath(undefined, home);
  if (!fs.existsSync(file)) return defaultConfig();
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw) as Partial<KeyRouterConfig>;
    return normalize(parsed);
  } catch {
    return defaultConfig();
  }
}

function normalize(input: Partial<KeyRouterConfig>): KeyRouterConfig {
  const providers = (input.providers ?? []).filter(
    (p): p is ProviderConfig =>
      typeof p?.name === "string" &&
      Array.isArray(p.match) &&
      Array.isArray(p.keys) &&
      p.keys.every((k) => typeof k?.name === "string" && typeof k?.value === "string"),
  );
  return {
    providers,
    maxRetries: typeof input.maxRetries === "number" ? input.maxRetries : 3,
    cooldownMs: typeof input.cooldownMs === "number" ? input.cooldownMs : 60_000,
    overloadedCooldownMs:
      typeof input.overloadedCooldownMs === "number" ? input.overloadedCooldownMs : 30_000,
  };
}

// ── Provider name resolution ──

/**
 * Resolve the canonical provider name from a display name.
 * e.g. "z-ai" → "zai", "open-router" → "openrouter".
 */
export function resolveProviderName(displayName: string): string {
  const lower = displayName.toLowerCase();
  const map: Record<string, string> = {
    "z-ai": "zai",
    "z.ai": "zai",
    "open-router": "openrouter",
    "openai": "openai",
    "anthropic": "anthropic",
  };
  return map[lower] ?? displayName;
}

// ── KeyRouter ──

interface ProviderRuntime {
  keys: KeyState[];
  /** Index of the active key. -1 = not bootstrapped yet. */
  currentIndex: number;
}

/**
 * Manages multi-key rotation across configured providers.
 *
 * Usage:
 *   const router = new KeyRouter();
 *   router.activate();                          // load ~/.mya/keyrouter.json
 *   const key = router.currentKey("zai");       // get active key
 *   // ... provider call ...
 *   router.handleError("zai", "Error 429 ..."); // classify + rotate
 *   const nextKey = router.currentKey("zai");   // rotated key
 */
export class KeyRouter {
  private config: KeyRouterConfig | undefined;
  private runtimes = new Map<string, ProviderRuntime>();

  constructor(config?: KeyRouterConfig) {
    if (config) this.config = config;
  }

  /**
   * Activate: load config (once), bootstrap per-provider key states.
   * Idempotent — safe to call multiple times. Only bootstraps new providers.
   */
  activate(cwd?: string, home?: string): void {
    if (!this.config) {
      this.config = loadConfig(cwd, home);
    }
    if (this.config.providers.length === 0) return;

    for (const p of this.config.providers) {
      const resolvedName = resolveProviderName(p.name);
      if (this.runtimes.has(resolvedName)) continue;
      const keys = initKeyStates(p.keys);
      const idx = pickNextKey(keys, 0);
      this.runtimes.set(resolvedName, {
        keys,
        currentIndex: idx,
      });
    }
  }

  /** Get the current key value for a provider, or undefined if not managed. */
  currentKey(providerName: string): string | undefined {
    const rt = this.runtimes.get(resolveProviderName(providerName));
    if (!rt || rt.currentIndex < 0) return undefined;
    return rt.keys[rt.currentIndex]?.value;
  }

  /** Index of the current key for a provider, or -1 if not managed/unset. */
  currentIndex(providerName: string): number {
    const rt = this.runtimes.get(resolveProviderName(providerName));
    return rt ? rt.currentIndex : -1;
  }

  /**
   * Handle a provider error: classify it, update key states, rotate if needed.
   *
   * - OVERLOADED (529): marks ALL keys with provider-wide cooldown, no rotation.
   * - RATE_LIMITED (429) / UNAUTHORIZED (401/403): marks current key bad, rotates.
   *
   * Returns the new key value if rotation happened, undefined otherwise.
   */
  handleError(providerName: string, errorMessage: string): string | undefined {
    if (!this.config) return undefined;
    const resolved = resolveProviderName(providerName);
    const rt = this.runtimes.get(resolved);
    if (!rt) return undefined;

    const now = nowWallclock();

    // Overload branch: provider-wide cooldown, NO rotation, NO failure
    if (OVERLOADED_RE.test(errorMessage)) {
      for (const k of rt.keys) k.markOverloaded(this.config.overloadedCooldownMs, now);
      return undefined;
    }

    // Rotation branch: classify reason
    let reason: RotationReason | null = null;
    if (RATE_LIMITED_RE.test(errorMessage)) {
      reason = "rate-limited";
    } else if (UNAUTHORIZED_RE.test(errorMessage)) {
      reason = "unauthorized";
    }
    if (!reason) return undefined;

    // Mark current key as bad
    if (rt.currentIndex >= 0) {
      const currentKey = rt.keys[rt.currentIndex];
      if (currentKey) currentKey.markBad(reason, this.config.cooldownMs, now);
    }

    // Find next available key
    const nextIdx = pickNextKey(rt.keys, rt.currentIndex + 1, now);
    if (nextIdx < 0 || nextIdx === rt.currentIndex) return undefined;

    rt.currentIndex = nextIdx;
    return rt.keys[nextIdx]?.value;
  }

  /** Mark current key as OK (successful response). Clears cooldown. */
  markOk(providerName: string): void {
    const rt = this.runtimes.get(resolveProviderName(providerName));
    if (!rt || rt.currentIndex < 0) return;
    const key = rt.keys[rt.currentIndex];
    if (key) key.markOk();
  }

  /** Get all key states for a provider (for diagnostics/status). */
  keyStates(providerName: string): readonly KeyState[] {
    const rt = this.runtimes.get(resolveProviderName(providerName));
    return rt ? rt.keys : [];
  }

  /** Check if a provider name is managed by this router. */
  hasProvider(providerName: string): boolean {
    return this.runtimes.has(resolveProviderName(providerName));
  }

  /** Reset all runtime state (e.g. for config reload). */
  reset(): void {
    this.config = undefined;
    this.runtimes.clear();
  }
}
