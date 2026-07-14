/**
 * Screen intelligence (Gap 6): screenshot capture, OCR text extraction,
 * and text-based UI element location.
 *
 * Uses tesseract.js for OCR (pure JS, no native deps). OS screenshot via
 * screencapture (macOS) / scrot (Linux). Windows not supported.
 */
import { spawn } from "node:child_process";
import { readFile, writeFile, unlink, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Mode, ToolResult } from "@my-agent/core";
import { ok, err, isRecord, type ToolImpl } from "./registry.js";
import { nowWallclock } from "@my-agent/core";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ScreenCapture {
  image: Buffer;
  width: number;
  height: number;
  text?: ScreenTextRegion[];
  timestamp: number;
}

export interface ScreenTextRegion {
  text: string;
  bbox: { x: number; y: number; w: number; h: number };
  confidence: number;
}

// ─── Core functions ─────────────────────────────────────────────────────────

/**
 * Capture a screenshot of the primary display.
 * @param opts.ocr - if true, also run OCR and include text regions.
 */
export async function captureScreen(opts?: { ocr?: boolean }): Promise<ScreenCapture> {
  const tmpDir = await mkdtemp(join(tmpdir(), "screen-"));
  const tmpFile = join(tmpDir, "capture.png");
  try {
    const platform = process.platform;
    let width = 0;
    let height = 0;

    if (platform === "darwin") {
      // macOS screencapture
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("screencapture", ["-x", "-o", "-t", "png", tmpFile]);
        proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`screencapture exited ${code}`))));
        proc.on("error", reject);
      });
      // Get dimensions via sips (macOS built‑in)
      const dims = await new Promise<string>((resolve, reject) => {
        const proc = spawn("sips", ["-g", "pixelWidth", "-g", "pixelHeight", tmpFile]);
        let out = "";
        proc.stdout.on("data", (d: Buffer) => (out += d.toString()));
        proc.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`sips exited ${code}`))));
        proc.on("error", reject);
      });
      const wMatch = /pixelWidth:\s+(\d+)/.exec(dims);
      const hMatch = /pixelHeight:\s+(\d+)/.exec(dims);
      width = wMatch ? Number(wMatch[1]) : 0;
      height = hMatch ? Number(hMatch[1]) : 0;
    } else if (platform === "linux") {
      // Linux scrot
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("scrot", ["-o", tmpFile]);
        proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`scrot exited ${code}`))));
        proc.on("error", reject);
      });
      // M-9 fix: get dimensions via file size header (PNG IHDR at offset 16)
      // or `identify` if available
      try {
        const idProc = spawn("identify", ["-format", "%w %h", tmpFile]);
        let idOut = "";
        idProc.stdout.on("data", (d) => (idOut += d));
        await new Promise<void>((res, rej) => {
          idProc.on("close", (c) => (c === 0 ? res() : rej(new Error(`identify ${c}`))));
          idProc.on("error", res); // identify not available — skip dims
        });
        const m = /(\d+)\s+(\d+)/.exec(idOut);
        if (m) { width = Number(m[1]); height = Number(m[2]); }
      } catch { /* identify not available — leave dims as 0 */ }
    } else {
      throw new Error(`screen capture not supported on ${platform}`);
    }

    const image = await readFile(tmpFile);
    const timestamp = nowWallclock();

    const capture: ScreenCapture = { image, width, height, timestamp };

    if (opts?.ocr) {
      capture.text = await extractText(image);
    }

    return capture;
  } finally {
    // L-8 fix: deterministic cleanup (await instead of fire-and-forget)
    await unlink(tmpFile).catch(() => {});
    const { rm } = await import("node:fs/promises");
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Extract text regions from an image buffer using tesseract.js OCR.
 */
export async function extractText(image: Buffer): Promise<ScreenTextRegion[]> {
  const Tesseract = await import("tesseract.js");
  const worker = await Tesseract.createWorker("eng");
  try {
    // L-10 fix: try/finally ensures worker.terminate() even on error
    const { data } = await worker.recognize(image);
    return data.words.map((word) => ({
      text: word.text,
      bbox: {
        x: word.bbox.x0,
        y: word.bbox.y0,
        w: word.bbox.x1 - word.bbox.x0,
        h: word.bbox.y1 - word.bbox.y0,
      },
      confidence: word.confidence / 100,
    }));
  } finally {
    await worker.terminate();
  }
}

/**
 * Capture the screen, run OCR, and return regions that contain the given text.
 */
export async function findOnScreen(text: string): Promise<ScreenTextRegion[]> {
  const capture = await captureScreen({ ocr: true });
  if (!capture.text) return [];
  const lower = text.toLowerCase();
  return capture.text.filter((r) => r.text.toLowerCase().includes(lower));
}

// ─── Tool implementations ───────────────────────────────────────────────────

export const screenCaptureTool: ToolImpl = {
  meta: {
    name: "screen_capture",
    args: {
      type: "object",
      properties: {
        ocr: { type: "boolean", description: "Also run OCR and include text regions" },
      },
    },
    requiredMode: "ReadOnly" as Mode,
  },
  async run(args, _ctx): Promise<ToolResult> {
    if (!isRecord(args)) return err("screen_capture", "invalid args");
    const ocr = typeof args.ocr === "boolean" ? args.ocr : false;
    try {
      const capture = await captureScreen({ ocr });
      return ok("screen_capture", {
        width: capture.width,
        height: capture.height,
        timestamp: capture.timestamp,
        textRegions: capture.text?.length ?? 0,
        imageBase64: capture.image.toString("base64"),
      });
    } catch (e) {
      return err("screen_capture", e instanceof Error ? e.message : String(e));
    }
  },
};

export const screenFindTool: ToolImpl = {
  meta: {
    name: "screen_find",
    args: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to locate on screen" },
      },
      required: ["text"],
    },
    requiredMode: "ReadOnly" as Mode,
  },
  async run(args, _ctx): Promise<ToolResult> {
    if (!isRecord(args) || typeof args.text !== "string")
      return err("screen_find", "text required");
    try {
      const regions = await findOnScreen(args.text);
      return ok("screen_find", { text: args.text, regions, count: regions.length });
    } catch (e) {
      return err("screen_find", e instanceof Error ? e.message : String(e));
    }
  },
};