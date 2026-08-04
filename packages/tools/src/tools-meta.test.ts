import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { imageGenTool } from "./image-gen.js";
import { videoGenTool } from "./video-gen.js";
import { diskCleanupTool } from "./disk-cleanup.js";

describe("[unit] tools meta + validation", () => {
  describe("image-gen", () => {
    it("meta: name + WorkspaceWrite", () => {
      expect(imageGenTool.meta.name).toBe("image_generate");
      expect(imageGenTool.meta.requiredMode).toBe("WorkspaceWrite");
    }, {} as never);

    it("missing prompt → error", async () => {
      const r = await imageGenTool.run({}, {} as never);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/prompt required|No image generation backend/);
    }, {} as never);

    it("no backend available (no API keys) → error", async () => {
      const r = await imageGenTool.run({ prompt: "a cat" }, {} as never);
      expect(r.ok).toBe(false);
    }, {} as never);
  }, {} as never);

  describe("video-gen", () => {
    it("meta: name + WorkspaceWrite", () => {
      expect(videoGenTool.meta.name).toBe("video_generate");
      expect(videoGenTool.meta.requiredMode).toBe("WorkspaceWrite");
    }, {} as never);

    it("missing prompt → error", async () => {
      const r = await videoGenTool.run({}, {} as never);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/prompt required/);
    }, {} as never);

    it("no REPLICATE_API_TOKEN → error", async () => {
      delete process.env.REPLICATE_API_TOKEN;
      const r = await videoGenTool.run({ prompt: "sunset" }, {} as never);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/REPLICATE_API_TOKEN/);
    }, {} as never);
  }, {} as never);

  describe("disk-cleanup", () => {
    it("meta: name + WorkspaceWrite", () => {
      expect(diskCleanupTool.meta.name).toBe("disk_cleanup");
      expect(diskCleanupTool.meta.requiredMode).toBe("WorkspaceWrite");
    }, {} as never);

    it("scan action returns result (no crash)", async () => {
      const r = await diskCleanupTool.run({ action: "scan" }, {} as never);
      expect(r.ok).toBe(true);
      expect(r.output).toBeDefined();
    }, {} as never);

    it("missing action defaults to scan", async () => {
      const r = await diskCleanupTool.run({}, {} as never);
      expect(r.ok).toBe(true);
    }, {} as never);
  }, {} as never);
}, {} as never);
