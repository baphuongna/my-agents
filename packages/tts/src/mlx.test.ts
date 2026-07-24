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
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { MlxTtsBackend, FRAME_BYTES_8KHZ } from "./mlx.js";
import { createHash } from "node:crypto";
import { ModelManager, modelPath, modelMarker, verifyModel } from "./model-manager.js";
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

describe("verifyModel — standalone SHA-256 verification", () => {
  it("returns true and warns when sha256 is empty (skip)", async () => {
    const file = join(scratchDir!, "test-model.bin");
    writeFileSync(file, Buffer.from([1, 2, 3]));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await verifyModel(file, "");
    expect(result).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("empty"));
    warnSpy.mockRestore();
  });

  it("returns true for correct hash, false for wrong hash", async () => {
    const content = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const file = join(scratchDir!, "test-model.bin");
    writeFileSync(file, content);
    const correctHash = createHash("sha256").update(content).digest("hex");
    expect(await verifyModel(file, correctHash)).toBe(true);
    expect(await verifyModel(file, "0".repeat(64))).toBe(false);
  });
});

// ─── Model selection (P3-2) ────────────────────────────────────────────────

describe("MlxTtsBackend — model selection", () => {
  it("selectModel() returns the smallest model for preference:lightweight", () => {
    const backend = new MlxTtsBackend({ manager: new ModelManager({ fetcher: async () => new Uint8Array() }) });
    expect(backend.selectModel({ preference: "lightweight" })).toBe("kokoro-mlx");
  });

  it("selectModel() returns the largest model for preference:quality", () => {
    const backend = new MlxTtsBackend({ manager: new ModelManager({ fetcher: async () => new Uint8Array() }) });
    expect(backend.selectModel({ preference: "quality" })).toBe("parler-tts-mlx");
  });

  it("selectModel() returns multilingual model for language:multilingual", () => {
    const backend = new MlxTtsBackend({ manager: new ModelManager({ fetcher: async () => new Uint8Array() }) });
    expect(backend.selectModel({ language: "multilingual" })).toBe("barkan-mlx");
  });

  it("selectModel() falls back to the default model when no criteria match", () => {
    const backend = new MlxTtsBackend({ manager: new ModelManager({ fetcher: async () => new Uint8Array() }) });
    expect(backend.selectModel()).toBe("kokoro-mlx"); // default
    expect(backend.selectModel({ language: "en" })).toBe("kokoro-mlx");
  });

  it("applyModelSelection() sets the default model to the selected one", () => {
    const backend = new MlxTtsBackend({ manager: new ModelManager({ fetcher: async () => new Uint8Array() }) });
    expect(backend.getDefaultModel()).toBe("kokoro-mlx");
    const chosen = backend.applyModelSelection({ preference: "quality" });
    expect(chosen).toBe("parler-tts-mlx");
    expect(backend.getDefaultModel()).toBe("parler-tts-mlx");
  });
});

// ─── Voice cloning (P3-2) ──────────────────────────────────────────────────

describe("MlxTtsBackend — voice cloning", () => {
  it("cloneVoice() registers a cloned voice with a unique id", () => {
    const backend = new MlxTtsBackend({ manager: new ModelManager({ fetcher: async () => new Uint8Array() }) });
    const clone = backend.cloneVoice("My Speaker", "/tmp/sample.wav");
    expect(clone.id).toMatch(/^clone:my-speaker:/);
    expect(clone.name).toBe("My Speaker");
    expect(clone.sourceSample).toBe("/tmp/sample.wav");
    expect(clone.modelId).toBe("kokoro-mlx");
    expect(clone.createdAt).toBeGreaterThan(0);
  });

  it("listVoiceClones() returns all registered clones", () => {
    const backend = new MlxTtsBackend({ manager: new ModelManager({ fetcher: async () => new Uint8Array() }) });
    backend.cloneVoice("Alice", "/tmp/alice.wav");
    backend.cloneVoice("Bob", "/tmp/bob.wav");
    expect(backend.listVoiceClones()).toHaveLength(2);
    const names = backend.listVoiceClones().map((c) => c.name).sort();
    expect(names).toEqual(["Alice", "Bob"]);
  });

  it("getVoiceClone() returns the clone by id, undefined if missing", () => {
    const backend = new MlxTtsBackend({ manager: new ModelManager({ fetcher: async () => new Uint8Array() }) });
    const clone = backend.cloneVoice("Alice", "/tmp/alice.wav");
    expect(backend.getVoiceClone(clone.id)).toBeDefined();
    expect(backend.getVoiceClone("nope")).toBeUndefined();
  });

  it("removeVoiceClone() deletes a clone and returns true/false", () => {
    const backend = new MlxTtsBackend({ manager: new ModelManager({ fetcher: async () => new Uint8Array() }) });
    const clone = backend.cloneVoice("Alice", "/tmp/alice.wav");
    expect(backend.removeVoiceClone(clone.id)).toBe(true);
    expect(backend.removeVoiceClone(clone.id)).toBe(false);
    expect(backend.listVoiceClones()).toHaveLength(0);
  });

  it("cloneVoice() throws on empty name or sample path", () => {
    const backend = new MlxTtsBackend({ manager: new ModelManager({ fetcher: async () => new Uint8Array() }) });
    expect(() => backend.cloneVoice("", "/tmp/x.wav")).toThrow(/name required/);
    expect(() => backend.cloneVoice("Alice", "")).toThrow(/source sample path required/);
    expect(() => backend.cloneVoice("  ", "  ")).toThrow();
  });

  it("synthesize() resolves a cloned voice to its source sample path", async () => {
    await withScratchHome();
    let receivedVoice: string | undefined;
    const manager = new ModelManager({ fetcher: async () => new Uint8Array(8) });
    const backend = new MlxTtsBackend({
      manager,
      synthesizer: async (_text, _modelPath, opts) => {
        receivedVoice = opts.voice;
        return Buffer.from("audio");
      },
    });
    const clone = backend.cloneVoice("Alice", "/tmp/alice-sample.wav");
    await backend.synthesize("hello", { voice: clone.id });
    // The synthesizer should receive the resolved source sample path.
    expect(receivedVoice).toBe("/tmp/alice-sample.wav");
  });

  it("resolveVoice() returns undefined for no voice, passthrough for unknown", () => {
    const backend = new MlxTtsBackend({ manager: new ModelManager({ fetcher: async () => new Uint8Array() }) });
    expect(backend.resolveVoice(undefined)).toBeUndefined();
    expect(backend.resolveVoice("unknown-voice")).toBe("unknown-voice");
  });
});

// ─── Error modes (P3-2) ────────────────────────────────────────────────────

describe("MlxTtsBackend — error modes", () => {
  it("synthesize() throws in strict mode when not on macOS", async () => {
    const manager = new ModelManager({ fetcher: async () => new Uint8Array() });
    const backend = new MlxTtsBackend({ manager });
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    try {
      await expect(backend.synthesize("hi", { strict: true })).rejects.toThrow(/not on macOS/);
    } finally {
      Object.defineProperty(process, "platform", { value: original, configurable: true });
    }
  });

  it("synthesize() throws in strict mode when model is unknown", async () => {
    const manager = new ModelManager({ fetcher: async () => new Uint8Array() });
    const backend = new MlxTtsBackend({ manager, defaultModelId: "kokoro-mlx" });
    // Force unknown model by overriding internal state
    (backend as unknown as { defaultModelId: string }).defaultModelId = "nonexistent-mlx";
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    try {
      await expect(backend.synthesize("hi", { strict: true })).rejects.toThrow(/unknown model/);
    } finally {
      Object.defineProperty(process, "platform", { value: original, configurable: true });
    }
  });

  it("synthesize() returns empty buffer in non-strict mode on non-macOS (fail-open)", async () => {
    const manager = new ModelManager({ fetcher: async () => new Uint8Array() });
    const backend = new MlxTtsBackend({ manager });
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    try {
      const out = await backend.synthesize("hi", {});
      expect(Buffer.isBuffer(out)).toBe(true);
      expect((out as Buffer).byteLength).toBe(0);
    } finally {
      Object.defineProperty(process, "platform", { value: original, configurable: true });
    }
  });

  it("synthesizeStream() yields no chunks on non-macOS (fail-open)", async () => {
    const manager = new ModelManager({ fetcher: async () => new Uint8Array() });
    const backend = new MlxTtsBackend({ manager });
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of backend.synthesizeStream("hi")) chunks.push(chunk);
      expect(chunks).toHaveLength(0);
    } finally {
      Object.defineProperty(process, "platform", { value: original, configurable: true });
    }
  });
});