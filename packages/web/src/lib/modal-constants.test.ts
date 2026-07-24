// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  MODAL_BACKDROP,
  MODAL_PANEL,
  shouldCloseOuterModalOnEscape,
} from "./modal-constants";

describe("[unit] modal-constants", () => {
  it("MODAL_BACKDROP contains fixed positioning and z-index", () => {
    expect(MODAL_BACKDROP).toContain("fixed");
    expect(MODAL_BACKDROP).toContain("inset-0");
    expect(MODAL_BACKDROP).toContain("z-[300]");
    expect(MODAL_BACKDROP).toContain("flex");
    expect(MODAL_BACKDROP).toContain("justify-center");
  });

  it("MODAL_PANEL contains opaque background, border, and shadow", () => {
    expect(MODAL_PANEL).toContain("bg-bg-surface");
    expect(MODAL_PANEL).toContain("border");
    expect(MODAL_PANEL).toContain("shadow-2xl");
    expect(MODAL_PANEL).toContain("rounded-xl");
  });

  it("shouldCloseOuterModalOnEscape returns false when nested picker is open", () => {
    expect(shouldCloseOuterModalOnEscape(true)).toBe(false);
  });

  it("shouldCloseOuterModalOnEscape returns true when nested picker is closed", () => {
    expect(shouldCloseOuterModalOnEscape(false)).toBe(true);
  });
});
