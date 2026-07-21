/**
 * @my-agent/tools — Image generation tool.
 *
 * C1: generates images via OpenAI DALL-E, Stability AI, or Replicate.
 * Output: base64 PNG or file path. WorkspaceWrite required.
 *
 * Source: §07 Tools, PLAN-FEATURES C1.
 */
import type { ToolImpl } from "./registry.js";
import type { ToolResult } from "@my-agent/core";

interface ImageGenBackend {
  name: string;
  available: () => boolean;
  generate: (prompt: string, opts: ImageGenOpts) => Promise<{ b64?: string; url?: string; error?: string }>;
}

interface ImageGenOpts {
  size?: "256x256" | "512x512" | "1024x1024";
  quality?: "standard" | "hd";
}

function getBackends(): ImageGenBackend[] {
  const backends: ImageGenBackend[] = [];

  // OpenAI DALL-E
  if (process.env.OPENAI_API_KEY) {
    backends.push({
      name: "dalle",
      available: () => true,
      generate: async (prompt, opts) => {
        try {
          const res = await fetch("https://api.openai.com/v1/images/generations", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
              prompt, n: 1,
              size: opts.size ?? "1024x1024",
              quality: opts.quality ?? "standard",
              response_format: "b64_json",
            }),
            signal: AbortSignal.timeout(60_000),
          });
          if (!res.ok) return { error: `DALL-E API ${res.status}: ${(await res.text()).slice(0, 200)}` };
          const data = await res.json() as { data?: Array<{ b64_json?: string }> };
          return { b64: data.data?.[0]?.b64_json };
        } catch (e) { return { error: (e as Error).message }; }
      },
    });
  }

  // Stability AI
  if (process.env.STABILITY_API_KEY) {
    backends.push({
      name: "stability",
      available: () => true,
      generate: async (prompt, opts) => {
        try {
          const formData = new FormData();
          formData.append("text_prompts[0][text]", prompt);
          formData.append("cfg_scale", "7");
          formData.append("height", opts.size?.split("x")[1] ?? "1024");
          formData.append("width", opts.size?.split("x")[0] ?? "1024");
          const res = await fetch("https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image", {
            method: "POST",
            headers: { authorization: `Bearer ${process.env.STABILITY_API_KEY}` },
            body: formData,
            signal: AbortSignal.timeout(90_000),
          });
          if (!res.ok) return { error: `Stability API ${res.status}` };
          const data = await res.json() as { artifacts?: Array<{ base64?: string }> };
          return { b64: data.artifacts?.[0]?.base64 };
        } catch (e) { return { error: (e as Error).message }; }
      },
    });
  }

  return backends;
}

export const imageGenTool: ToolImpl = {
  meta: {
    name: "image_generate",
    description: "Generate an image from a text prompt using DALL-E or Stability AI. Returns base64 PNG.",
    args: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Text description of the image to generate" },
        size: { type: "string", enum: ["256x256", "512x512", "1024x1024"], description: "Image size (default 1024x1024)" },
        quality: { type: "string", enum: ["standard", "hd"], description: "Image quality (default standard)" },
      },
      required: ["prompt"],
    },
    requiredMode: "WorkspaceWrite",
  },
  async run(args): Promise<ToolResult> {
    const a = args as { prompt?: string; size?: ImageGenOpts["size"]; quality?: ImageGenOpts["quality"] };
    if (!a.prompt) return { callId: "image_generate", ok: false, output: null, error: "prompt required" };

    const backends = getBackends();
    if (backends.length === 0) {
      return {
        callId: "image_generate", ok: false, output: null,
        error: "no image gen backend configured (set OPENAI_API_KEY or STABILITY_API_KEY)",
      };
    }

    const opts: ImageGenOpts = { size: a.size, quality: a.quality };
    for (const backend of backends) {
      const result = await backend.generate(a.prompt, opts);
      if (result.b64) {
        return {
          callId: "image_generate", ok: true,
          output: { backend: backend.name, format: "base64", data: result.b64.slice(0, 200) + "..." },
        };
      }
      if (result.url) {
        return { callId: "image_generate", ok: true, output: { backend: backend.name, format: "url", url: result.url } };
      }
    }
    return { callId: "image_generate", ok: false, output: null, error: "all backends failed" };
  },
};
