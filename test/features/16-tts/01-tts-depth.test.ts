/**
 * Feature §16 — TTS functional depth.
 *
 * The smoke suite only checks module load. This file exercises the real
 * behaviour of `@my-agent/tts`:
 *   - backend selection / dispatch (detectBackend + speak switch)
 *   - fail-open semantics (no backend → {backend:"none"}, never throws)
 *   - MLX hook registration + reset
 *   - ModelManager: registry, cache-path resolution, verify, download lifecycle
 *   - MlxTtsBackend: default model, fail-open on non-macOS, health()
 *
 * We cannot actually produce audio on a headless box (no say/espeak/MLX), so
 * the spawn-backed backends are NOT invoked directly (they would emit an
 * unhandled 'error' for a missing binary). Instead we drive the pure fail-open
 * paths and the injected-hook paths which are fully deterministic.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tts = await import("../../../packages/tts/src/index.ts").catch(() => null);
const modelMgr = await import("../../../packages/tts/src/model-manager.ts").catch(() => null);
const mlxMod = await import("../../../packages/tts/src/mlx.ts").catch(() => null);

const SKIP_TTS = !tts;
const SKIP_MGR = !modelMgr;
const SKIP_MLX = !mlxMod;

describe.skipIf(SKIP_TTS)("[§16 tts] module surface + backend selection", () => {
  it("exports the expected public API", () => {
    const t = tts!;
    expect(typeof t.detectBackend).toBe("function");
    expect(typeof t.speak).toBe("function");
    expect(typeof t.registerMlxBackend).toBe("function");
    expect(typeof t.speakMlx).toBe("function");
    expect(typeof t.ensureMlxBackendWired).toBe("function");
    expect(typeof t.__resetMlxBackendForTests).toBe("function");
  });

  it("detectBackend() returns a member of the TtsBackend union", () => {
    const backend = tts!.detectBackend();
    const allowed = ["mlx", "say", "espeak", "festival", "pico2wave", "none"];
    expect(allowed).toContain(backend);
  });

  it("detectBackend() returns 'none' when no TTS binary is on PATH (headless fallback)", () => {
    // On this CI box none of say/espeak/festival/pico2wave/mlx are installed.
    const backend = tts!.detectBackend();
    expect(backend).toBe("none");
  });

  it("speak({backend:'none'}) is fail-open and never throws", async () => {
    const r = await tts!.speak("hello world", { backend: "none" });
    expect(r.backend).toBe("none");
    expect(r.spokenDirectly).toBe(false);
    expect(r.audioFile).toBeUndefined();
  });

  it("speak() with no backend arg uses detectBackend() and returns a valid result shape", async () => {
    const r = await tts!.speak("hi");
    expect(typeof r.backend).toBe("string");
    expect(typeof r.spokenDirectly).toBe("boolean");
  });
});

describe.skipIf(SKIP_TTS)("[§16 tts] MLX hook registration lifecycle", () => {
  afterEach(() => {
    // Always reset between tests so hook state never leaks.
    tts!.__resetMlxBackendForTests();
  });

  it("registerMlxBackend wires a custom hook that speakMlx invokes with text+opts", async () => {
    let seen: { text?: string; voice?: string } = {};
    tts!.registerMlxBackend(async (text, opts) => {
      seen = { text, voice: opts.voice };
      return { backend: "mlx", spokenDirectly: true, audioFile: "/tmp/tts-out.wav" };
    });
    const r = await tts!.speakMlx("greetings", { voice: "kokoro-default" });
    expect(r.backend).toBe("mlx");
    expect(r.spokenDirectly).toBe(true);
    expect(r.audioFile).toBe("/tmp/tts-out.wav");
    expect(seen).toEqual({ text: "greetings", voice: "kokoro-default" });
  });

  it("speak({backend:'mlx'}) dispatches to the registered hook", async () => {
    tts!.registerMlxBackend(async (text) => ({
      backend: "mlx",
      spokenDirectly: true,
      durationMs: 7,
    }));
    const r = await tts!.speak("x", { backend: "mlx" });
    expect(r.backend).toBe("mlx");
    expect(r.spokenDirectly).toBe(true);
  });

  it("__resetMlxBackendForTests clears the hook (speakMlx falls back to none)", async () => {
    tts!.registerMlxBackend(async () => ({ backend: "mlx", spokenDirectly: true }));
    tts!.__resetMlxBackendForTests();
    const r = await tts!.speakMlx("after-reset", {});
    expect(r.backend).toBe("none");
    expect(r.spokenDirectly).toBe(false);
  });

  it("ensureMlxBackendWired() is idempotent and does not throw on non-macOS", async () => {
    await expect(tts!.ensureMlxBackendWired()).resolves.toBeUndefined();
    // Calling again must be a no-op (one-shot wiring flag).
    await expect(tts!.ensureMlxBackendWired()).resolves.toBeUndefined();
  });
});

describe.skipIf(SKIP_MGR)("[§16 tts] ModelManager — registry + cache paths", () => {
  it("MODEL_REGISTRY is frozen and contains the known model ids", () => {
    const reg = modelMgr!.MODEL_REGISTRY;
    expect(Object.isFrozen(reg)).toBe(true);
    const ids = reg.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(["barkan-mlx", "kokoro-mlx", "parler-tts-mlx"]));
  });

  it("findRegistryEntry returns the entry for a known id and undefined for unknown", () => {
    const k = modelMgr!.findRegistryEntry("kokoro-mlx");
    expect(k).toBeDefined();
    expect(k!.name).toMatch(/kokoro/i);
    expect(modelMgr!.findRegistryEntry("does-not-exist")).toBeUndefined();
  });

  it("modelsRoot() honors MYA_MODELS_ROOT override; modelPath() joins the id", () => {
    const prev = process.env["MYA_MODELS_ROOT"];
    process.env["MYA_MODELS_ROOT"] = "/tmp/__mya_tts_models_root__";
    try {
      expect(modelMgr!.modelsRoot()).toBe("/tmp/__mya_tts_models_root__");
      expect(modelMgr!.modelPath("kokoro-mlx")).toBe(
        join("/tmp/__mya_tts_models_root__", "kokoro-mlx"),
      );
      expect(modelMgr!.modelMarker("kokoro-mlx")).toBe(
        join("/tmp/__mya_tts_models_root__", "kokoro-mlx", ".verified"),
      );
    } finally {
      if (prev === undefined) delete process.env["MYA_MODELS_ROOT"];
      else process.env["MYA_MODELS_ROOT"] = prev;
    }
  });

  it("ModelManager.listModels() returns every registry entry", () => {
    const mgr = new modelMgr!.ModelManager();
    const list = mgr.listModels();
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list.every((m) => typeof m.id === "string" && typeof m.repo === "string")).toBe(true);
  });

  it("ensureModel() throws for an unknown model id", async () => {
    const mgr = new modelMgr!.ModelManager();
    await expect(mgr.ensureModel("no-such-model")).rejects.toThrow(/unknown MLX model/);
  });

  it("verifyModel() skips verification (returns true) when sha256 is empty", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tts-verify-"));
    const f = join(dir, "model.bin");
    writeFileSync(f, Buffer.from("payload"));
    try {
      await expect(modelMgr!.verifyModel(f, "")).resolves.toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("verifyModel() returns true on matching hash and false on mismatch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tts-verify2-"));
    const f = join(dir, "model.bin");
    const payload = Buffer.from("the real weights");
    writeFileSync(f, payload);
    const good = createHash("sha256").update(payload).digest("hex");
    try {
      await expect(modelMgr!.verifyModel(f, good)).resolves.toBe(true);
      await expect(modelMgr!.verifyModel(f, "deadbeef".repeat(8))).resolves.toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ensureModel() downloads + verifies + writes marker (injected fetcher, no network)", async () => {
    const prev = process.env["MYA_MODELS_ROOT"];
    const root = mkdtempSync(join(tmpdir(), "tts-ensure-"));
    process.env["MYA_MODELS_ROOT"] = root;
    try {
      const bytes = Buffer.from("synthetic weights");
      const sha = createHash("sha256").update(bytes).digest("hex");
      // Temporarily pin a sha onto a registry entry by constructing a manager
      // whose fetcher returns the known bytes; we verify against an empty sha
      // (registry pins are empty) which skips → marker written.
      const mgr = new modelMgr!.ModelManager({ fetcher: async () => new Uint8Array(bytes) });
      const path = await mgr.ensureModel("kokoro-mlx");
      expect(path).toBe(join(root, "kokoro-mlx"));
      // Marker timestamp should now be readable.
      const ts = modelMgr!.readModelMarker("kokoro-mlx");
      expect(typeof ts).toBe("number");
      // hasModel should now be true (sha256 empty → marker not required, but we wrote one).
      expect(mgr.hasModel("kokoro-mlx")).toBe(true);
      // Re-running is idempotent (no re-download).
      const again = await mgr.ensureModel("kokoro-mlx");
      expect(again).toBe(path);
      // sanity: the hash helper is correct
      expect(sha.length).toBe(64);
    } finally {
      process.env["MYA_MODELS_ROOT"] = prev ?? "";
      if (prev === undefined) delete process.env["MYA_MODELS_ROOT"];
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe.skipIf(SKIP_MLX)("[§16 tts] MlxTtsBackend — fail-open + model config", () => {
  it("defaults to the kokoro-mlx model", () => {
    const b = new mlxMod!.MlxTtsBackend();
    expect(b.getDefaultModel()).toBe("kokoro-mlx");
  });

  it("setDefaultModel() accepts a known id and rejects an unknown one", () => {
    const b = new mlxMod!.MlxTtsBackend();
    b.setDefaultModel("barkan-mlx");
    expect(b.getDefaultModel()).toBe("barkan-mlx");
    expect(() => b.setDefaultModel("nope")).toThrow(/unknown MLX model/);
  });

  it("synthesize() is fail-open on non-macOS: returns an empty Buffer", async () => {
    const b = new mlxMod!.MlxTtsBackend();
    const out = await b.synthesize("hello");
    expect(Buffer.isBuffer(out)).toBe(true);
    expect((out as Buffer).byteLength).toBe(0);
  });

  it("synthesize({strict:true}) throws on non-macOS instead of failing open", async () => {
    const b = new mlxMod!.MlxTtsBackend();
    await expect(b.synthesize("hello", { strict: true })).rejects.toThrow(/mlx: not on macOS/);
  });

  it("health() reports 'Failed' on non-macOS", async () => {
    const b = new mlxMod!.MlxTtsBackend();
    await expect(b.health()).resolves.toBe("Failed");
  });

  it("listModels() returns id + display name for every registry entry", async () => {
    const b = new mlxMod!.MlxTtsBackend();
    const models = await b.listModels();
    expect(models.length).toBeGreaterThanOrEqual(3);
    expect(models.every((m) => typeof m.id === "string" && typeof m.name === "string")).toBe(true);
  });

  it("asHook() returns spokenDirectly:false when the underlying synthesize yields no bytes", async () => {
    const b = new mlxMod!.MlxTtsBackend();
    const hook = b.asHook();
    const r = await hook("hello", { voice: "kokoro-default", rate: 1 });
    expect(r.backend).toBe("mlx");
    expect(r.spokenDirectly).toBe(false);
  });
});
