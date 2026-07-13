/**
 * AgentPool tests — Phase 2 multi-agent.
 */
import { describe, it, expect } from "vitest";
import { AgentPool, type AgentSession, type AgentConfig } from "./pool.js";

function makeFactory(): (id: string, cwd?: string, dir?: string) => Promise<AgentSession> {
  return async (_id, _cwd?, _dir?) => ({
    prompt: async () => {},
    subscribe: () => () => {},
    abort: () => {},
    sessionFile: "/tmp/session.jsonl",
  });
}

describe("AgentPool — multi-agent (Phase 2)", () => {
  it("registers named agents", () => {
    const pool = new AgentPool({ createSession: makeFactory() });
    expect(pool.listAgents()).toEqual([]);
    pool.registerAgent({ name: "alice", agentDir: "/tmp/alice" });
    pool.registerAgent({ name: "bob", agentDir: "/tmp/bob" });
    expect(pool.listAgents().length).toBe(2);
    expect(pool.getAgent("alice")?.agentDir).toBe("/tmp/alice");
  });

  it("rejects duplicate agent name", () => {
    const pool = new AgentPool({ createSession: makeFactory() });
    pool.registerAgent({ name: "alice", agentDir: "/tmp" });
    expect(() => pool.registerAgent({ name: "alice", agentDir: "/tmp" })).toThrow();
  });

  it("isolates sessions per agent (same sessionId, different agents)", async () => {
    let factoryCalls = 0;
    const factory = async (id: string, _cwd?: string, dir?: string) => {
      factoryCalls++;
      return {
        prompt: async () => {},
        subscribe: () => () => {},
        abort: () => {},
        sessionFile: `${dir ?? "default"}/${id}.jsonl`,
      };
    };
    const pool = new AgentPool({ createSession: factory });
    pool.registerAgent({ name: "a", agentDir: "/dir/a" });
    pool.registerAgent({ name: "b", agentDir: "/dir/b" });

    await pool.acquire("sid1", "a");
    await pool.acquire("sid1", "b");
    expect(pool.size).toBe(2);  // different agents = different pool keys
    expect(factoryCalls).toBe(2);
  });

  it("factory receives per-agent agentDir", async () => {
    const seen: Array<string | undefined> = [];
    const factory = async (_id, _cwd?, dir?) => {
      seen.push(dir);
      return { prompt: async () => {}, subscribe: () => () => {}, abort: () => {} };
    };
    const pool = new AgentPool({ createSession: factory });
    pool.registerAgent({ name: "x", agentDir: "/agents/x" });

    await pool.acquire("s1", "x");
    expect(seen).toEqual(["/agents/x"]);
  });

  it("per-agent maxSessions (LRU eviction)", async () => {
    const factory = makeFactory();
    const pool = new AgentPool({ createSession: factory });
    pool.registerAgent({ name: "limited", maxSessions: 2 });

    await pool.acquire("s1", "limited");
    await pool.acquire("s2", "limited");
    expect(pool.list("limited").length).toBe(2);
    await pool.acquire("s3", "limited");  // evicts s1
    expect(pool.list("limited").length).toBe(2);
    expect(pool.list("limited").map((e) => e.sessionId)).toContain("s2");
    expect(pool.list("limited").map((e) => e.sessionId)).toContain("s3");
  });

  it("config validation: createSession required", () => {
    expect(() => new AgentPool({ createSession: undefined as unknown as never })).toThrow();
  });

  it("constructor accepts agents array", () => {
    const agents: AgentConfig[] = [
      { name: "a", agentDir: "/a" },
      { name: "b", maxSessions: 4 },
    ];
    const pool = new AgentPool({ createSession: makeFactory(), agents });
    expect(pool.listAgents().length).toBe(2);
  });
});

describe("AgentPool — backward compatible (single agent)", () => {
  it("acquire/list/release work without agent name", async () => {
    const pool = new AgentPool({ createSession: makeFactory() });
    await pool.acquire("s1");
    expect(pool.list().length).toBe(1);
    expect(pool.release("s1")).toBe(true);
    expect(pool.list().length).toBe(0);
  });
});
