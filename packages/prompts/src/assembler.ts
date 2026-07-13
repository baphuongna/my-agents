/**
 * 3-tier cache-stable prompt assembler (§5).
 *
 * Tiers:
 *   stable   — identity + skills/tools index. Hash-stable across turns (only
 *              rebuilt at tier boundaries: skill write, mode change). The prefix
 *              the provider caches.
 *   context  — project files (AGENTS.md), injection-scanned. Rebuilt when the
 *              discovered-file set changes.
 *   volatile — memory snapshot + USER.md + env hints (cwd/git/platform) +
 *              day-precision timestamp (NOT real-time — keeps the tier cache-
 *              stable within a day).
 *
 * Tier rebuilds are the SOLE mutators of session.prompt, serialized via
 * PromptMutex (invariant #15). assemblePrompt memoizes per session.
 *
 * Source: hermes #1, §5. R25-15 (day-precision), R27-16 (COW), R29-2.
 */
import type {
  MemorySnapshot,
  PromptMutex,
  Session,
  SystemPrompt,
} from "@my-agent/core";
import { today } from "@my-agent/core";
import { scanInject, scan } from "./inject.js";

/** A simple PromptMutex — serializes tier rebuilds (invariant #15). */
export function createPromptMutex(): PromptMutex {
  let locked = false;
  return {
    withLock<T>(fn: () => T): T {
      if (locked) throw new Error("PromptMutex: reentrant tier rebuild");
      locked = true;
      try {
        return fn();
      } finally {
        locked = false;
      }
    },
  };
}

/**
 * Build the volatile tier from a memory snapshot + user prefs + day.
 * Day-precision by design (R25-15): the timestamp is stable within a UTC day,
 * so the volatile tier (and thus the assembled prompt) cache-misses at most
 * once per day, not every call.
 */
export function buildVolatileTier(
  snap: MemorySnapshot,
  userMd: string,
  day: number,
  goalsBlock?: string,
): string {
  const t0 = PROMPT_TIMING ? performance.now() : 0;
  const lines: string[] = [];
  lines.push(`# Environment (day ${day})`);
  if (goalsBlock && goalsBlock.trim()) {
    // Phase 14 security review HIGH-1: goals are durable + may be poisoned
    // (same trust boundary as memory entries). Injection-scan before interpolating.
    const verdict = scan(goalsBlock, "context");
    lines.push(verdict.allowed ? goalsBlock.trim() : `## Goals\n[BLOCKED: ${verdict.reason}]`);
  }
  if (snap.entries.length > 0) {
    lines.push("## Memory (recalled)");
    // F3 (security review): memory entries are durable + may be poisoned (a
    // crafted conversation, a direct write to the memory dir, or a malicious
    // tool). Injection-scan EACH entry before interpolating — matches the
    // context-tier treatment. Blocked entries become a [BLOCKED] placeholder.
    const entries = snap.entries.slice(0, 20);
    const tScan0 = PROMPT_TIMING ? performance.now() : 0;
    for (const h of entries) {
      const verdict = scan(h.content, "context");
      lines.push(
        verdict.allowed ? `- [${h.role}] ${h.content}` : `- [${h.role}] [BLOCKED: ${verdict.reason}]`,
      );
    }
    if (PROMPT_TIMING) {
      recordTiming("scanMemory", entries.length, performance.now() - tScan0);
    }
  }
  if (userMd.trim()) {
    lines.push("## User preferences");
    lines.push(userMd.trim());
  }
  if (PROMPT_TIMING) {
    recordTiming("buildVolatile", snap.entries.length, performance.now() - t0);
  }
  return lines.join("\n");
}

/** When true, buildVolatileTier/assemblePrompt emit per-call timing to stderr.
 *  Default off. Enable with `MY_AGENT_PROMPT_TIMING=1`. */
export const PROMPT_TIMING = !!process.env.MY_AGENT_PROMPT_TIMING;

const TIMING_WINDOW = 50;
const timingBuckets = new Map<string, { count: number; totalMs: number; maxMs: number }>();

/** Rolling-window timing log. Cheap, no-op when PROMPT_TIMING is off. */
function recordTiming(label: string, n: number, ms: number): void {
  const key = `${label}(n=${n})`;
  const b = timingBuckets.get(key) ?? { count: 0, totalMs: 0, maxMs: 0 };
  b.count++;
  b.totalMs += ms;
  if (ms > b.maxMs) b.maxMs = ms;
  timingBuckets.set(key, b);
  if (b.count % TIMING_WINDOW === 0) {
    process.stderr.write(
      `[prompt-timing] ${key} avg=${(b.totalMs / b.count).toFixed(3)}ms max=${b.maxMs.toFixed(3)}ms n=${b.count}\n`,
    );
  }
}

/** Default stable-tier identity text (Tier 1; customizable via packages). */
export function defaultStableTier(name = "my-agent"): string {
  return [
    `# Identity`,
    `You are ${name}, an AI coding/autonomous agent.`,
    `You operate in the user's environment (CLI/TUI/web).`,
    ``,
    `# Core mandates`,
    `- Conventions-first: mimic existing style, structure, frameworks.`,
    `- Verify library availability before using.`,
    `- Sparse comments (WHY not WHAT); proactiveness; confirm ambiguity.`,
    `- Use specialized tools, not shell, for file operations.`,
    ``,
    `# Tone`,
    `- Concise/direct; no chitchat/filler; markdown (monospace-aware).`,
  ].join("\n");
}

/**
 * assemblePrompt — memoized per session. Returns the existing session.prompt
 * if already assembled; otherwise builds all 3 tiers once. Tier rebuilds use
 * rebuildStableTier/rebuildVolatile/markCompressed (not this function).
 */
export function assemblePrompt(s: Session): SystemPrompt {
  if (s.prompt) return s.prompt;
  const t0 = PROMPT_TIMING ? performance.now() : 0;
  const mutex = getMutex(s);
  const result = mutex.withLock(() => {
    if (s.prompt) return s.prompt; // double-check under lock
    const tBuild0 = PROMPT_TIMING ? performance.now() : 0;
    const stable = s.stableTier || defaultStableTier();
    const context = s.ctxFiles.length > 0 ? scanInject(s.ctxFiles) : "";
    const volatile = buildVolatileTier(
      s.memory.snapshot(),
      s.userMd,
      today(),
      s.goalsBlock,
    );
    if (PROMPT_TIMING) {
      recordTiming("assembleBuild", s.ctxFiles.length, performance.now() - tBuild0);
    }
    s.prompt = { stable, context, volatile };
    return s.prompt;
  });
  if (PROMPT_TIMING) {
    recordTiming("assemblePrompt", 1, performance.now() - t0);
  }
  return result;
}

/** Re-derive ONLY the stable tier (e.g. after a skill write). Preserves cache prefix. */
export function rebuildStableTier(s: Session, stable?: string): void {
  getMutex(s).withLock(() => {
    if (!s.prompt) return;
    s.prompt = { ...s.prompt, stable: stable ?? s.stableTier ?? defaultStableTier() };
  });
}

/** Re-snapshot ONLY the volatile tier (e.g. after compression). */
export function rebuildVolatile(s: Session): void {
  getMutex(s).withLock(() => {
    if (!s.prompt) return;
    s.prompt = {
      ...s.prompt,
      volatile: buildVolatileTier(s.memory.snapshot(), s.userMd, today(), s.goalsBlock),
    };
  });
}

/** markCompressed = (compress history) + rebuildVolatile, under the mutex. */
export function markCompressed(s: Session, compress?: (h: Session["history"]) => void): void {
  getMutex(s).withLock(() => {
    compress?.(s.history);
    if (!s.prompt) return;
    s.prompt = {
      ...s.prompt,
      volatile: buildVolatileTier(s.memory.snapshot(), s.userMd, today(), s.goalsBlock),
    };
  });
}

// Per-session mutex (lazy-initialized; stored on the session via a side map).
const mutexMap = new WeakMap<Session, PromptMutex>();
function getMutex(s: Session): PromptMutex {
  let m = mutexMap.get(s);
  if (!m) {
    m = createPromptMutex();
    mutexMap.set(s, m);
  }
  return m;
}
