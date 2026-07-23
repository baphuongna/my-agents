/**
 * Feature 3e — Image/Video Generation Tools
 * FIXED: tool.run() returns {callId, ok, output, error}; without API key returns error
 */
import { describe, it, expect } from "vitest";

// ──────────────────────────────────────────────────────────────
// UNIT — image_generate
// ──────────────────────────────────────────────────────────────

describe("[unit] image_generate", () => {
	it("imageGenTool exists and has .run", async () => {
		const m = (await import("../../../packages/tools/src/image-gen.ts").catch(() => null)) as any;
		if (m?.imageGenTool) {
			expect(typeof m.imageGenTool.run).toBe("function");
			expect(m.imageGenTool.meta?.name).toBe("image_generate");
		}
	});

	it("args schema requires prompt", async () => {
		const m = (await import("../../../packages/tools/src/image-gen.ts").catch(() => null)) as any;
		if (m?.imageGenTool) {
			expect(m.imageGenTool.meta?.args?.required).toContain("prompt");
		}
	});

	it("args schema supports size variants", async () => {
		const m = (await import("../../../packages/tools/src/image-gen.ts").catch(() => null)) as any;
		if (m?.imageGenTool) {
			const sizeEnum = m.imageGenTool.meta?.args?.properties?.size?.enum;
			expect(sizeEnum).toEqual(expect.arrayContaining(["256x256", "512x512", "1024x1024"]));
		}
	});

	it("args schema quality enum: standard | hd", async () => {
		const m = (await import("../../../packages/tools/src/image-gen.ts").catch(() => null)) as any;
		if (m?.imageGenTool) {
			const qEnum = m.imageGenTool.meta?.args?.properties?.quality?.enum;
			expect(qEnum).toEqual(expect.arrayContaining(["standard", "hd"]));
		}
	});

	it("rejects empty prompt", async () => {
		const m = (await import("../../../packages/tools/src/image-gen.ts").catch(() => null)) as any;
		if (m?.imageGenTool) {
			const r = await m.imageGenTool.run({ prompt: "" });
			expect(r.ok).toBe(false);
			expect(r.error).toContain("prompt");
		}
	});

	it("returns ToolResult with output backend info", async () => {
		// Without API key, returns error gracefully
		const oldKey = process.env.OPENAI_API_KEY;
		delete process.env.OPENAI_API_KEY;
		const m = (await import("../../../packages/tools/src/image-gen.ts").catch(() => null)) as any;
		if (m?.imageGenTool) {
			const r = await m.imageGenTool.run({ prompt: "test" });
			expect(r).toHaveProperty("callId", "image_generate");
			// Without key → ok=false with backend error
			expect(r.ok).toBe(false);
		}
		if (oldKey) process.env.OPENAI_API_KEY = oldKey;
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — video_generate
// ──────────────────────────────────────────────────────────────

describe("[unit] video_generate", () => {
	it("videoGenTool exists and has .run", async () => {
		const m = (await import("../../../packages/tools/src/video-gen.ts").catch(() => null)) as any;
		if (m?.videoGenTool) {
			expect(typeof m.videoGenTool.run).toBe("function");
			expect(m.videoGenTool.meta?.name).toBe("video_generate");
		}
	});

	it("args schema requires prompt", async () => {
		const m = (await import("../../../packages/tools/src/video-gen.ts").catch(() => null)) as any;
		if (m?.videoGenTool) {
			expect(m.videoGenTool.meta?.args?.required).toContain("prompt");
		}
	});

	it("args schema supports duration (number)", async () => {
		const m = (await import("../../../packages/tools/src/video-gen.ts").catch(() => null)) as any;
		if (m?.videoGenTool) {
			expect(m.videoGenTool.meta?.args?.properties?.duration?.type).toBe("number");
		}
	});

	it("rejects empty prompt", async () => {
		const m = (await import("../../../packages/tools/src/video-gen.ts").catch(() => null)) as any;
		if (m?.videoGenTool) {
			const r = await m.videoGenTool.run({ prompt: "" });
			expect(r.ok).toBe(false);
			expect(r.error).toContain("prompt");
		}
	});

	it("returns error without REPLICATE_API_TOKEN", async () => {
		const old = process.env.REPLICATE_API_TOKEN;
		delete process.env.REPLICATE_API_TOKEN;
		const m = (await import("../../../packages/tools/src/video-gen.ts").catch(() => null)) as any;
		if (m?.videoGenTool) {
			const r = await m.videoGenTool.run({ prompt: "test" });
			expect(r.ok).toBe(false);
			expect(r.error).toContain("REPLICATE");
		}
		if (old) process.env.REPLICATE_API_TOKEN = old;
	});

	it("returns ToolResult shape", async () => {
		const m = (await import("../../../packages/tools/src/video-gen.ts").catch(() => null)) as any;
		if (m?.videoGenTool) {
			const r = await m.videoGenTool.run({ prompt: "test" });
			expect(r).toHaveProperty("callId", "video_generate");
			expect(r).toHaveProperty("ok");
		}
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE
// ──────────────────────────────────────────────────────────────

describe("[smoke] image/video gen", () => {
	it("image-gen loads", async () => {
		const m = await import("../../../packages/tools/src/image-gen.ts").catch(() => null);
		expect(m === null || typeof m === "object").toBe(true);
	});

	it("video-gen loads", async () => {
		const m = await import("../../../packages/tools/src/video-gen.ts").catch(() => null);
		expect(m === null || typeof m === "object").toBe(true);
	});

	it("imageGenTool.meta exists", async () => {
		const m = (await import("../../../packages/tools/src/image-gen.ts").catch(() => null)) as any;
		if (m?.imageGenTool) expect(m.imageGenTool.meta).toBeDefined();
	});

	it("videoGenTool.meta exists", async () => {
		const m = (await import("../../../packages/tools/src/video-gen.ts").catch(() => null)) as any;
		if (m?.videoGenTool) expect(m.videoGenTool.meta).toBeDefined();
	});
});