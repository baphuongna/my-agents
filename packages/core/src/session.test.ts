/**
 * Session + History tests — Issue #7 FileHistory (JSONL persistence).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ArrayHistory, FileHistory, createSession } from "./session.js";

describe("ArrayHistory", () => {
  it("appends and reads entries", () => {
    const h = new ArrayHistory();
    h.append({ role: "user", content: "hi" });
    h.append({ role: "assistant", content: "hello" });
    expect(h.entries().length).toBe(2);
  });
});

describe("FileHistory (Issue #7)", () => {
  let tmp: string;
  let path: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "mya-history-"));
    path = join(tmp, "session.jsonl");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("appends to in-memory and writes to disk", () => {
    const h = new FileHistory(path);
    h.append({ role: "user", content: "hi" });
    h.append({ role: "assistant", content: "hello" });
    expect(h.entries().length).toBe(2);
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]!).role).toBe("user");
    expect(JSON.parse(lines[1]!).role).toBe("assistant");
  });

  it("loads from existing file on first access", () => {
    // Pre-populate
    const seed = new FileHistory(path);
    seed.append({ role: "user", content: "before" });

    // New instance reads from disk
    const h = new FileHistory(path);
    expect(h.entries().length).toBe(1);
    expect(h.entries()[0]).toEqual({ role: "user", content: "before" });
  });

  it("appends to existing file (not overwrite)", () => {
    const a = new FileHistory(path);
    a.append({ role: "user", content: "first" });
    const b = new FileHistory(path);
    b.append({ role: "user", content: "second" });
    expect(b.entries().length).toBe(2);
  });

  it("survives restart: new instance sees prior writes", () => {
    const a = new FileHistory(path);
    a.append({ role: "user", content: "msg1" });
    a.append({ role: "assistant", content: "reply1" });
    // New instance simulates process restart
    const b = new FileHistory(path);
    b.append({ role: "user", content: "msg2" });
    expect(b.entries().length).toBe(3);
    expect((b.entries()[2] as { content: string }).content).toBe("msg2");
  });

  it("handles missing file gracefully", () => {
    const h = new FileHistory(join(tmp, "nonexistent.jsonl"));
    h.append({ role: "user", content: "first" });
    expect(h.entries().length).toBe(1);
  });

  it("creates parent directories", () => {
    const nested = join(tmp, "a", "b", "c", "session.jsonl");
    const h = new FileHistory(nested);
    h.append({ role: "user", content: "deep" });
    expect(existsSync(nested)).toBe(true);
  });
});

describe("createSession (Issue #7)", () => {
  it("uses ArrayHistory by default", () => {
    const s = createSession({ profiles: [] });
    expect(s.history.constructor.name).toBe("ArrayHistory");
  });

  it("uses FileHistory when historyPath provided", () => {
    const tmp = mkdtempSync(join(tmpdir(), "mya-session-"));
    try {
      const path = join(tmp, "history.jsonl");
      const s = createSession({ profiles: [], historyPath: path });
      expect(s.history.constructor.name).toBe("FileHistory");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
