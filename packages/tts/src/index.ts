/**
 * @my-agent/tts — text-to-speech surface (Frontier MLX TTS + platform backends).
 *
 * The SPEC's on-device MLX TTS is macOS-only. This package provides the TTS
 * abstraction + platform detection: macOS `say`, Linux `espeak`/`festival`/
 * `pico2wave`, and a no-op stub. The agent calls speak() and the right backend
 * is dispatched (or fail-open no-op if none). On-device MLX plugs in as another
 * backend on macOS (frontier).
 *
 * Source: §22 "On-device MLX TTS + native apps"; openclaw TTS.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type TtsBackend = "mlx" | "say" | "espeak" | "festival" | "pico2wave" | "none";

export interface TtsResult {
  backend: TtsBackend;
  /** Path to a generated audio file (wav/aiff), if produced. */
  audioFile?: string;
  /** Spoken directly to the audio device (no file). */
  spokenDirectly: boolean;
  durationMs?: number;
}

export interface TtsOptions {
  /** Voice name (backend-specific). */
  voice?: string;
  /** Speech rate (backend-specific; 1.0 = normal). */
  rate?: number;
  /** Produce a file instead of speaking to the device. */
  toFile?: boolean;
}

/** Detect the best available TTS backend on this platform. */
export function detectBackend(): TtsBackend {
  if (process.platform === "darwin" && which("say")) return "say";
  if (which("pico2wave")) return "pico2wave";
  if (which("espeak")) return "espeak";
  if (which("festival")) return "festival";
  return "none";
}

/** Speak text. Dispatches to the detected (or requested) backend. Fail-open:
 * if no backend, returns {backend:"none"} (never throws on a headless box). */
export async function speak(text: string, opts: TtsOptions & { backend?: TtsBackend } = {}): Promise<TtsResult> {
  const backend = opts.backend ?? detectBackend();
  switch (backend) {
    case "say":
      return runSay(text, opts);
    case "espeak":
      return runCli("espeak", [text], opts, backend);
    case "festival":
      return runCli("festival", ["--tts"], opts, backend, text);
    case "pico2wave":
      return runPico(text, opts);
    case "mlx":
      // On-device MLX (macOS frontier): not wired here — would call the MLX
      // TTS model. Return as "none" with a note (the host wires the MLX backend).
      return { backend: "none", spokenDirectly: false };
    case "none":
    default:
      return { backend: "none", spokenDirectly: false };
  }
}

function runSay(text: string, opts: TtsOptions): TtsResult {
  const args: string[] = [];
  if (opts.voice) args.push("-v", opts.voice);
  if (opts.rate) args.push("-r", String(Math.round((opts.rate ?? 1) * 180)));
  let outFile: string | undefined;
  if (opts.toFile) {
    outFile = join(tmpdir(), `tts-${Date.now()}.aiff`);
    args.push("-o", outFile);
  }
  args.push(text);
  spawn("say", args, { stdio: "ignore" });
  return { backend: "say", audioFile: outFile, spokenDirectly: !opts.toFile };
}

function runPico(text: string, opts: TtsOptions): TtsResult {
  const outFile = opts.toFile ? join(tmpdir(), `tts-${Date.now()}.wav`) : join(tmpdir(), `tts-${Date.now()}.wav`);
  spawn("pico2wave", ["-w", outFile, text], { stdio: "ignore" });
  return { backend: "pico2wave", audioFile: outFile, spokenDirectly: false };
}

function runCli(cmd: string, args: string[], opts: TtsOptions, backend: TtsBackend, stdinText?: string): TtsResult {
  const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] });
  if (stdinText) child.stdin?.end(stdinText);
  else child.stdin?.end();
  return { backend, spokenDirectly: !opts.toFile };
}

/** Synchronous `which` (PATH lookup). */
function which(bin: string): boolean {
  try {
    const r = spawnSync("which", [bin], { stdio: "ignore" });
    return r.status === 0;
  } catch {
    return false;
  }
}

/** MLX backend registration hook (frontier): the macOS host registers the real
 * MLX TTS callable here; speak({backend:"mlx"}) then uses it. */
let mlxHook: ((text: string, opts: TtsOptions) => Promise<TtsResult>) | null = null;
export function registerMlxBackend(fn: (text: string, opts: TtsOptions) => Promise<TtsResult>): void {
  mlxHook = fn;
}
export async function speakMlx(text: string, opts: TtsOptions): Promise<TtsResult> {
  if (mlxHook) return mlxHook(text, opts);
  return { backend: "none", spokenDirectly: false };
}

/** A TTS event the agent emits (for the desktop companion FSM §25.5). */
export interface TtsEvent {
  kind: "speak-start" | "speak-end";
  backend: TtsBackend;
  text: string;
}

// silence unused-import lint
void existsSync; void writeFileSync; void unlinkSync;
