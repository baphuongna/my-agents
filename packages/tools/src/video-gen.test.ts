import { describe, it, expect, vi } from "vitest";

describe("[unit] video-gen tool", () => {
  it("module loads and exports videoGenTool", async () => {
    const m = await import("./video-gen.js");
    expect(m.videoGenTool).toBeDefined();
    expect(m.videoGenTool.meta.name).toBe("video_generate");
  });

  it("returns error when prompt is missing", async () => {
    const { videoGenTool } = await import("./video-gen.js");
    const res = await videoGenTool.run({} as Record<string, unknown>);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("prompt");
  });

  it("returns error when REPLICATE_API_TOKEN not set", async () => {
    const orig = process.env.REPLICATE_API_TOKEN;
    delete process.env.REPLICATE_API_TOKEN;
    try {
      const { videoGenTool } = await import("./video-gen.js");
      const res = await videoGenTool.run({ prompt: "sunset" });
      expect(res.ok).toBe(false);
      expect(res.error).toContain("REPLICATE_API_TOKEN");
    } finally {
      if (orig) process.env.REPLICATE_API_TOKEN = orig;
    }
  });

  it("returns error when MYA_REPLICATE_VIDEO_MODEL not set", async () => {
    const origToken = process.env.REPLICATE_API_TOKEN;
    const origModel = process.env.MYA_REPLICATE_VIDEO_MODEL;
    process.env.REPLICATE_API_TOKEN = "test-token";
    delete process.env.MYA_REPLICATE_VIDEO_MODEL;
    try {
      // Need fresh import to pick up env changes
      vi.resetModules();
      const { videoGenTool } = await import("./video-gen.js");
      const res = await videoGenTool.run({ prompt: "sunset" });
      expect(res.ok).toBe(false);
      expect(res.error).toContain("MYA_REPLICATE_VIDEO_MODEL");
    } finally {
      if (origToken) process.env.REPLICATE_API_TOKEN = origToken;
      else delete process.env.REPLICATE_API_TOKEN;
      if (origModel) process.env.MYA_REPLICATE_VIDEO_MODEL = origModel;
    }
  });

  it("meta has WorkspaceWrite requiredMode (trust boundary)", async () => {
    const { videoGenTool } = await import("./video-gen.js");
    expect(videoGenTool.meta.requiredMode).toBe("WorkspaceWrite");
  });

  it("args schema requires prompt", async () => {
    const { videoGenTool } = await import("./video-gen.js");
    const schema = videoGenTool.meta.args as { required?: string[] };
    expect(schema.required).toContain("prompt");
  });
});
