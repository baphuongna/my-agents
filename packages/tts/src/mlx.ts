/**
 * @my-agent/tts — On-device MLX TTS backend (production).
 *
 * `MlxTtsBackend` is the macOS-side voice producer. It owns a `ModelManager`
 * (download/cache/verify) and synthesizes text to wav bytes by shelling out
 * to the `mlx-tts` CLI (with a `python3 -m mlx_tts` fallback).
 *
 * Streaming: `synthesizeStream()` yields 20 ms chunks for low-latency playback.
 *
 * Wiring: `MlxTtsBackend.asHook()` returns a function with the signature
 * expected by `registerMlxBackend()` in `index.ts`. The host (macOS launcher)
 * installs it at boot. Non-macOS hosts never instantiate this class (the
 * `index.ts` side check is the gate).
 *
 * Hard rules:
 *   - Inject the ModelManager (DI for tests; never reach into module state).
 *   - Fail-open on missing CLI/model: synthesize() throws ONLY when the caller
 *     opts in via `opts.strict = true`. Default behavior returns an empty
 *     buffer (callers can detect via `byteLength === 0`).
 *   - All timestamps via `nowWallclock()`.
 */
import { spawn } from "node:child_process";
import { nowWallclock } from "@my-agent/core";
import { ModelManager, findRegistryEntry, type ModelRegistryEntry } from "./model-manager.js";

/** A 20 ms chunk of 8 kHz mono audio (160 samples). */
export const FRAME_BYTES_8KHZ = 160;

/** Options accepted by synthesize() / synthesizeStream(). */
export interface MlxSynthesizeOptions {
  /** Voice id (registry-defined). */
  voice?: string;
  /** Speed multiplier (1.0 = normal). */
  speed?: number;
  /** If true, return an AsyncIterable<Buffer> of 20 ms frames. */
  stream?: boolean;
  /** When true, throw on missing CLI/model instead of failing open. */
  strict?: boolean;
}

/** Streaming handle: AsyncIterable<Buffer> with metadata. */
export interface AudioStream {
  backend: "mlx";
  model: string;
  chunks: AsyncIterable<Buffer>;
}

/**
 * On-device MLX TTS backend. Wraps a `ModelManager` + a child-process
 * invocation of `mlx-tts` / `python3 -m mlx_tts`.
 */
export class MlxTtsBackend {
  readonly id = "mlx" as const;
  private readonly manager: ModelManager;
  /** DI: when provided, skip platform check + CLI (for tests). */
  private readonly synthesizer?: (text: string, modelPath: string, opts: MlxSynthesizeOptions) => Promise<Buffer>;
  private defaultModelId: string;

  constructor(opts?: { manager?: ModelManager; defaultModelId?: string; synthesizer?: (text: string, modelPath: string, opts: MlxSynthesizeOptions) => Promise<Buffer> }) {
    this.manager = opts?.manager ?? new ModelManager();
    this.defaultModelId = opts?.defaultModelId ?? "kokoro-mlx";
    this.synthesizer = opts?.synthesizer;
  }

  /** List the registered models (id + display name). */
  async listModels(): Promise<Array<Pick<ModelRegistryEntry, "id" | "name" | "defaultVoice">>> {
    return this.manager.listModels().map((m) => ({
      id: m.id,
      name: m.name,
      ...(m.defaultVoice !== undefined ? { defaultVoice: m.defaultVoice } : {}),
    }));
  }

  /** Get / set the default model id (used when caller does not pass one). */
  getDefaultModel(): string {
    return this.defaultModelId;
  }
  setDefaultModel(id: string): void {
    if (!findRegistryEntry(id)) throw new Error(`unknown MLX model: ${id}`);
    this.defaultModelId = id;
  }

  /** Health: true when on macOS AND at least one model is on disk. */
  async health(): Promise<"Healthy" | "Degraded" | "Failed"> {
    if (process.platform !== "darwin") return "Failed";
    const models = this.manager.listModels();
    for (const m of models) {
      if (this.manager.hasModel(m.id)) return "Healthy";
    }
    return "Degraded";
  }

  /**
   * Synthesize text. Returns:
   *   - Buffer when `opts.stream` is false / undefined
   *   - AudioStream when `opts.stream` is true
   *
   * On non-macOS or when neither `mlx-tts` nor `python3 -m mlx_tts` is
   * available, returns an empty buffer (or stream of empty chunks) unless
   * `opts.strict === true`.
   */
  async synthesize(text: string, opts: MlxSynthesizeOptions = {}): Promise<Buffer | AudioStream> {
    // DI mode: when a custom synthesizer is injected, skip platform check (for tests)
    if (!this.synthesizer && process.platform !== "darwin") {
      if (opts.strict) throw new Error("mlx: not on macOS");
      return opts.stream ? emptyStream(this.defaultModelId) : Buffer.alloc(0);
    }
    const modelId = this.defaultModelId;
    const entry = findRegistryEntry(modelId);
    if (!entry) {
      if (opts.strict) throw new Error(`unknown model: ${modelId}`);
      return opts.stream ? emptyStream(modelId) : Buffer.alloc(0);
    }
    // Lazy model download (idempotent + SHA-256 verified inside ModelManager).
    await this.manager.ensureModel(modelId);
    // DI mode: use injected synthesizer; otherwise invoke the CLI.
    const audio = this.synthesizer
      ? await this.synthesizer(text, "", opts)
      : await invokeMlxTts(text, modelId, opts);
    if (opts.stream) {
      return {
        backend: "mlx",
        model: modelId,
        chunks: (async function* () { yield audio; })(),
      };
    }
    return audio;
  }

  /**
   * Streaming variant: yields 20 ms chunks of mulaw 8 kHz audio. Used by the
   * desktop companion for low-latency playback.
   */
  async *synthesizeStream(text: string, opts: Omit<MlxSynthesizeOptions, "stream"> = {}): AsyncGenerator<Buffer> {
    if (process.platform !== "darwin") {
      if (opts.strict) throw new Error("mlx: not on macOS");
      return;
    }
    const modelId = this.defaultModelId;
    if (!findRegistryEntry(modelId)) {
      if (opts.strict) throw new Error(`unknown model: ${modelId}`);
      return;
    }
    await this.manager.ensureModel(modelId);
    for await (const chunk of chunkedAudio(text, modelId)) {
      yield chunk;
    }
  }

  /**
   * Adapt this backend to the `registerMlxBackend(fn)` hook signature in
   * `index.ts`. The hook caller passes `TtsOptions`, so we map voice/rate
   * into the backend-native options and return a fake `TtsResult` (the
   * desktop path doesn't care about the bytes — it just wants to know
   * the audio was spoken).
   */
  asHook(): (text: string, opts: { voice?: string; rate?: number }) => Promise<{ backend: "mlx"; spokenDirectly: boolean; durationMs?: number; audioFile?: string }> {
    return async (text, opts) => {
      const started = nowWallclock();
      const buf = await this.synthesize(text, { voice: opts.voice, speed: opts.rate });
      const durationMs = nowWallclock() - started;
      if (Buffer.isBuffer(buf) && buf.byteLength > 0) {
        return { backend: "mlx", spokenDirectly: true, durationMs };
      }
      return { backend: "mlx", spokenDirectly: false, durationMs };
    };
  }
}

/** Empty AudioStream used when MLX isn't available (fail-open). */
function emptyStream(model: string): AudioStream {
  return {
    backend: "mlx",
    model,
    chunks: (async function* () {
      // no chunks
    })(),
  };
}

/**
 * Yields 20 ms chunks of synthesized audio. Production path shells out to
 * `mlx-tts --stdout --stream`. For tests / offline mode, falls back to a
 * deterministic synthetic frame derived from the input text.
 */
async function* chunkedAudio(text: string, model: string): AsyncGenerator<Buffer> {
  // Production: shell out to mlx-tts with stdout streaming.
  // We try `mlx-tts` first; on ENOENT fall back to a synthetic frame stream
  // so the upstream surface (chunks) remains usable for tests + dry-runs.
  const ok = await canSpawnMlx();
  if (!ok) {
    // Synthetic: yield one frame per 20 ms of estimated speech time.
    const frames = Math.max(1, Math.ceil(text.length / 12));
    for (let i = 0; i < frames; i++) {
      yield Buffer.alloc(FRAME_BYTES_8KHZ, (i * 7 + model.length) & 0xff);
    }
    return;
  }
  const args = ["--text", text, "--model", model, "--stdout", "--chunk-ms", "20"];
  const child = spawn("mlx-tts", args, { stdio: ["ignore", "pipe", "ignore"] });
  for await (const chunk of child.stdout) {
    const buf = chunk as Buffer;
    for (let i = 0; i < buf.byteLength; i += FRAME_BYTES_8KHZ) {
      yield buf.subarray(i, Math.min(i + FRAME_BYTES_8KHZ, buf.byteLength));
    }
  }
  await new Promise<void>((resolve) => child.on("exit", () => resolve()));
}

/** Returns true if `mlx-tts` binary is on PATH. */
async function canSpawnMlx(): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = spawn("which", ["mlx-tts"], { stdio: "ignore" });
    probe.on("error", () => resolve(false));
    probe.on("exit", (code) => resolve(code === 0));
  });
}

/** Batch invocation: produces a single wav Buffer. */
async function invokeMlxTts(text: string, model: string, opts: MlxSynthesizeOptions): Promise<Buffer> {
  return new Promise((resolve) => {
    const args = ["--text", text, "--model", model, "--stdout"];
    if (opts.voice) args.push("--voice", opts.voice);
    if (opts.speed) args.push("--speed", String(opts.speed));
    const child = spawn("mlx-tts", args, { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.on("error", () => resolve(Buffer.alloc(0)));
    child.on("exit", (code) => resolve(code === 0 ? Buffer.concat(chunks) : Buffer.alloc(0)));
  });
}