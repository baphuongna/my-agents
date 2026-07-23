/**
 * Tests for the Markdown memory backend (markdown-backend.ts).
 *
 * Covers: write/read lifecycle, query filtering, missing-file handling,
 * section parsing, durability/external properties, and error handling.
 *
 * Uses temp directories for file-based tests with cleanup in afterEach.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MarkdownBackend } from "@my-agent/memory";

describe("MarkdownBackend", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "md-backend-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("constructs with a role and directory", () => {
    const backend = new MarkdownBackend("archivist", dir);
    expect(backend.role).toBe("archivist");
    expect(backend.durability).toBe("Durable");
    expect(backend.external).toBe(false);
  });

  it("write() creates the markdown file with a header on first write", async () => {
    const backend = new MarkdownBackend("working", dir);
    const result = await backend.write({ role: "working", content: "Test memory content here" });
    expect(result).toEqual({ Durable: true });
    const filePath = join(dir, "working.md");
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf8");
    expect(content).toContain("# working Memory");
    expect(content).toContain("Test memory content here");
  });

  it("write() appends sections for subsequent entries", async () => {
    const backend = new MarkdownBackend("archivist", dir);
    await backend.write({ role: "archivist", content: "First memory entry" });
    await backend.write({ role: "archivist", content: "Second memory entry" });
    const content = readFileSync(join(dir, "archivist.md"), "utf8");
    expect(content).toContain("First memory entry");
    expect(content).toContain("Second memory entry");
  });

  it("write() truncates long titles to 80 chars in the section header", async () => {
    const backend = new MarkdownBackend("working", dir);
    const longContent = "X".repeat(200);
    await backend.write({ role: "working", content: longContent });
    const content = readFileSync(join(dir, "working.md"), "utf8");
    // Header `## <title>` — title is content.slice(0, 80)
    const headerMatch = content.match(/^## (.+)$/m);
    expect(headerMatch).not.toBeNull();
    expect(headerMatch![1]!.length).toBeLessThanOrEqual(80);
  });

  it("write() includes tags in the section footer", async () => {
    const backend = new MarkdownBackend("working", dir);
    await backend.write({
      role: "working",
      content: "Tagged content",
      metadata: {},
      // markdown-backend reads tags via (entry as { tags?: string[] }).tags
      ...( { tags: ["important", "pinned"] } as Record<string, unknown>),
    });
    const content = readFileSync(join(dir, "working.md"), "utf8");
    expect(content).toContain("tags: important, pinned");
  });

  it("read() returns empty array when the file does not exist", async () => {
    const backend = new MarkdownBackend("goals", dir);
    const hits = await backend.read({ text: "anything" });
    expect(hits).toEqual([]);
  });

  it("read() returns all sections when query text is empty", async () => {
    const backend = new MarkdownBackend("working", dir);
    await backend.write({ role: "working", content: "Alpha content section" });
    await backend.write({ role: "working", content: "Beta content section" });
    const hits = await backend.read({ text: "" });
    expect(hits.length).toBe(2);
    for (const h of hits) {
      expect(h.role).toBe("working");
      expect(h.score).toBe(1); // empty query → score 1
    }
  });

  it("read() filters sections by query text (case-insensitive)", async () => {
    const backend = new MarkdownBackend("working", dir);
    await backend.write({ role: "working", content: "TypeScript programming language" });
    await backend.write({ role: "working", content: "Rust memory safety features" });
    const hits = await backend.read({ text: "typescript" });
    expect(hits.length).toBe(1);
    expect(hits[0]!.content.toLowerCase()).toContain("typescript");
  });

  it("read() scores sections by query term frequency", async () => {
    const backend = new MarkdownBackend("working", dir);
    await backend.write({ role: "working", content: "python python python everywhere" });
    await backend.write({ role: "working", content: "python mentioned once" });
    const hits = await backend.read({ text: "python" });
    // Both match, but the one with more "python" occurrences should score higher
    expect(hits.length).toBe(2);
    expect(hits[0]!.score).toBeGreaterThanOrEqual(hits[1]!.score);
  });

  it("read() returns hits sorted by descending score", async () => {
    const backend = new MarkdownBackend("working", dir);
    await backend.write({ role: "working", content: "alpha beta alpha beta alpha" });
    await backend.write({ role: "working", content: "alpha once" });
    const hits = await backend.read({ text: "alpha" });
    expect(hits.length).toBe(2);
    expect(hits[0]!.score).toBeGreaterThanOrEqual(hits[1]!.score);
  });

  it("read() assigns unique ids per section", async () => {
    const backend = new MarkdownBackend("working", dir);
    await backend.write({ role: "working", content: "First unique section" });
    await backend.write({ role: "working", content: "Second unique section" });
    const hits = await backend.read({ text: "" });
    const ids = hits.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toMatch(/^md-working-\d+$/);
  });

  it("read() handles regex-special characters in query safely", async () => {
    const backend = new MarkdownBackend("working", dir);
    await backend.write({ role: "working", content: "price is $100 (USD)" });
    // Query with regex metacharacters — should not throw
    const hits = await backend.read({ text: "$100" });
    expect(hits.length).toBe(1);
  });

  it("write() returns Spilled on error (e.g. unwritable directory)", async () => {
    // Point to a path under a file (not a directory) to force an error
    const backend = new MarkdownBackend("working", "/dev/null/impossible");
    const result = await backend.write({ role: "working", content: "test" });
    expect(result).toHaveProperty("Spilled");
  });
});
