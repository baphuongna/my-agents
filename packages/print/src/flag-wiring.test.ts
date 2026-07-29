/**
 * Flag wiring tests: --role/--task flags flow from argv through filterMyaFlags
 * and extractRoleTask into the bridge options.
 *
 * [unit]
 */
import { describe, it, expect, vi } from "vitest";
import { extractRoleTask, filterMyaFlags } from "./pi-main.js";

describe("[unit] extractRoleTask", () => {
  it("extracts --role and --task values from argv", () => {
    const result = extractRoleTask([
      "mya", "--gateway-session", "abc", "--role", "coder", "--task", "refactor X",
    ]);
    expect(result.role).toBe("coder");
    expect(result.task).toBe("refactor X");
  });

  it("returns undefined when flags are absent", () => {
    const result = extractRoleTask(["mya", "--debug"]);
    expect(result.role).toBeUndefined();
    expect(result.task).toBeUndefined();
  });

  it("extracts only --role when --task is absent", () => {
    const result = extractRoleTask(["mya", "--role", "reviewer"]);
    expect(result.role).toBe("reviewer");
    expect(result.task).toBeUndefined();
  });

  it("extracts only --task when --role is absent", () => {
    const result = extractRoleTask(["mya", "--task", "do something"]);
    expect(result.role).toBeUndefined();
    expect(result.task).toBe("do something");
  });

  it("handles --role as the last arg (no value)", () => {
    const result = extractRoleTask(["mya", "--role"]);
    expect(result.role).toBeUndefined();
  });
});

describe("[unit] filterMyaFlags strips --role/--task from pi args", () => {
  it("removes --role and its value", () => {
    const filtered = filterMyaFlags([
      "--role", "coder", "--model", "gpt-4",
    ]);
    expect(filtered).not.toContain("--role");
    expect(filtered).not.toContain("coder");
    expect(filtered).toContain("--model");
    expect(filtered).toContain("gpt-4");
  });

  it("removes --task and its value", () => {
    const filtered = filterMyaFlags([
      "--task", "refactor X", "--print",
    ]);
    expect(filtered).not.toContain("--task");
    expect(filtered).not.toContain("refactor X");
    expect(filtered).not.toContain("--print");
  });

  it("removes both --role and --task with their values", () => {
    const filtered = filterMyaFlags([
      "mya", "--gateway-session", "s1", "--role", "coder", "--task", "do thing",
    ]);
    expect(filtered).not.toContain("--role");
    expect(filtered).not.toContain("--task");
    expect(filtered).not.toContain("coder");
    expect(filtered).not.toContain("do thing");
    // gateway-session is NOT a mya flag (it's consumed by pi), so it stays
    expect(filtered).toContain("--gateway-session");
    expect(filtered).toContain("s1");
  });

  it("preserves positional args that are not flag values", () => {
    const filtered = filterMyaFlags([
      "hello world", "--role", "coder",
    ]);
    expect(filtered).toContain("hello world");
  });
});
