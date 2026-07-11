import { describe, it, expect } from "vitest";
import { createIsolatedWorkspace } from "@my-agent/subagents";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function setup(): { base: string; parent: string } {
  const base = mkdtempSync(join(tmpdir(), "merge-base-"));
  writeFileSync(join(base, "a.txt"), "base-A");
  writeFileSync(join(base, "b.txt"), "base-B");
  writeFileSync(join(base, "c.txt"), "base-C");
  return { base, parent: mkdtempSync(join(tmpdir(), "merge-parent-")) };
}

describe("§10.2 CoW mergeBack — 3-way merge", () => {
  it("fast-forwards a child-only change (parent unchanged from base)", () => {
    const { base, parent } = setup();
    // parent = copy of base (unchanged)
    writeFileSync(join(parent, "a.txt"), "base-A");
    writeFileSync(join(parent, "b.txt"), "base-B");
    writeFileSync(join(parent, "c.txt"), "base-C");
    const ws = createIsolatedWorkspace(base, { tmpRoot: tmpdir() });
    ws.write("a.txt", "child-changed-A");
    const r = ws.mergeBack(parent);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.merged).toContain("a.txt");
    expect(readFileSync(join(parent, "a.txt"), "utf8")).toBe("child-changed-A");
    ws.cleanup();
  });

  it("keeps parent when child is unchanged from base (parent moved, child idle)", () => {
    const { base, parent } = setup();
    writeFileSync(join(parent, "b.txt"), "parent-moved-B"); // parent changed
    writeFileSync(join(parent, "a.txt"), "base-A");
    writeFileSync(join(parent, "c.txt"), "base-C");
    const ws = createIsolatedWorkspace(base, { tmpRoot: tmpdir() });
    // child did NOT touch b.txt
    ws.write("a.txt", "child-A"); // child changes a (parent didn't) → ff
    const r = ws.mergeBack(parent);
    expect(readFileSync(join(parent, "b.txt"), "utf8")).toBe("parent-moved-B");
    expect(readFileSync(join(parent, "a.txt"), "utf8")).toBe("child-A");
    ws.cleanup();
  });

  it("conflicts when BOTH sides changed the same file differently", () => {
    const { base, parent } = setup();
    writeFileSync(join(parent, "a.txt"), "parent-changed-A"); // parent changed a
    writeFileSync(join(parent, "b.txt"), "base-B");
    writeFileSync(join(parent, "c.txt"), "base-C");
    const ws = createIsolatedWorkspace(base, { tmpRoot: tmpdir() });
    ws.write("a.txt", "child-changed-A"); // child ALSO changed a → conflict
    const r = ws.mergeBack(parent);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.conflicts.length).toBe(1);
      expect(r.conflicts[0]!.path).toBe("a.txt");
    }
    // parent's version is NOT clobbered
    expect(readFileSync(join(parent, "a.txt"), "utf8")).toBe("parent-changed-A");
    ws.cleanup();
  });

  it("adds a new child file to the parent", () => {
    const { base, parent } = setup();
    writeFileSync(join(parent, "a.txt"), "base-A");
    writeFileSync(join(parent, "b.txt"), "base-B");
    writeFileSync(join(parent, "c.txt"), "base-C");
    const ws = createIsolatedWorkspace(base, { tmpRoot: tmpdir() });
    ws.write("new.txt", "brand-new");
    const r = ws.mergeBack(parent);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.added).toContain("new.txt");
    expect(readFileSync(join(parent, "new.txt"), "utf8")).toBe("brand-new");
    ws.cleanup();
  });

  it("contains paths (no escape via ..)", () => {
    const { base, parent } = setup();
    writeFileSync(join(parent, "a.txt"), "base-A");
    writeFileSync(join(parent, "b.txt"), "base-B");
    writeFileSync(join(parent, "c.txt"), "base-C");
    const ws = createIsolatedWorkspace(base, { tmpRoot: tmpdir() });
    expect(() => ws.write("../../escape.txt", "x")).toThrow(/escapes/);
    ws.cleanup();
  });
});
