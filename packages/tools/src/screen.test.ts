/**
 * Screen capture — platform branch tests.
 *
 * Since we can't run actual screencapture/scrot/powershell in CI, these
 * tests verify that the correct platform branch is entered (by checking
 * the error type/message, not the actual capture).
 */
import { describe, it, expect } from "vitest";
import { captureScreen } from "./screen.js";

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
