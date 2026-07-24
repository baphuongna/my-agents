// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, afterEach } from "vitest";
import { applyTheme, clearThemeVars, type Theme } from "./theme";

function makeTheme(name: string, vars: Record<string, string>): Theme {
  return { name, label: name, description: "", vars };
}

afterEach(() => {
  // Reset :root + tracking set between tests.
  clearThemeVars();
  document.documentElement.removeAttribute("data-theme");
});

describe("[unit] theme — clear-before-set", () => {
  it("sets theme A vars on :root", () => {
    applyTheme(makeTheme("a", { "--color-a": "1 2 3" }));
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--color-a")).toBe("1 2 3");
  });

  it("removes vars from theme A that are absent in theme B", () => {
    applyTheme(makeTheme("a", { "--color-a": "1 2 3", "--shared": "0 0 0" }));
    expect(document.documentElement.style.getPropertyValue("--color-a")).toBe("1 2 3");

    // Theme B does NOT define --color-a.
    applyTheme(makeTheme("b", { "--color-b": "4 5 6", "--shared": "9 9 9" }));

    const root = document.documentElement;
    // Stale var removed.
    expect(root.style.getPropertyValue("--color-a")).toBe("");
    // New var applied.
    expect(root.style.getPropertyValue("--color-b")).toBe("4 5 6");
    // Shared var updated (not removed — it's re-applied).
    expect(root.style.getPropertyValue("--shared")).toBe("9 9 9");
  });

  it("sets the data-theme attribute", () => {
    applyTheme(makeTheme("midnight", {}));
    expect(document.documentElement.getAttribute("data-theme")).toBe("midnight");
  });

  it("switching back to A re-applies its vars", () => {
    applyTheme(makeTheme("a", { "--color-a": "1 2 3" }));
    applyTheme(makeTheme("b", { "--color-b": "4 5 6" }));
    expect(document.documentElement.style.getPropertyValue("--color-a")).toBe("");

    applyTheme(makeTheme("a", { "--color-a": "1 2 3" }));
    expect(document.documentElement.style.getPropertyValue("--color-a")).toBe("1 2 3");
    expect(document.documentElement.style.getPropertyValue("--color-b")).toBe("");
  });

  it("clearThemeVars removes all tracked vars", () => {
    applyTheme(makeTheme("a", { "--color-a": "1 2 3", "--color-b": "4 5 6" }));
    expect(document.documentElement.style.getPropertyValue("--color-a")).toBe("1 2 3");

    clearThemeVars();
    expect(document.documentElement.style.getPropertyValue("--color-a")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--color-b")).toBe("");
  });
});
