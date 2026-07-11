/**
 * Phase 14 tests: §9 SkillCurator + SkillProvenance enum.
 */
import { describe, it, expect } from "vitest";
import { SkillStore, curate, parseSkillMarkdown } from "./index.js";

const SKILL_MD = (name: string) =>
  `---\nname: ${name}\ndescription: test skill\ntriggers: [test]\n---\n\nBody.`;

describe("SkillProvenance enum", () => {
  it("defaults to Bundled", () => {
    const s = parseSkillMarkdown(SKILL_MD("a"), "/skills/a/SKILL.md");
    expect(s.provenance.kind).toBe("Bundled");
  });
  it("accepts explicit kind", () => {
    const s = parseSkillMarkdown(SKILL_MD("b"), "/skills/b/SKILL.md", "AgentCreated");
    expect(s.provenance.kind).toBe("AgentCreated");
  });
  it("accepts HubInstalled + UserCreated", () => {
    expect(parseSkillMarkdown(SKILL_MD("c"), "/c", "HubInstalled").provenance.kind).toBe("HubInstalled");
    expect(parseSkillMarkdown(SKILL_MD("d"), "/d", "UserCreated").provenance.kind).toBe("UserCreated");
  });
});

describe("SkillCurator", () => {
  function storeWith(kind: "Bundled" | "AgentCreated" | "HubInstalled" | "UserCreated", ageDays = 0): SkillStore {
    const store = new SkillStore();
    const skill = parseSkillMarkdown(SKILL_MD("test"), "/test", kind);
    // Override loadedAt to simulate age.
    const old = Date.now() - ageDays * 24 * 60 * 60 * 1000;
    store.add({ ...skill, provenance: { ...skill.provenance, loadedAt: old } });
    return store;
  }

  it("archives inactive AgentCreated skills (archive-not-delete)", async () => {
    const dir = `/tmp/mya-test-curator-${Date.now()}`;
    const store = storeWith("AgentCreated", 60); // 60 days old → inactive
    const actions = await curate(store, { inactiveAfterDays: 30, archiveDir: dir, now: Date.now() });
    expect(actions).toHaveLength(1);
    expect(actions[0]!.action).toBe("archived");
    expect(store.size()).toBe(0); // removed from store
  });

  it("keeps active skills (< inactiveAfterDays)", async () => {
    const store = storeWith("AgentCreated", 5); // 5 days old → active
    const actions = await curate(store, { inactiveAfterDays: 30, now: Date.now() });
    expect(actions[0]!.action).toBe("kept");
    expect(store.size()).toBe(1);
  });

  it("HubInstalled is off-limits even when inactive", async () => {
    const store = storeWith("HubInstalled", 60);
    const actions = await curate(store, { inactiveAfterDays: 30, now: Date.now() });
    expect(actions[0]!.action).toBe("kept");
    expect(actions[0]!.reason).toContain("off-limits");
    expect(store.size()).toBe(1);
  });

  it("UserCreated is never auto-pruned", async () => {
    const store = storeWith("UserCreated", 60);
    const actions = await curate(store, { inactiveAfterDays: 30, now: Date.now() });
    expect(actions[0]!.action).toBe("kept");
    expect(store.size()).toBe(1);
  });

  it("Bundled pruned only when pruneBuiltins is on", async () => {
    const storeOn = storeWith("Bundled", 60);
    const on = await curate(storeOn, { inactiveAfterDays: 30, pruneBuiltins: true, now: Date.now() });
    expect(on[0]!.action).toBe("pruned");
    expect(storeOn.size()).toBe(0);

    const storeOff = storeWith("Bundled", 60);
    const off = await curate(storeOff, { inactiveAfterDays: 30, pruneBuiltins: false, now: Date.now() });
    expect(off[0]!.action).toBe("kept");
    expect(storeOff.size()).toBe(1);
  });

  it("pinned skills bypass all auto-transitions", async () => {
    const store = storeWith("AgentCreated", 60);
    store.pin("test");
    const actions = await curate(store, { inactiveAfterDays: 30, now: Date.now() });
    expect(actions[0]!.action).toBe("pinned-bypass");
    expect(store.size()).toBe(1);
  });
});
