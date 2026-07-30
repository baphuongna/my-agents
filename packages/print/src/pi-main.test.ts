/**
 * Smoke test for pi-main.ts — verifies the module loads with the npm
 * `@earendil-works/pi-coding-agent` / `@earendil-works/pi-ai/compat` imports
 * and that the exported pure helpers behave correctly.
 *
 * [smoke]
 */
import { describe, it, expect } from "vitest";
import { filterMyaFlags, extractRoleTask } from "./pi-main.js";

describe("[smoke] pi-main module loads with npm imports", () => {
  it("exports filterMyaFlags as a function", () => {
    expect(typeof filterMyaFlags).toBe("function");
  });

  it("exports extractRoleTask as a function", () => {
    expect(typeof extractRoleTask).toBe("function");
  });
});

describe("[unit] filterMyaFlags basic behavior", () => {
  it("strips --role and its value, preserves other flags", () => {
    const filtered = filterMyaFlags(["--role", "coder", "--model", "gpt-4"]);
    expect(filtered).toEqual(["--model", "gpt-4"]);
  });

  it("passes through args when no mya flags present", () => {
    const filtered = filterMyaFlags(["--model", "gpt-4", "--verbose"]);
    expect(filtered).toEqual(["--model", "gpt-4", "--verbose"]);
  });
});

describe("[unit] extractRoleTask basic behavior", () => {
  it("extracts --role and --task values", () => {
    const result = extractRoleTask(["mya", "--role", "coder", "--task", "refactor X"]);
    expect(result).toEqual({ role: "coder", task: "refactor X" });
  });

  it("returns undefined when flags absent", () => {
    const result = extractRoleTask(["mya", "--debug"]);
    expect(result).toEqual({ role: undefined, task: undefined });
  });
});
