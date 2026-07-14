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
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nowWallclock } from "@my-agent/core";

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
  /** Timeout for async backends (MLX). */
  timeoutMs?: number;
}

/** Detect the best available TTS backend on this platform. */
export function detectBackend(): TtsBackend {
  // On-device MLX (macOS): check for mlx-tts CLI or python module.
  if (process.platform === "darwin" && (which("mlx-tts") || whichMlxModule())) return "mlx";
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
      // On-device MLX TTS (macOS): use mlx-tts CLI or python -m mlx_tts.
      return await runMlx(text, opts);
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
    outFile = join(tmpdir(), `tts-${nowWallclock()}.aiff`);
    args.push("-o", outFile);
  }
  args.push(text);
  spawn("say", args, { stdio: "ignore" });
  return { backend: "say", audioFile: outFile, spokenDirectly: !opts.toFile };
}

function runPico(text: string, opts: TtsOptions): TtsResult {
  const outFile = opts.toFile ? join(tmpdir(), `tts-${nowWallclock()}.wav`) : join(tmpdir(), `tts-${nowWallclock()}.wav`);
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

/** Check if python3 + mlx_tts module is available. */
function whichMlxModule(): boolean {
  try {
    const r = spawnSync("python3", ["-c", "import mlx_tts"], { stdio: "ignore", timeout: 3000 });
    return r.status === 0;
  } catch {
    return false;
  }
}

/** Run MLX TTS via CLI or python module. Falls back to hook if available. */
async function runMlx(text: string, opts: TtsOptions): Promise<TtsResult> {
  // Try registered hook first (highest priority — host may wire a custom model).
  if (mlxHook) return mlxHook(text, opts);
  // Try mlx-tts CLI binary.
  if (which("mlx-tts")) {
    return runCliAsync("mlx-tts", ["--text", text, ...(opts.voice ? ["--voice", opts.voice] : [])], opts, "mlx");
  }
  // Try python3 -m mlx_tts.
  if (whichMlxModule()) {
    return runCliAsync("python3", ["-m", "mlx_tts", "--text", text, ...(opts.voice ? ["--voice", opts.voice] : [])], opts, "mlx");
  }
  return { backend: "none", spokenDirectly: false };
}

/** Async CLI runner (for MLX which may take longer). */
async function runCliAsync(cmd: string, args: string[], opts: TtsOptions, backend: TtsBackend): Promise<TtsResult> {
 return new Promise((resolve) => {
   const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] });
   child.on("error", () => resolve({ backend: "none", spokenDirectly: false }));
   child.on("exit", (code) => {
     if (code === 0) resolve({ backend, spokenDirectly: true });
     else resolve({ backend: "none", spokenDirectly: false });
   });
   child.stdin?.end();
   if (opts.timeoutMs) {
     setTimeout(() => { try { child.kill("SIGTERM"); } catch { /* already exited */ } }, opts.timeoutMs).unref?.();
   }
 });
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
