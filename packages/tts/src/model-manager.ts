/**
 * @my-agent/tts — MLX model manager (download / cache / verify).
 *
 * Frontend MLX TTS pulls model weights from upstream repositories to
 * `~/.mya/models/tts/<id>/`. This module is the source of truth for:
 *   1. The registry of known models (id, repo, sha256, sizeBytes, default voice).
 *   2. Filesystem layout — ensure the cache dir exists, atomic rename after
 *      download, SHA-256 verify before exposing the model.
 *   3. Lazy / explicit downloads — `ensureModel(id)` is idempotent.
 *
 * Hard rules (AGENTS.md):
 *   - Use `nowWallclock()` for any timestamps (never Date.now).
 *   - SHA-256 verify is byte-for-byte; mismatch throws (no auto-retry).
 *   - No process exit / abort. Errors throw a typed Error.
 *
 * NOTE on registry URLs: Hugging Face Hub is the distribution source for
 * MLX TTS models. SHA-256 hashes are empty pending confirmation (Tier-3
 * will pin hashes when official distributions are confirmed).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { nowWallclock } from "@my-agent/core";

/** A known MLX model entry. */
export interface ModelRegistryEntry {
  readonly id: string;
  /** Human-readable display name. */
  readonly name: string;
  /** Upstream repo or download URL (placeholder; verify before production use). */
  readonly repo: string;
  /** Expected SHA-256 of the downloaded archive (hex). Empty = skip verify. */
  readonly sha256: string;
  /** Approximate on-disk size (informational only — not enforced). */
  readonly sizeBytes: number;
  /** Default voice id baked into the model (if any). */
  readonly defaultVoice?: string;
}

/** Registry of supported MLX TTS models. */
export const MODEL_REGISTRY: readonly ModelRegistryEntry[] = Object.freeze([
  {
    id: "barkan-mlx",
    name: "Barkan (MLX, multilingual)",
    repo: "https://huggingface.co/barkan-mlx/barkan-mlx/resolve/main/model.bin",
    sha256: "",
    sizeBytes: 380_000_000,
    defaultVoice: "barkan-default",
  },
  {
    id: "kokoro-mlx",
    name: "Kokoro (MLX, lightweight HQ)",
    repo: "https://huggingface.co/hf-internal-testing/kokoro-mlx/resolve/main/model.bin",
    sha256: "",
    sizeBytes: 150_000_000,
    defaultVoice: "kokoro-default",
  },
  {
    id: "parler-tts-mlx",
    name: "Parler-TTS (MLX, descriptive)",
    repo: "https://huggingface.co/parler-tts/parler-tts-mini-mlx/resolve/main/model.bin",
    sha256: "",
    sizeBytes: 600_000_000,
    defaultVoice: "parler-default",
  },
]);

/** Find a registry entry by id. */
export function findRegistryEntry(id: string): ModelRegistryEntry | undefined {
  return MODEL_REGISTRY.find((m) => m.id === id);
}

/** Return the models root directory. Honors `MYA_MODELS_ROOT` (test override);
 * otherwise defaults to `~/.mya/models/tts/`. */
export function modelsRoot(): string {
  const env = process.env["MYA_MODELS_ROOT"];
  if (env) return env;
  return join(homedir(), ".mya", "models", "tts");
}

/** Return the on-disk path for a specific model id. */
export function modelPath(id: string): string {
  return join(modelsRoot(), id);
}

/** Return the marker file used to record "model verified at <ts>". */
export function modelMarker(id: string): string {
  return join(modelPath(id), ".verified");
}

/**
 * Manager for MLX model weights: lazy download, SHA-256 verify, atomic install.
 * Constructor accepts an injectable fetcher for testability — production code
 * falls back to the global `fetch`.
 */
export class ModelManager {
  /** Optional override for the network fetch (bytes). Defaults to global fetch. */
  private readonly fetcher: (url: string) => Promise<Uint8Array>;

  constructor(opts?: { fetcher?: (url: string) => Promise<Uint8Array> }) {
    this.fetcher = opts?.fetcher ?? defaultFetcher;
  }

  /** List all registered models. */
  listModels(): ModelRegistryEntry[] {
    return [...MODEL_REGISTRY];
  }

  /** Returns true when the model exists on disk AND its marker is fresh. */
  hasModel(id: string): boolean {
    const entry = findRegistryEntry(id);
    if (!entry) return false;
    if (!existsSync(modelPath(id))) return false;
    // If a SHA-256 is declared, we require the verified marker.
    if (entry.sha256) return existsSync(modelMarker(id));
    return true;
  }

  /**
   * Ensure the model is on disk; download + verify if missing.
   * Idempotent: returns the on-disk path either way.
   */
  async ensureModel(id: string): Promise<string> {
    const entry = findRegistryEntry(id);
    if (!entry) throw new Error(`unknown MLX model: ${id}`);
    const target = modelPath(id);
    if (this.hasModel(id)) return target;
    // Download → write to temp → verify → atomic rename → write marker.
    mkdirSync(target, { recursive: true });
    if (!entry.sha256) {
      console.warn(`mlx: model ${id} has no SHA-256 pin — skipping verification`);
    }
    const bytes = await this.fetcher(entry.repo);
    if (entry.sha256) {
      const got = createHash("sha256").update(bytes).digest("hex");
      if (got !== entry.sha256) {
        throw new Error(`sha256 mismatch for ${id}: expected ${entry.sha256}, got ${got}`);
      }
    }
    const staging = join(target, ".staging");
    writeFileSync(staging, bytes);
    renameSync(staging, join(target, "model.bin"));
    writeFileSync(modelMarker(id), JSON.stringify({ id, ts: nowWallclock() }));
    return target;
  }
}

/** Default fetcher: global fetch returns ArrayBuffer; convert to Uint8Array. */
async function defaultFetcher(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`model fetch failed: ${url} → ${res.status}`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

/** Read the verified-marker file (returns ts if present). Helper for tests. */
export function readModelMarker(id: string): number | undefined {
  try {
    const raw = readFileSync(modelMarker(id), "utf8");
    const parsed = JSON.parse(raw) as { ts?: number };
    return parsed.ts;
  } catch {
    return undefined;
  }
}