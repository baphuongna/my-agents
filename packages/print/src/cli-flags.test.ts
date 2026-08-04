import { describe, it, expect } from "vitest";
import { FLAGS_WITH_VALUE, extractPositional } from "./cli-flags.js";

describe("[unit] cli-flags", () => {
  it("FLAGS_WITH_VALUE contains known flags", () => {
    expect(FLAGS_WITH_VALUE.has("--port")).toBe(true);
    expect(FLAGS_WITH_VALUE.has("--model")).toBe(true);
    expect(FLAGS_WITH_VALUE.has("--provider")).toBe(true);
    expect(FLAGS_WITH_VALUE.has("--role")).toBe(true);
    expect(FLAGS_WITH_VALUE.has("--task")).toBe(true);
  });

  it("extractPositional: plain args only", () => {
    expect(extractPositional(["hello", "world"])).toEqual(["hello", "world"]);
  });

  it("extractPositional: excludes flags (start with --)", () => {
    expect(extractPositional(["--verbose", "hello"])).toEqual(["hello"]);
  });

  it("extractPositional: excludes flag values (--model X)", () => {
    expect(extractPositional(["--model", "gpt4", "hello"])).toEqual(["hello"]);
  });

  it("extractPositional: --provider value excluded (critical — no leak into prompt)", () => {
    expect(extractPositional(["--provider", "minimax", "hello"])).toEqual(["hello"]);
  });

  it("extractPositional: model special-case exclusion", () => {
    expect(extractPositional(["minimax-model", "hello"], "minimax-model"))
      .toEqual(["hello"]);
  });

  it("extractPositional: empty args → []", () => {
    expect(extractPositional([])).toEqual([]);
  });

  it("extractPositional: all flags → []", () => {
    expect(extractPositional(["--verbose", "--debug"])).toEqual([]);
  });

  it("extractPositional: multiple positionals preserved", () => {
    expect(extractPositional(["hello", "world", "--flag", "foo"]))
      .toEqual(["hello", "world", "foo"]);
  });
});
