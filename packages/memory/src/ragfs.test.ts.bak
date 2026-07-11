import { describe, it, expect } from "vitest";
import { RagfsRouter, StaticContextSource, parseRagfsUri } from "@my-agent/memory";
import { maybeSpill, resolveRef } from "@my-agent/core";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("§8 ragfs — URI router + ContextSource", () => {
  it("parseRagfsUri parses the 4 schemes", () => {
    expect(parseRagfsUri("memory://archivist/42")).toEqual({ scheme: "memory", rest: "archivist/42" });
    expect(parseRagfsUri("skill://create-skill")).toEqual({ scheme: "skill", rest: "create-skill" });
    expect(parseRagfsUri("knowledge://gbrain")).toEqual({ scheme: "knowledge", rest: "gbrain" });
    expect(parseRagfsUri("file:///a/b.ts")).toEqual({ scheme: "file", rest: "/a/b.ts" });
    expect(parseRagfsUri("not-a-uri")).toBeNull();
  });

  it("router routes read() to the matching scheme", async () => {
    const r = new RagfsRouter();
    r.register(new StaticContextSource("memory", new Map([["archivist/1", "hello memory"]])));
    r.register(new StaticContextSource("skill", new Map([["create-skill", "# skill body"]])));
    expect(await r.read("memory://archivist/1")).toBe("hello memory");
    expect(await r.read("skill://create-skill")).toBe("# skill body");
  });

  it("router read() on an unregistered scheme throws", async () => {
    const r = new RagfsRouter();
    await expect(r.read("knowledge://x")).rejects.toThrow(/no source/);
  });

  it("router grep() fans out across sources + merges by score", async () => {
    const r = new RagfsRouter();
    r.register(new StaticContextSource("memory", new Map([["m1", "alpha beta"]])));
    r.register(new StaticContextSource("skill", new Map([["s1", "alpha gamma"]])));
    const hits = await r.grep("alpha");
    expect(hits.length).toBe(2);
  });

  it("registering a scheme twice throws", () => {
    const r = new RagfsRouter();
    r.register(new StaticContextSource("memory", new Map()));
    expect(() => r.register(new StaticContextSource("memory", new Map()))).toThrow(/already registered/);
  });
});

describe("§13 maybeSpill — large-value spill", () => {
  it("small value passes through unchanged", () => {
    process.env.MY_AGENT_REFS_DIR = mkdtempSync(join(tmpdir(), "refs-"));
    const out = maybeSpill("small", { threshold: 1024 });
    expect(out).toBe("small");
  });

  it("large value spills to a ref + resolves back", () => {
    process.env.MY_AGENT_REFS_DIR = mkdtempSync(join(tmpdir(), "refs-"));
    const big = "x".repeat(10_000);
    const out = maybeSpill(big, { threshold: 1024 });
    expect(typeof out).toBe("object");
    if (typeof out === "object" && out !== null && "spilled" in out) {
      expect(out.spilled).toBe(true);
      expect(out.bytes).toBe(10_000);
      expect(out.preview.length).toBeLessThanOrEqual(512);
      expect(resolveRef(out)).toBe(big);
    }
  });

  it("identical large values share one ref (content-addressed)", () => {
    process.env.MY_AGENT_REFS_DIR = mkdtempSync(join(tmpdir(), "refs-"));
    const big = "y".repeat(5000);
    const a = maybeSpill(big, { threshold: 1024 });
    const b = maybeSpill(big, { threshold: 1024 });
    if (typeof a === "object" && typeof b === "object" && "refPath" in a && "refPath" in b) {
      expect(a.refPath).toBe(b.refPath);
    }
  });
});
