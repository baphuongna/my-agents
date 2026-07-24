// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { themedFont, themedBody, themedChrome } from "./utils";

describe("[unit] utils — themed font constants", () => {
  it("themedFont is a monospace font class", () => {
    expect(themedFont).toContain("font-mono");
  });

  it("themedBody is sans-serif with normal-case", () => {
    expect(themedBody).toContain("font-sans");
    expect(themedBody).toContain("normal-case");
  });

  it("themedChrome is monospace uppercase with tracking", () => {
    expect(themedChrome).toContain("font-mono");
    expect(themedChrome).toContain("uppercase");
    expect(themedChrome).toContain("tracking-wider");
  });

  it("all three constants are non-empty strings", () => {
    expect(themedFont.length).toBeGreaterThan(0);
    expect(themedBody.length).toBeGreaterThan(0);
    expect(themedChrome.length).toBeGreaterThan(0);
  });
});
