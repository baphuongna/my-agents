import { describe, it, expect } from "vitest";
import { ArrayHistory, stubMemory, createSession } from "./session.js";
import type { ProviderProfile } from "./types.js";

describe("[unit] core.session", () => {
  it("ArrayHistory appends and returns entries", () => {
    const h = new ArrayHistory();
    h.append("a");
    h.append("b");
    expect(h.entries()).toEqual(["a", "b"]);
  });

  it("ArrayHistory starts empty", () => {
    expect(new ArrayHistory().entries()).toEqual([]);
  });

  it("stubMemory returns empty snapshot", () => {
    const mem = stubMemory();
    const snap = mem.snapshot();
    expect(snap.entries).toEqual([]);
    expect(snap.generatedDay).toBe(0);
  });

  it("stubMemory query returns []", async () => {
    const mem = stubMemory();
    expect(await mem.query("anything")).toEqual([]);
  });

  it("createSession builds minimal Tier-0 session", () => {
    const profiles: ProviderProfile[] = [{ id: "p1", provider: "test", model: "m1" }];
    const s = createSession({ profiles, userMd: "# Hello" });
    expect(s.profiles).toBe(profiles);
    expect(s.stableTier).toBe("");
    expect(s.ctxFiles).toEqual([]);
    expect(s.userMd).toBe("# Hello");
    expect(s.history).toBeInstanceOf(ArrayHistory);
  });

  it("createSession defaults — empty stableTier/userMd", () => {
    const s = createSession({ profiles: [] });
    expect(s.stableTier).toBe("");
    expect(s.userMd).toBe("");
    expect(s.skillSetDirty).toBe(false);
  });
});
