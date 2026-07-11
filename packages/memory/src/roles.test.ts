import { describe, it, expect } from "vitest";
import {
  MemoryManagerImpl,
  ArchivistRole,
  GoalsRole,
  cleanTurnToMarkdown,
  InMemoryBackend,
} from "@my-agent/memory";
import type { TurnContext } from "@my-agent/core";

describe("§8 archivist — conversation→tree-leaf bridge", () => {
  it("cleanTurnToMarkdown strips tool-call noise + system, keeps user/assistant text", () => {
    const md = cleanTurnToMarkdown([
      { role: "system", content: "you are an agent" },
      { role: "user", content: "fix the bug" },
      { role: "assistant", content: "I'll read the file" },
      { role: "tool", results: [{ callId: "1", ok: true, output: "file contents..." }] },
    ]);
    expect(md).toContain("**user**: fix the bug");
    expect(md).toContain("I'll read the file");
    expect(md).not.toContain("file contents");
    expect(md).not.toContain("you are an agent");
  });

  it("syncTurn appends the cleaned turn as a tree leaf", async () => {
    const store = new InMemoryBackend("tree");
    const arch = new ArchivistRole();
    const ctx = { session: { recentTurn: [{ role: "user", content: "hello" }] } } as unknown as TurnContext;
    await arch.syncTurn(store, ctx);
    const hits = await store.read({ text: "" });
    expect(hits.length).toBe(1);
    expect(hits[0]!.content).toContain("hello");
  });

  it("syncTurn is a no-op when there's no recent turn", async () => {
    const store = new InMemoryBackend("tree");
    const arch = new ArchivistRole();
    await arch.syncTurn(store, {} as TurnContext);
    expect((await store.read({ text: "" })).length).toBe(0);
  });
});

describe("§8 goals role — CRUD + systemPromptBlock", () => {
  it("setGoals + getGoals round-trip", async () => {
    const store = new InMemoryBackend("goals");
    const goals = new GoalsRole();
    await goals.setGoals(store, [
      { text: "ship the agent", status: "active" },
      { text: "write tests", status: "active" },
      { text: "old goal", status: "done" },
    ]);
    const list = await goals.getGoals(store);
    expect(list.length).toBe(3);
  });

  it("systemPromptBlock renders only ACTIVE goals", async () => {
    const store = new InMemoryBackend("goals");
    const goals = new GoalsRole();
    await goals.setGoals(store, [
      { text: "active goal", status: "active" },
      { text: "done goal", status: "done" },
    ]);
    const block = await goals.systemPromptBlock(store);
    expect(block).toContain("## Goals");
    expect(block).toContain("active goal");
    expect(block).not.toContain("done goal");
  });

  it("systemPromptBlock is empty when no active goals", async () => {
    const store = new InMemoryBackend("goals");
    const goals = new GoalsRole();
    await goals.setGoals(store, [{ text: "x", status: "done" }]);
    expect(await goals.systemPromptBlock(store)).toBe("");
  });
});

describe("§8 MemoryManager — roles + one-external-provider rule + drain", () => {
  it("registers roles + exposes backends/roles", () => {
    const m = MemoryManagerImpl.withDefaults();
    m.addRole(new ArchivistRole());
    m.addRole(new GoalsRole());
    expect(m.roles.length).toBe(2);
    expect(m.backends.length).toBeGreaterThan(0);
  });

  it("one-external-provider rule: refuses a 2nd external backend", () => {
    const m = new MemoryManagerImpl();
    m.register(new InMemoryBackend("archivist")); // internal
    const ext1 = new InMemoryBackend("sync", true);
    m.register(ext1);
    const ext2 = new InMemoryBackend("diff", true);
    expect(() => m.register(ext2)).toThrow(/one-external-provider/);
  });

  it("syncAll drives every role's syncTurn (bounded drain)", async () => {
    const m = new MemoryManagerImpl();
    m.register(new InMemoryBackend("archivist"));
    m.addRole(new ArchivistRole());
    const report = await m.syncAll(2);
    expect(report.completed + report.timedOut).toBe(1);
  });
});
