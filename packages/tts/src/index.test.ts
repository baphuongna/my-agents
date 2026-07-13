/**
 * @my-agent/tts — text-to-speech smoke tests.
 *
 * Covers: speak() is callable and returns a Promise, does not throw on
 * empty/whitespace text, fails open when no TTS binary is available
 * (backend "none"), and detectBackend() runs and returns a valid backend.
 *
 * All speak() calls use an explicit { backend: "none" } so no real audio
 * backend is spawned — the tests are deterministic and side-effect-free on
 * any host (headless CI, dev laptop with espeak/say, etc.).
 */
import { describe, it, expect } from "vitest";
import { speak, detectBackend } from "./index.js";
import type { TtsBackend } from "./index.js";

const VALID_BACKENDS: TtsBackend[] = [
  "mlx",
  "say",
  "espeak",
  "festival",
  "pico2wave",
  "none",
];

describe("speak()", () => {
  it("is callable and returns a Promise", () => {
    const result = speak("hello", { backend: "none" });
    expect(result).toBeInstanceOf(Promise);
  });

  it("does not throw on empty text", async () => {
    await expect(speak("", { backend: "none" })).resolves.toBeDefined();
  });

  it("does not throw on whitespace-only text", async () => {
    await expect(speak("   ", { backend: "none" })).resolves.toBeDefined();
  });

  it("fails open (no throw) when no TTS binary is available", async () => {
    const result = await speak("hello world", { backend: "none" });
    expect(result.backend).toBe("none");
    expect(result.spokenDirectly).toBe(false);
    // No audio file is produced by the no-op stub.
    expect(result.audioFile).toBeUndefined();
  });
});

describe("detectBackend()", () => {
  it("runs without throwing and returns a valid backend", () => {
    const backend = detectBackend();
    expect(VALID_BACKENDS).toContain(backend);
  });
});
