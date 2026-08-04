import { describe, it, expect, vi } from "vitest";
import type { Brain, Fact } from "../brain.js";
import { EntitiesDomain, entitiesDomain } from "./entities.js";
import { ArchivistDomain, archivistDomain } from "./archivist.js";
import { DiffDomain, diffDomain } from "./diff.js";
import { ConversationsDomain, conversationsDomain } from "./conversations.js";

/** Minimal Brain mock — only the methods the domains call. */
function makeBrain(overrides: Partial<Brain> = {}): Brain {
  return {
    extractFacts: () => [],
    unconsolidatedFacts: () => [],
    purge: () => 0,
    lint: () => ({ empty: [], duplicates: [], noEntity: [] }),
    schemaSuggest: () => [],
    ...overrides,
  } as unknown as Brain;
}

function makeFact(id: string, content: string, source = "manual"): Fact {
  return { id, kind: "fact", entity: "x", content, visibility: "session", notability: 1, source, createdAt: 0 } as unknown as Fact;
}

describe("[unit] memory domains", () => {
  // ── EntitiesDomain ──────────────────────────────────────────────
  describe("EntitiesDomain", () => {
    it("recall without init → []", () => {
      expect(new EntitiesDomain().recall("x")).toEqual([]);
    });

    it("recall extracts + filters atoms by query", () => {
      const d = new EntitiesDomain();
      d.init(makeBrain({ extractFacts: () => [
        { factId: "f1", kind: "url", value: "https://example.com" },
        { factId: "f2", kind: "email", value: "a@b.com" },
      ] }));
      const hits = d.recall("url");
      expect(hits).toHaveLength(1);
      expect(hits[0]!.content).toContain("url:https://example.com");
    });

    it("recall topK limits results", () => {
      const d = new EntitiesDomain();
      d.init(makeBrain({ extractFacts: () => Array.from({ length: 20 }, (_, i) => ({ factId: `f${i}`, kind: "k", value: `v${i}` })) }));
      expect(d.recall("", { topK: 5 })).toHaveLength(5);
    });

    it("onConsolidate returns zero report", () => {
      expect(entitiesDomain.onConsolidate(0)).toEqual({ promoted: 0, consumed: 0 });
    });
  });

  // ── ArchivistDomain ─────────────────────────────────────────────
  describe("ArchivistDomain", () => {
    it("recall without init → []", () => {
      expect(new ArchivistDomain().recall("x")).toEqual([]);
    });

    it("recall filters unconsolidated facts by query", () => {
      const d = new ArchivistDomain();
      d.init(makeBrain({ unconsolidatedFacts: () => [makeFact("f1", "hello world"), makeFact("f2", "goodbye")] }));
      const hits = d.recall("hello");
      expect(hits).toHaveLength(1);
      expect(hits[0]!.content).toBe("hello world");
    });

    it("recall empty query → []", () => {
      const d = new ArchivistDomain();
      d.init(makeBrain({ unconsolidatedFacts: () => [makeFact("f1", "x")] }));
      expect(d.recall("")).toEqual([]);
    });

    it("onConsolidate calls brain.purge", () => {
      const purge = vi.fn(() => 3);
      const d = new ArchivistDomain();
      d.init(makeBrain({ purge }));
      const report = d.onConsolidate(12345);
      expect(purge).toHaveBeenCalledWith(12345);
      expect(report.consumed).toBe(3);
    });

    it("onConsolidate without init → zero report", () => {
      expect(new ArchivistDomain().onConsolidate(0)).toEqual({ promoted: 0, consumed: 0 });
    });
  });

  // ── DiffDomain ──────────────────────────────────────────────────
  describe("DiffDomain", () => {
    it("recall without init → []", () => {
      expect(new DiffDomain().recall("x")).toEqual([]);
    });

    it("recall surfaces schema suggestions + duplicates", () => {
      const d = new DiffDomain();
      d.init(makeBrain({
        schemaSuggest: () => [{ entities: ["Alice", "alice"], reason: "case collision" }],
        lint: () => ({ empty: [], duplicates: [{ ids: ["f1", "f2"], content: "same text" }], noEntity: [] }),
      }));
      const hits = d.recall("");
      expect(hits).toHaveLength(2);
      expect(hits[0]!.content).toContain("entities=Alice,alice");
      expect(hits[1]!.content).toContain("duplicate");
    });

    it("recall filters by query", () => {
      const d = new DiffDomain();
      d.init(makeBrain({
        schemaSuggest: () => [{ entities: ["X"], reason: "r" }],
        lint: () => ({ empty: [], duplicates: [{ ids: ["a", "b"], content: "dup text" }], noEntity: [] }),
      }));
      expect(d.recall("entities")).toHaveLength(1);
      expect(d.recall("duplicate")).toHaveLength(1);
    });

    it("onConsolidate returns zero report", () => {
      expect(diffDomain.onConsolidate(0)).toEqual({ promoted: 0, consumed: 0 });
    });
  });

  // ── ConversationsDomain ─────────────────────────────────────────
  describe("ConversationsDomain", () => {
    it("recall without init → []", () => {
      expect(new ConversationsDomain().recall("x")).toEqual([]);
    });

    it("recall filters backfill-source facts", () => {
      const d = new ConversationsDomain();
      d.init(makeBrain({ unconsolidatedFacts: () => [
        makeFact("f1", "chat about X", "backfill"),
        makeFact("f2", "manual note", "manual"),
      ] }));
      const hits = d.recall("chat");
      expect(hits).toHaveLength(1);
      expect(hits[0]!.id).toBe("f1");
    });

    it("onRecord counts backfill facts", () => {
      const d = new ConversationsDomain();
      d.onRecord(makeFact("f1", "x", "backfill"));
      d.onRecord(makeFact("f2", "y", "backfill"));
      d.onRecord(makeFact("f3", "z", "manual"));
      const report = d.onConsolidate(0);
      expect(report.consumed).toBe(2);
    });

    it("onConsolidate resets counter (L-9 fix)", () => {
      const d = new ConversationsDomain();
      d.onRecord(makeFact("f1", "x", "backfill"));
      d.onConsolidate(0);
      expect(d.onConsolidate(0).consumed).toBe(0);
    });

    it("recall empty query → []", () => {
      const d = new ConversationsDomain();
      d.init(makeBrain({ unconsolidatedFacts: () => [makeFact("f1", "x", "backfill")] }));
      expect(d.recall("")).toEqual([]);
    });
  });
});
