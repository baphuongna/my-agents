import { describe, it, expect } from "vitest";

describe("[unit] image-gen tool", () => {
  it("module loads and exports imageGenTool", async () => {
    const m = await import("./image-gen.js");
    expect(m.imageGenTool).toBeDefined();
    expect(m.imageGenTool.meta.name).toBe("image_generate");
  });

  it("returns error when prompt is missing", async () => {
    const { imageGenTool } = await import("./image-gen.js");
    const res = await imageGenTool.run({} as Record<string, unknown>);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("prompt");
  });

  it("returns error when no backend configured (no API keys)", async () => {
    const origKey = process.env.OPENAI_API_KEY;
    const origStab = process.env.STABILITY_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.STABILITY_API_KEY;
    try {
      const { imageGenTool } = await import("./image-gen.js");
      const res = await imageGenTool.run({ prompt: "a cat" });
      expect(res.ok).toBe(false);
      expect(res.error).toContain("no image gen backend");
    } finally {
      if (origKey) process.env.OPENAI_API_KEY = origKey;
      if (origStab) process.env.STABILITY_API_KEY = origStab;
    }
  });

  it("meta has WorkspaceWrite requiredMode (trust boundary)", async () => {
    const { imageGenTool } = await import("./image-gen.js");
    expect(imageGenTool.meta.requiredMode).toBe("WorkspaceWrite");
  });

  it("args schema requires prompt", async () => {
    const { imageGenTool } = await import("./image-gen.js");
    const schema = imageGenTool.meta.args as { required?: string[] };
    expect(schema.required).toContain("prompt");
  });
});
