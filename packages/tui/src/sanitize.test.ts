import { describe, it, expect } from "vitest";
import { sanitize, truncate } from "./sanitize.js";

describe("sanitize (Phase 25 F1+F2 review fix)", () => {
  it("passes plain text through", () => {
    expect(sanitize("hello world")).toBe("hello world");
  });
  it("strips CSI sequences (colors, cursor)", () => {
    expect(sanitize("\x1b[31mred\x1b[0m")).toBe("red");
    expect(sanitize("\x1b[2J\x1b[Hclear")).toBe("clear");
  });
  it("strips OSC sequences (window title, color reset)", () => {
    expect(sanitize("\x1b]0;phish\x07hello")).toBe("hello");
  });
  it("strips bare ESC bytes", () => {
    expect(sanitize("a\x1bb")).toBe("ab");
  });
  it("handles empty", () => {
    expect(sanitize("")).toBe("");
  });
  it("truncate caps at N with ellipsis", () => {
    expect(truncate("abcdef", 3)).toBe("ab…");
    expect(truncate("ab", 3)).toBe("ab");
  });
});
