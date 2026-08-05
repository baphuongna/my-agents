/**
 * @my-agent/tools — Video generation tool.
 *
 * C2: generates videos via Replicate or Runway. Async polling.
 * Source: §07 Tools, PLAN-FEATURES C2.
 */
import type { ToolImpl } from "./registry.js";
import type { ToolResult } from "@my-agent/core";
import { nowWallclock } from "@my-agent/core";

export const videoGenTool: ToolImpl = {
  meta: {
    name: "video_generate",
    description: "Generate a video from a text prompt using Replicate. Returns a video URL after polling.",
    args: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Text description of the video to generate" },
        duration: { type: "number", description: "Duration in seconds (default 5)" },
      },
      required: ["prompt"],
    },
    requiredMode: "WorkspaceWrite",
  },
  async run(args): Promise<ToolResult> {
    const a = args as { prompt?: string; duration?: number };
    if (!a.prompt) return { callId: "video_generate", ok: false, output: null, error: "prompt required" };

    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) {
      return {
        callId: "video_generate", ok: false, output: null,
        error: "REPLICATE_API_TOKEN not set",
      };
    }

    try {
      // Create prediction — model version from env (user must configure)
      const modelVersion = process.env.MYA_REPLICATE_VIDEO_MODEL;
      if (!modelVersion) {
        return {
          callId: "video_generate", ok: false, output: null,
          error: "MYA_REPLICATE_VIDEO_MODEL not set — provide a Replicate model version hash (e.g. 'kyutai/moshi:...')",
        };
      }
      const createRes = await fetch("https://api.replicate.com/v1/predictions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          version: modelVersion,
          input: { prompt: a.prompt, video_length: a.duration ?? 5 },
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!createRes.ok) {
        return { callId: "video_generate", ok: false, output: null, error: `Replicate create ${createRes.status}` };
      }
      const prediction = await createRes.json() as { id: string; urls: { get: string } };

      // Poll for completion (max 5 minutes)
      const deadline = nowWallclock() + 5 * 60_000;
      while (nowWallclock() < deadline) {
        await new Promise((r) => setTimeout(r, 10_000));
        const pollRes = await fetch(prediction.urls.get, {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15_000),
        });
        if (!pollRes.ok) continue;
        const status = await pollRes.json() as { status: string; output?: string; error?: string };
        if (status.status === "succeeded") {
          return { callId: "video_generate", ok: true, output: { url: status.output, backend: "replicate" } };
        }
        if (status.status === "failed") {
          return { callId: "video_generate", ok: false, output: null, error: status.error ?? "generation failed" };
        }
      }
      return { callId: "video_generate", ok: false, output: null, error: "timed out after 5 minutes" };
    } catch (e) {
      return { callId: "video_generate", ok: false, output: null, error: (e as Error).message };
    }
  },
};
