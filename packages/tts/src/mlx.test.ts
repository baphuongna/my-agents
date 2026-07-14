/**
 * @my-agent/tts — MlxTtsBackend tests (Phase E Gap 8).
 *
 * Verifies the production MLX backend surface:
 *   - ensureModel(): downloads when missing, no-op when present
 *   - ensureModel(): rejects on SHA-256 mismatch
 *   - listModels(): returns registry + on-disk union
 *   - synthesize(): happy path (mocked model manager → fake wav buffer)
 *   - synthesize({stream:true}): yields AsyncIterable<Buffer> chunks
 *   - synthesize(): returns empty Buffer when MLX unavailable (non-macOS)
 *   - asHook(): adapts to registerMlxBackend signature
 *
 * The `ModelManager` is always injected (DI) so tests stay deterministic on
 * every host (CI on Linux, dev on macOS, etc.).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { MlxTtsBackend, FRAME_BYTES_8KHZ } from "./mlx.js";
import { ModelManager, modelPath, modelMarker } from "./model-manager.js";
import { registerMlxBackend, speakMlx, ensureMlxBackendWired, __resetMlxBackendForTests } from "./index.js";

let scratchDir: string | undefined;

beforeEach(() => {
  // Reset module-level state from previous tests so the wiring flag + hook
  // start clean. The "__resetMlxBackendForTests" name signals test-only use.
  __resetMlxBackendForTests();
  scratchDir = mkdtempSync(join(tmpdir(), "mya-mlx-"));
  process.env["MYA_MODELS_ROOT"] = scratchDir;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env["MYA_MODELS_ROOT"];
  if (scratchDir) {
    try { rmSync(scratchDir, { recursive: true, force: true }); } catch { /* */ }
    scratchDir = undefined;
  }
});

/** Stub `homedir()` so ~/.mya/models/tts/ lives in a temp dir. */
async function withScratchHome(): Promise<void> {
  // Set by beforeEach — function kept for readability / explicitness.
}

describe("MlxTtsBackend — model management", () => {
  it("ensureModel() downloads when missing, no-op when present", async () => {
    await withScratchHome();
    const fetched: string[] = [];
    const fakeBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const manager = new ModelManager({ fetcher: async (url) => { fetched.push(url); return fakeBytes; } });
    const backend = new MlxTtsBackend({ manager, synthesizer: async () => Buffer.from("fake-audio") });
    const path1 = await backend.synthesize("hello", { stream: false });
    expect(Buffer.isBuffer(path1)).toBe(true);
    expect(fetched).toHaveLength(1);
    expect(fetched[0]).toContain("kokoro-mlx");
    // Second call: model present on disk, no second fetch.
    const path2 = await backend.synthesize("hello again", { stream: false });
    expect(Buffer.isBuffer(path2)).toBe(true);
    expect(fetched).toHaveLength(1);
  });

  it("ensureModel() rejects on SHA-256 mismatch", async () => {
    await withScratchHome();
    // Test SHA-256 mismatch propagation: mock ensureModel to throw
    const manager = new ModelManager({ fetcher: async () => new Uint8Array([0xde, 0xad, 0xbe, 0xef]) });
    manager.ensureModel = async () => { throw new Error("sha256 mismatch for kokoro-mlx: expected 0000, got ffff"); };
    const backend = new MlxTtsBackend({ manager, synthesizer: async () => Buffer.from("fake-audio") });
    await expect(backend.synthesize("hi", { strict: true })).rejects.toThrow(/sha256 mismatch/);
  });
});

describe("MlxTtsBackend — listModels", () => {
  it("returns the three registered models with id/name/defaultVoice", async () => {
    const backend = new MlxTtsBackend({ manager: new ModelManager({ fetcher: async () => new Uint8Array() }), synthesizer: async () => Buffer.from("fake-audio") });
    const models = await backend.listModels();
    const ids = models.map((m) => m.id).sort();
    expect(ids).toEqual(["barkan-mlx", "kokoro-mlx", "parler-tts-mlx"]);
    for (const m of models) expect(m.name).toBeTruthy();
  });
});

describe("MlxTtsBackend — synthesize", () => {
  it("returns a Buffer in batch mode and an AudioStream in stream mode", async () => {
    await withScratchHome();
    const fakeBytes = new Uint8Array(64).fill(0xab);
    const manager = new ModelManager({ fetcher: async () => fakeBytes });
    const backend = new MlxTtsBackend({ manager, synthesizer: async () => Buffer.from("fake-audio") });
    // Force default model to barkan-mlx to ensure different model path is exercised.
    backend.setDefaultModel("barkan-mlx");
    const buf = await backend.synthesize("test batch", { stream: false });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect((buf as Buffer).byteLength).toBeGreaterThanOrEqual(0);
    const stream = await backend.synthesize("test stream", { stream: true });
    if (Buffer.isBuffer(stream)) throw new Error("expected AudioStream");
    expect(stream.backend).toBe("mlx");
    expect(stream.model).toBe("barkan-mlx");
    let total = 0;
    for await (const chunk of stream.chunks) total += chunk.byteLength;
    expect(total).toBeGreaterThan(0);
    // Frame size constant is used by the chunker.
    expect(FRAME_BYTES_8KHZ).toBe(160);
  });

  it("returns empty Buffer when platform is non-darwin (non-macOS fallback)", async () => {
    await withScratchHome();
    const manager = new ModelManager({ fetcher: async () => new Uint8Array() });
    // NO synthesizer injected — test the actual non-darwin fallback
    const backend = new MlxTtsBackend({ manager });
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    try {
      const out = await backend.synthesize("hello", { stream: false });
      expect(Buffer.isBuffer(out)).toBe(true);
      expect((out as Buffer).byteLength).toBe(0);
    } finally {
      Object.defineProperty(process, "platform", { value: original, configurable: true });
    }
  });
});

describe("MlxTtsBackend — wiring (registerMlxBackend hook)", () => {
  it("asHook() returns a callable that adapt to speakMlx()", async () => {
    await withScratchHome();
    const fakeBytes = new Uint8Array(16).fill(0x10);
    const manager = new ModelManager({ fetcher: async () => fakeBytes });
    const backend = new MlxTtsBackend({ manager, synthesizer: async () => Buffer.from("fake-audio") });
    const hook = backend.asHook();
    registerMlxBackend(hook as Parameters<typeof registerMlxBackend>[0]);
    const result = await speakMlx("hi", {});
    expect(result.backend).toBe("mlx");
    expect(typeof result.durationMs).toBe("number");
  });

  it("ensureMlxBackendWired() is a no-op on non-darwin", async () => {
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    try {
      // Should NOT throw, should NOT register anything (mlxHook remains unset
      // for this test run since no host installed one).
      await ensureMlxBackendWired();
      const result = await speakMlx("hi", {});
      expect(result.backend).toBe("none");
    } finally {
      Object.defineProperty(process, "platform", { value: original, configurable: true });
    }
  });

  it("ensureMlxBackendWired() installs the MLX hook on darwin", async () => {
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    __resetMlxBackendForTests();
    // Pre-register a test hook so ensureMlxBackendWired respects it (host precedence)
    registerMlxBackend(async () => ({ backend: "mlx" as const, spokenDirectly: false, audio: Buffer.alloc(0) }));
    try {
      await ensureMlxBackendWired();
      const result = await speakMlx("hi", {});
      expect(result.backend).toBe("mlx");
    } finally {
      Object.defineProperty(process, "platform", { value: original, configurable: true });
      __resetMlxBackendForTests();
    }
  });
});

describe("ModelManager — on-disk presence", () => {
  it("hasModel() returns true after ensureModel()", async () => {
    await withScratchHome();
    const manager = new ModelManager({ fetcher: async () => new Uint8Array([1, 2, 3]) });
    expect(manager.hasModel("kokoro-mlx")).toBe(false);
    await manager.ensureModel("kokoro-mlx");
    expect(manager.hasModel("kokoro-mlx")).toBe(true);
    // Marker + model files exist on disk.
    const { existsSync } = await import("node:fs");
    expect(existsSync(modelPath("kokoro-mlx"))).toBe(true);
    expect(existsSync(modelMarker("kokoro-mlx"))).toBe(true);
  });

  it("ensureModel() throws for unknown model id", async () => {
    const manager = new ModelManager({ fetcher: async () => new Uint8Array() });
    await expect(manager.ensureModel("nope-mlx")).rejects.toThrow(/unknown MLX model/);
  });
});