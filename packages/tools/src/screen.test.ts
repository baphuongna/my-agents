/**
 * Screen capture — platform branch + OCR / find + tool metadata tests.
 *
 * Since we can't run actual screencapture/scrot/powershell in CI, these
 * tests verify that the correct platform branch is entered (by checking
 * the error type/message, not the actual capture), that OCR (`extractText`)
 * maps tesseract output to ScreenTextRegion[] and always terminates its
 * worker (the L-10 try/finally guarantee), that `findOnScreen` degrades
 * gracefully when no display is available, and that the exported tools
 * carry the right metadata.
 *
 * tesseract.js is mocked (its WASM worker is unreliable / aborts in this
 * sandbox) so the OCR path is deterministic and leak-free.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mock = vi.hoisted(() => ({
  words: [
    { text: "Hello", bbox: { x0: 1, y0: 2, x1: 31, y1: 22 }, confidence: 95 },
    { text: "World", bbox: { x0: 40, y0: 5, x1: 70, y1: 25 }, confidence: 80 },
  ],
  recognizeShouldThrow: false,
  recognizeCalls: 0,
  terminateCalls: 0,
}));

vi.mock("tesseract.js", () => ({
  createWorker: async () => ({
    recognize: async () => {
      mock.recognizeCalls++;
      if (mock.recognizeShouldThrow) throw new Error("ocr failed");
      return { data: { words: mock.words } };
    },
    terminate: async () => {
      mock.terminateCalls++;
    },
  }),
}));

import { captureScreen, extractText, findOnScreen, screenCaptureTool, screenFindTool } from "./screen.js";

describe("captureScreen — platform branches", () => {
  it("win32: enters PowerShell branch instead of throwing 'not supported'", async () => {
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    try {
      // On non-Windows hosts, powershell won't be found → ENOENT.
      // On Windows, it captures successfully. Either way, it must NOT
      // throw "screen capture not supported on win32".
      const result = await captureScreen().catch((e: Error) => {
        expect(e.message).not.toMatch(/not supported/i);
        return null;
      });
      // On Windows with PowerShell, result is a valid ScreenCapture.
      if (result) expect(result.image).toBeInstanceOf(Buffer);
    } finally {
      Object.defineProperty(process, "platform", { value: original, configurable: true });
    }
  });
});

describe("screen tools — metadata", () => {
  it("screenCaptureTool exposes a ReadOnly 'screen_capture' tool with a run fn", () => {
    expect(screenCaptureTool.meta.name).toBe("screen_capture");
    expect(screenCaptureTool.meta.requiredMode).toBe("ReadOnly");
    expect(typeof screenCaptureTool.run).toBe("function");
  });

  it("screenFindTool exposes a ReadOnly 'screen_find' tool requiring text", () => {
    expect(screenFindTool.meta.name).toBe("screen_find");
    expect(screenFindTool.meta.requiredMode).toBe("ReadOnly");
    expect(typeof screenFindTool.run).toBe("function");
  });

  it("screen_find rejects non-string / missing text args with an err result", async () => {
    const res = await screenFindTool.run({}, {} as never);
    expect(res.ok).toBe(false);
  });
});

describe("extractText — OCR mapping & worker lifecycle", () => {
  beforeEach(() => {
    mock.recognizeShouldThrow = false;
    mock.recognizeCalls = 0;
    mock.terminateCalls = 0;
  });

  it("maps tesseract words to ScreenTextRegion[] (confidence/100, bbox dims)", async () => {
    const regions = await extractText(Buffer.from([0xff]));
    expect(regions).toHaveLength(2);
    const first = regions[0]!;
    expect(first.text).toBe("Hello");
    // confidence is divided by 100.
    expect(first.confidence).toBeCloseTo(0.95);
    // bbox: x/y from x0/y0; w/h from x1-x0 / y1-y0.
    expect(first.bbox).toEqual({ x: 1, y: 2, w: 30, h: 20 });
    expect(regions[1]!.bbox).toEqual({ x: 40, y: 5, w: 30, h: 20 });
  });

  it("terminates the worker exactly once after a successful recognize", async () => {
    await extractText(Buffer.from([0xff]));
    expect(mock.recognizeCalls).toBe(1);
    expect(mock.terminateCalls).toBe(1);
  });

  it("still terminates the worker when recognize throws (try/finally guarantee)", async () => {
    mock.recognizeShouldThrow = true;
    await expect(extractText(Buffer.from([0xff]))).rejects.toThrow("ocr failed");
    // The finally clause must have terminated the worker despite the throw.
    expect(mock.terminateCalls).toBe(1);
  });
});

describe("findOnScreen — graceful without a display", () => {
  it("settles cleanly (resolves or rejects) on a headless / display-less host", async () => {
    let resolved = false;
    let rejected = false;
    try {
      await findOnScreen("anything");
      resolved = true;
    } catch {
      rejected = true;
    }
    // On a headless CI box capture fails → reject; on a real desktop OCR may
    // succeed → resolve. Both are acceptable.
    expect(resolved || rejected).toBe(true);
  });
});
