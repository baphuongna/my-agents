/**
 * @my-agent/memory/auto-capture — Automatic conversation capture.
 *
 * Problem solved: The memory system relied SOLELY on the LLM calling the
 * `remember` tool. Most useful facts (preferences, decisions, context) are
 * stated implicitly in conversation and were LOST.
 *
 * Solution: Pattern-based heuristic extraction (mnemopi pattern).
 * On every turn_end, user + assistant messages are scanned for "memorable"
 * sentences using regex patterns. High-confidence matches are auto-stored
 * with the detected memory_type (driving Weibull decay params).
 *
 * This is the lightweight, always-on safety net:
 *   - Free (no LLM call needed)
 *   - Deterministic (regex patterns)
 *   - Low-noise (only stores confidence ≥ threshold)
 *   - Deduped (content hash)
 *
 * The explicit `remember` tool remains for high-importance facts the LLM
 * decides are worth saving.
 */

import { createHash } from "node:crypto";
import type { SqliteMemoryManager } from "./sqlite-manager.js";

// ── Memory types (aligned with Weibull decay params in weibull.ts) ────────

export type MemoryType =
  | "fact" | "preference" | "decision" | "commitment" | "goal"
  | "event" | "instruction" | "relationship" | "context"
  | "learning" | "observation" | "error" | "artifact" | "general";

type TypePriority =
  | "stable" | "moderate" | "high" | "time_critical"
  | "decaying" | "accumulating" | "evolving" | "persistent" | "reference";

interface TypePattern {
  readonly pattern: RegExp;
  readonly memoryType: MemoryType;
  readonly baseConfidence: number;
  readonly priority: TypePriority;
}

// ── Pattern definitions (ported from mnemopi/typed-memory.ts, curated) ────
// Each pattern detects a memory type from natural language text.

const TYPE_PATTERNS: readonly TypePattern[] = compilePatterns([
  // PREFERENCE: User preferences — HIGH VALUE for personal agents
  [String.raw`\b(i\s+(prefer|like|love|enjoy|hate|dislike))\b`, "preference", 0.85, "moderate"],
  [String.raw`\b(my\s+favorite\s+\w+\s+is)\b`, "preference", 0.95, "moderate"],
  [String.raw`\b(i\s+(always|never|usually)\s+(use|prefer))\b`, "preference", 0.9, "moderate"],
  [String.raw`\b(dark\s+mode|light\s+mode)\b`, "preference", 0.9, "moderate"],
  [String.raw`\b(i\s+(want|need)\s+(to|a|an|the))\b`, "preference", 0.6, "moderate"],

  // DECISION: Choices affecting future — HIGH VALUE
  [String.raw`\b(i\s+(decided|chose|selected|picked|opted))\b`, "decision", 0.9, "high"],
  [String.raw`\b(going\s+with|settled\s+on|locked\s+in)\b`, "decision", 0.8, "high"],
  [String.raw`\b(i\s+(will\s+use|am\s+using|adopt))\b`, "decision", 0.75, "high"],
  [String.raw`\b(we\s+decided|let's\s+use)\b`, "decision", 0.85, "high"],

  // COMMITMENT: Promises, deadlines — TIME CRITICAL
  [String.raw`\b(i\s+(will|shall|promise|need\s+to)\s+\w+)`, "commitment", 0.75, "time_critical"],
  [String.raw`\b(deadline|due\s+date|by\s+(tomorrow|next\s+week|eod|friday|monday))\b`, "commitment", 0.85, "time_critical"],
  [String.raw`\b(i'll|i\s+will)\s+(send|deliver|finish|complete|do)\b`, "commitment", 0.8, "time_critical"],

  // GOAL: Objectives
  [String.raw`\b(my\s+goal|the\s+objective|our\s+target)\b`, "goal", 0.9, "high"],
  [String.raw`\b(i\s+(want|need)\s+to\s+(build|create|achieve|reach))\b`, "goal", 0.8, "high"],
  [String.raw`\b(trying\s+to|working\s+on\s+getting)\b`, "goal", 0.65, "high"],

  // CONTEXT: Current situation — decays fast
  [String.raw`\b(i'm\s+currently|right\s+now\s+i'm|i\s+am\s+currently)\b`, "context", 0.8, "high"],
  [String.raw`\b(i'm\s+working\s+on|i'm\s+building|i'm\s+debugging)\b`, "context", 0.8, "high"],
  [String.raw`\b(my\s+project|my\s+(code|app|system|service))\b`, "context", 0.55, "high"],
  [String.raw`\b(the\s+(issue|bug|problem)\s+is)\b`, "context", 0.6, "high"],

  // FACT: Objective info about the user/project
  [String.raw`\b(my\s+name\s+is|i\s+am\s+a\s+(developer|engineer|designer))\b`, "fact", 0.9, "stable"],
  [String.raw`\b(i\s+work\s+(at|for|with))\b`, "fact", 0.85, "stable"],
  [String.raw`\b(my\s+(team|company|org)\s+(is|uses))\b`, "fact", 0.8, "stable"],
  [String.raw`\b(i\s+(use|code\s+in)\s+(rust|typescript|python|go|java))\b`, "fact", 0.8, "stable"],

  // RELATIONSHIP: Entity connections
  [String.raw`\b(manages?|reports?\s+to|supervises?|leads?)\b`, "relationship", 0.85, "stable"],
  [String.raw`\b(\w+\s+is\s+my\s+(colleague|manager|friend|coworker))\b`, "relationship", 0.8, "stable"],

  // INSTRUCTION: Rules to follow
  [String.raw`\b(always\s+(do|use|run|check)|never\s+(do|use|run))\b`, "instruction", 0.8, "stable"],
  [String.raw`\b(please\s+(always|never))\b`, "instruction", 0.75, "stable"],
  [String.raw`\b((?:make\s+sure|ensure|don't\s+forget)\s+to)\b`, "instruction", 0.7, "stable"],

  // LEARNING: Lessons discovered
  [String.raw`\b(i\s+(learned|realized|discovered|found\s+out))\b`, "learning", 0.85, "accumulating"],
  [String.raw`\b(turns?\s+out|the\s+trick\s+is|key\s+insight)\b`, "learning", 0.75, "accumulating"],
  [String.raw`\b(gotcha|pitfall|watch\s+out\s+for)\b`, "learning", 0.8, "accumulating"],

  // ERROR: Problems to avoid
  [String.raw`\b(this\s+(doesn't\s+work|is\s+broken|crashes?|fails))\b`, "error", 0.8, "persistent"],
  [String.raw`\b(the\s+(bug|error|crash)\s+(is|was))\b`, "error", 0.75, "persistent"],
  [String.raw`\b(workaround\s+(is|for))\b`, "error", 0.7, "persistent"],

  // EVENT: Historical occurrences — decays
  [String.raw`\b(yesterday\s+i|last\s+week\s+we|i\s+(launched|released|deployed))\b`, "event", 0.7, "decaying"],
  [String.raw`\b(had\s+a\s+(meeting|call)\s+with)\b`, "event", 0.65, "decaying"],

  // ARTIFACT: References
  [String.raw`\b(the\s+(file|doc|document|repo|repository)\s+(is|at))\b`, "artifact", 0.7, "reference"],
  [String.raw`\b(PR\s+#?\d+|commit\s+[a-f0-9]{7,})\b`, "artifact", 0.85, "reference"],
]);

// Confidence boosters — keywords that increase confidence for each type
const CONFIDENCE_BOOSTERS: Partial<Record<MemoryType, readonly string[]>> = {
  preference: ["always", "never", "absolutely", "definitely", "strongly"],
  decision: ["final", "official", "approved", "agreed"],
  commitment: ["promise", "guarantee", "deadline", "asap"],
  goal: ["target", "objective", "priority"],
  instruction: ["mandatory", "required", "critical", "important"],
  error: ["critical", "severe", "blocking", "urgent"],
  learning: ["key", "important", "critical"],
};

function compilePatterns(
  raw: ReadonlyArray<readonly [string, MemoryType, number, TypePriority]>,
): readonly TypePattern[] {
  return raw.map(([p, memoryType, baseConfidence, priority]) => ({
    pattern: new RegExp(p, "i"),
    memoryType,
    baseConfidence,
    priority,
  }));
}

// ── Classification ────────────────────────────────────────────────────────

export interface Classification {
  memoryType: MemoryType;
  confidence: number;
  matchedPattern: string;
}

export function classify(text: string): Classification | null {
  if (text.trim().length === 0) return null;
  const textLower = text.toLowerCase();

  let best: Classification | null = null;
  let bestScore = 0;

  for (const { pattern, memoryType, baseConfidence } of TYPE_PATTERNS) {
    const m = pattern.exec(textLower);
    if (!m) continue;

    let confidence = baseConfidence;
    const matchText = m[0] ?? "";
    if (matchText.length > 20) confidence += 0.1;
    else if (matchText.length > 10) confidence += 0.05;

    const boosters = CONFIDENCE_BOOSTERS[memoryType];
    if (boosters) {
      for (const b of boosters) {
        if (textLower.includes(b)) confidence += 0.05;
      }
    }

    confidence = Math.min(confidence, 1.0);
    if (confidence > bestScore) {
      bestScore = confidence;
      best = { memoryType, confidence, matchedPattern: pattern.source };
    }
  }

  return best;
}

// ── Sentence extraction ──────────────────────────────────────────────────

/** Split text into sentences. Handles . , ! , ? , and newline boundaries. */
function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 15 && s.length <= 500) // skip too-short / too-long
    .filter((s) => !/^(hi|hey|hello|thanks|thank you|ok|okay|sure|yes|no|cool|nice|great|got it|done|please|can you|could you|would you|let me|let's|i'll|i will|sure thing|of course|absolutely|definitely|happy to|i'd be happy|i can help|here's|there you go|feel free)\b/i.test(s))
    // Exclude questions — they're not facts, they're queries
    .filter((s) => !s.endsWith("?"))
    .filter((s) => !/^(what|how|why|when|where|who|which|do you|are you|is it|can you|could you|would you|will you|have you|did you|should i|let me check|i need more|i'd need|i'm not sure|to clarify)\b/i.test(s));
}

// ── Dedup hash ────────────────────────────────────────────────────────────

function contentHash(text: string): string {
  return createHash("sha256").update(text.toLowerCase().trim()).digest("hex").slice(0, 16);
}

// ── Auto-capture ──────────────────────────────────────────────────────────

export interface CaptureResult {
  captured: number;
  skipped: number;
  details: Array<{ content: string; type: MemoryType; confidence: number; reason: string }>;
}

export interface CaptureOptions {
  /** Minimum confidence to auto-store (default: 0.55). */
  minConfidence?: number;
  /** Source tag for captured memories (default: "auto-capture"). */
  source?: string;
  /** Session ID (default: "default"). */
  sessionId?: string;
  /** Import override for auto-captured (default: 0.4 — lower than explicit remember). */
  importance?: number;
}

/**
 * Extract memorable facts from text and store them in memory.
 * Only sentences matching patterns above minConfidence are stored.
 * Deduped by content hash (stored in metadata).
 *
 * @returns capture stats (how many stored, skipped, with details)
 */
export function autoCapture(
  text: string,
  manager: SqliteMemoryManager,
  opts: CaptureOptions = {},
): CaptureResult {
  const minConfidence = opts.minConfidence ?? 0.55;
  const source = opts.source ?? "auto-capture";
  const sessionId = opts.sessionId ?? "default";
  const importance = opts.importance ?? 0.4;

  const result: CaptureResult = { captured: 0, skipped: 0, details: [] };
  const sentences = splitSentences(text);

  for (const sentence of sentences) {
    const classification = classify(sentence);

    if (!classification || classification.confidence < minConfidence) {
      result.skipped++;
      result.details.push({
        content: sentence.slice(0, 80),
        type: "general",
        confidence: classification?.confidence ?? 0,
        reason: classification ? "below threshold" : "no pattern match",
      });
      continue;
    }

    // Check dedup via content hash in metadata
    const hash = contentHash(sentence);
    const existing = manager.findByHash(hash);
    if (existing) {
      result.skipped++;
      result.details.push({ content: sentence.slice(0, 80), type: classification.memoryType, confidence: classification.confidence, reason: "duplicate" });
      continue;
    }

    // Store with detected type + hash for future dedup
    manager.record({
      content: sentence,
      source,
      sessionId,
      importance: Math.max(importance, classification.confidence * 0.6),
      memoryType: classification.memoryType,
      veracity: "inferred",
      metadata: { captureHash: hash, captureConfidence: classification.confidence, autoCaptured: true },
    });

    result.captured++;
    result.details.push({ content: sentence.slice(0, 80), type: classification.memoryType, confidence: classification.confidence, reason: "stored" });
  }

  return result;
}
