import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { imageGenTool } from "./image-gen.js";
import { videoGenTool } from "./video-gen.js";
import { diskCleanupTool } from "./disk-cleanup.js";

describe("[unit] tools meta + validation", () => {
  describe("image-gen", () => {
    it("meta: name + WorkspaceWrite", () => {
      expect(imageGenTool.meta.name).toBe("image_generate");
      expect(imageGenTool.meta.requiredMode).toBe("WorkspaceWrite");
    });

    it("missing prompt → error", async () => {
      const r = await imageGenTool.run({});
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/prompt required|No image generation backend/);
    });

    it("no backend available (no API keys) → error", async () => {
      const r = await imageGenTool.run({ prompt: "a cat" });
      expect(r.ok).toBe(false);
    });
  });

  describe("video-gen", () => {
    it("meta: name + WorkspaceWrite", () => {
      expect(videoGenTool.meta.name).toBe("video_generate");
      expect(videoGenTool.meta.requiredMode).toBe("WorkspaceWrite");
    });

    it("missing prompt → error", async () => {
      const r = await videoGenTool.run({});
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/prompt required/);
    });

    it("no REPLICATE_API_TOKEN → error", async () => {
      delete process.env.REPLICATE_API_TOKEN;
      const r = await videoGenTool.run({ prompt: "sunset" });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/REPLICATE_API_TOKEN/);
    });
  });

  describe("disk-cleanup", () => {
    it("meta: name + WorkspaceWrite", () => {
      expect(diskCleanupTool.meta.name).toBe("disk_cleanup");
      expect(diskCleanupTool.meta.requiredMode).toBe("WorkspaceWrite");
    });

    it("scan action returns result (no crash)", async () => {
      const r = await diskCleanupTool.run({ action: "scan" });
      expect(r.ok).toBe(true);
      expect(r.output).toBeDefined();
    });

    it("missing action defaults to scan", async () => {
      const r = await diskCleanupTool.run({});
      expect(r.ok).toBe(true);
    });
  });
});
