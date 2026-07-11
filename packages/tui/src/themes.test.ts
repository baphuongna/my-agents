/**
 * Phase 21 tests: 3 themes + persistence.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { themeStore, switchTheme, BUILTIN_THEMES, defaultTheme, type Theme } from "./themes.js";

describe("3 built-in themes", () => {
  it("dark theme has dark background + green user", () => {
    const t = BUILTIN_THEMES["dark"]!;
    expect(t.darkBg).toBe(true);
    expect(t.user).toBe("green");
    expect(t.text).toBe("white");
  });

  it("light theme has light background + black text", () => {
    const t = BUILTIN_THEMES["light"]!;
    expect(t.darkBg).toBe(false);
    expect(t.text).toBe("black");
    expect(t.user).toBe("green");
  });

  it("dim theme is muted (gray on black)", () => {
    const t = BUILTIN_THEMES["dim"]!;
    expect(t.darkBg).toBe(true);
    expect(t.text).toBe("gray");
  });

  it("defaultTheme === BUILTIN_THEMES.dark", () => {
    expect(defaultTheme).toBe(BUILTIN_THEMES["dark"]);
  });
});

describe("themeStore setByName + switchTheme", () => {
  beforeEach(() => {
    themeStore.setActive(BUILTIN_THEMES["dark"]!);
  });

  it("setByName returns null for unknown name", () => {
    expect(themeStore.setByName("fuchsia")).toBeNull();
  });

  it("setByName switches", () => {
    const t = themeStore.setByName("light");
    expect(t).toBe(BUILTIN_THEMES["light"]);
    expect(themeStore.current()).toBe(BUILTIN_THEMES["light"]);
  });

  it("emits 'change' on switch", () => {
    return new Promise<void>((resolve) => {
      themeStore.once("change", (t: Theme) => {
        expect(t.name).toBe("dim");
        resolve();
      });
      themeStore.setByName("dim");
    });
  });
});
