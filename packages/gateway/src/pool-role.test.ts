/**
 * Gateway pool surface — role-subagent metadata + parent/child nesting.
 *
 * Tests the POST /pool/acquire + GET /pool/tree HTTP handlers against mock
 * callbacks that faithfully replicate the host's (main.ts) SessionMetaStore
 * behaviour: acquire records metadata + parent link; poolStatus surfaces
 * node-level metadata; poolSubagents nests children under their parent.
 *
 * [smoke]/[unit]-ish: spawns a real Gateway on port 0 and hits it over HTTP.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Gateway, type PoolAcquireInput, type PoolSubagentEntry } from "@my-agent/gateway";
import { get as httpGet, request as httpRequest } from "node:http";

function get(port: number, path: string): Promise<{ code: number; body: string }> {
  return new Promise((resolve) => {
    const req = httpGet(`http://127.0.0.1:${port}${path}`, (res) => {
      let b = "";
      res.on("data", (c: Buffer) => (b += c.toString()));
      res.on("end", () => resolve({ code: res.statusCode ?? 0, body: b }));
    });
    req.on("error", () => resolve({ code: 0, body: "" }));
  });
}

function post(port: number, path: string, payload: unknown): Promise<{ code: number; body: string }> {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = httpRequest(
      { host: "127.0.0.1", port, path, method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } },
      (res) => {
        let b = "";
        res.on("data", (c: Buffer) => (b += c.toString()));
        res.on("end", () => resolve({ code: res.statusCode ?? 0, body: b }));
      },
    );
    req.on("error", () => resolve({ code: 0, body: "" }));
    req.write(body);
    req.end();
  });
}

/**
 * A faithful mock of the host wiring: in-memory SessionMeta (role/task/model +
 * parent link), a simple pool-status list, and poolSubagents that nests
 * role-subagent children under their parent.
 */
function mockHost() {
  const meta = new Map<string, Partial<PoolAcquireInput> & { status?: string; summary?: string; keyOutputs?: string[] }>();
  const poolList = new Map<string, { sessionId: string; busy: boolean; messages: number; lastActivity: number }>();

  const poolStatus = () => {
    const out: Array<{ sessionId: string; busy: boolean; messages: number; lastActivity: number; role?: string; task?: string; model?: string; parentSessionId?: string; status?: string; summary?: string; keyOutputs?: string[] }> = [];
    for (const e of poolList.values()) {
      const m = meta.get(e.sessionId);
      out.push({ sessionId: e.sessionId, busy: e.busy, messages: e.messages, lastActivity: e.lastActivity, role: m?.role, task: m?.task, model: m?.model, parentSessionId: m?.parentSessionId, status: m?.status, summary: m?.summary, keyOutputs: m?.keyOutputs });
    }
    return out;
  };
  const poolAcquire = async (input: PoolAcquireInput | string) => {
    const { cwd, role, task, model, parentSessionId } = typeof input === "string" ? ({ cwd: input } as PoolAcquireInput) : input;
    const id = `s-${Math.random().toString(36).slice(2, 8)}`;
    meta.set(id, { cwd, role, task, model, parentSessionId });
    poolList.set(id, { sessionId: id, busy: false, messages: 0, lastActivity: 0 });
    return id;
  };
  const poolSubagents = (sessionId: string): PoolSubagentEntry[] => {
    const out: PoolSubagentEntry[] = [];
    for (const [childId, m] of meta) {
      if (m.parentSessionId === sessionId) {
        out.push({ id: childId, goal: m.task ?? "", status: m.status ?? "idle", depth: 1, role: m.role, task: m.task, model: m.model, parentSessionId: m.parentSessionId });
      }
    }
    return out;
  };
  const poolSessionStatus = (sessionId: string, status: string, summary?: string, keyOutputs?: string[]) => {
    const existing = meta.get(sessionId);
    if (existing) meta.set(sessionId, { ...existing, status, ...(summary !== undefined ? { summary } : {}), ...(keyOutputs !== undefined ? { keyOutputs } : {}) });
  };
  return { poolStatus, poolAcquire, poolSubagents, poolSessionStatus, meta, poolList };
}

describe("[unit] gateway /pool — role-subagent metadata + nesting", () => {
  let port = 0;
  const host = mockHost();
  const gw = new Gateway({
    host: "127.0.0.1",
    port: 0,
    poolStatus: host.poolStatus,
    poolAcquire: host.poolAcquire,
    poolSubagents: host.poolSubagents,
    poolSessionStatus: host.poolSessionStatus,
  });

  beforeAll(async () => {
    const started = await gw.start();
    port = started.port;
  });
  afterAll(async () => { await gw.stop(); });

  it("POST /pool/acquire with full body returns a sessionId", async () => {
    const r = await post(port, "/pool/acquire", { cwd: "/tmp", role: "coder", task: "refactor X", model: "claude-opus", parentSessionId: "main-1" });
    expect(r.code).toBe(200);
    const parsed = JSON.parse(r.body) as { sessionId: string };
    expect(parsed.sessionId).toBeTruthy();
  });

  it("backward compat: POST /pool/acquire with just {cwd} works", async () => {
    const r = await post(port, "/pool/acquire", { cwd: "/tmp" });
    expect(r.code).toBe(200);
    expect((JSON.parse(r.body) as { sessionId: string }).sessionId).toBeTruthy();
  });

  it("POST /pool/acquire rejects a body without cwd", async () => {
    const r = await post(port, "/pool/acquire", { role: "coder" });
    expect(r.code).toBe(400);
  });

  it("GET /pool/tree nests a role-subagent under its parent + carries metadata", async () => {
    // parent session first
    const pr = await post(port, "/pool/acquire", { cwd: "/tmp" });
    const parentId = (JSON.parse(pr.body) as { sessionId: string }).sessionId;
    // role-subagent child
    const cr = await post(port, "/pool/acquire", { cwd: "/tmp", role: "coder", task: "refactor X", model: "claude-opus", parentSessionId: parentId });
    const childId = (JSON.parse(cr.body) as { sessionId: string }).sessionId;

    const r = await get(port, "/pool/tree");
    expect(r.code).toBe(200);
    const tree = JSON.parse(r.body) as Array<{ sessionId: string; role?: string; task?: string; model?: string; parentSessionId?: string; subagents: PoolSubagentEntry[] }>;

    // child node carries its own metadata
    const childNode = tree.find((n) => n.sessionId === childId);
    expect(childNode?.role).toBe("coder");
    expect(childNode?.task).toBe("refactor X");
    expect(childNode?.model).toBe("claude-opus");
    expect(childNode?.parentSessionId).toBe(parentId);

    // parent nests the child under subagents
    const parentNode = tree.find((n) => n.sessionId === parentId);
    const child = parentNode?.subagents.find((s) => s.id === childId);
    expect(child).toBeDefined();
    expect(child?.role).toBe("coder");
    expect(child?.task).toBe("refactor X");
    expect(child?.model).toBe("claude-opus");
    expect(child?.parentSessionId).toBe(parentId);
  });

  it("poolSubagents(parentId) returns children with role/task/model fields", () => {
    // host-side direct check (mirrors what the handler calls)
    const children = host.poolSubagents("main-1");
    expect(children.length).toBeGreaterThan(0);
    const coder = children.find((c) => c.role === "coder");
    expect(coder?.task).toBe("refactor X");
    expect(coder?.model).toBe("claude-opus");
    expect(coder?.parentSessionId).toBe("main-1");
  });

  it("POST /pool/session/:id/status with valid body returns {ok:true}", async () => {
    // Acquire a session first
    const ar = await post(port, "/pool/acquire", { cwd: "/tmp" });
    const sid = (JSON.parse(ar.body) as { sessionId: string }).sessionId;
    const r = await post(port, `/pool/session/${sid}/status`, { status: "working" });
    expect(r.code).toBe(200);
    expect((JSON.parse(r.body) as { ok: boolean }).ok).toBe(true);
    // status is stored in the mock meta
    expect(host.meta.get(sid)?.status).toBe("working");
  });

  it("POST /pool/session/:id/status rejects unknown status value (400)", async () => {
    const ar = await post(port, "/pool/acquire", { cwd: "/tmp" });
    const sid = (JSON.parse(ar.body) as { sessionId: string }).sessionId;
    const r = await post(port, `/pool/session/${sid}/status`, { status: "bogus" });
    expect(r.code).toBe(400);
    expect(JSON.parse(r.body)).toHaveProperty("error");
  });

  it("GET /pool/tree surfaces status after POST /pool/session/:id/status", async () => {
    const ar = await post(port, "/pool/acquire", { cwd: "/tmp", role: "coder", task: "refactor Y", parentSessionId: "main-tree-status" });
    const sid = (JSON.parse(ar.body) as { sessionId: string }).sessionId;
    await post(port, `/pool/session/${sid}/status`, { status: "done" });
    const r = await get(port, "/pool/tree");
    expect(r.code).toBe(200);
    const tree = JSON.parse(r.body) as Array<{ sessionId: string; status?: string; role?: string }>;
    const node = tree.find((n) => n.sessionId === sid);
    expect(node?.status).toBe("done");
    // metadata preserved alongside status
    expect(node?.role).toBe("coder");
  });

  it("POST /pool/session/:id/status on unknown session is accepted by gateway (host decides no-op)", async () => {
    // The gateway does not know which sessions exist — it forwards to the host
    // callback. The mock no-ops for unknown ids, so the gateway returns 200.
    const r = await post(port, "/pool/session/nonexistent/status", { status: "failed" });
    expect(r.code).toBe(200);
    expect((JSON.parse(r.body) as { ok: boolean }).ok).toBe(true);
    // host meta unchanged
    expect(host.meta.get("nonexistent")).toBeUndefined();
  });

  // ── Phase 3: structured task results (summary + keyOutputs) ─────────────

  it("POST /pool/session/:id/status with summary + keyOutputs returns 200 and stores them", async () => {
    const ar = await post(port, "/pool/acquire", { cwd: "/tmp" });
    const sid = (JSON.parse(ar.body) as { sessionId: string }).sessionId;
    const r = await post(port, `/pool/session/${sid}/status`, {
      status: "done",
      summary: "Refactored auth module",
      keyOutputs: ["src/auth.ts", "src/auth.test.ts"],
    });
    expect(r.code).toBe(200);
    expect((JSON.parse(r.body) as { ok: boolean }).ok).toBe(true);
    expect(host.meta.get(sid)?.summary).toBe("Refactored auth module");
    expect(host.meta.get(sid)?.keyOutputs).toEqual(["src/auth.ts", "src/auth.test.ts"]);
  });

  it("GET /pool/tree surfaces summary and keyOutputs for done sessions", async () => {
    const ar = await post(port, "/pool/acquire", { cwd: "/tmp", role: "coder", task: "refactor Z" });
    const sid = (JSON.parse(ar.body) as { sessionId: string }).sessionId;
    await post(port, `/pool/session/${sid}/status`, {
      status: "done",
      summary: "All tests pass",
      keyOutputs: ["file1.ts", "file2.ts"],
    });
    const r = await get(port, "/pool/tree");
    expect(r.code).toBe(200);
    const tree = JSON.parse(r.body) as Array<{ sessionId: string; status?: string; summary?: string; keyOutputs?: string[]; role?: string }>;
    const node = tree.find((n) => n.sessionId === sid);
    expect(node?.status).toBe("done");
    expect(node?.summary).toBe("All tests pass");
    expect(node?.keyOutputs).toEqual(["file1.ts", "file2.ts"]);
    // metadata preserved
    expect(node?.role).toBe("coder");
  });

  it("POST /pool/session/:id/status rejects summary that is not a string (400)", async () => {
    const ar = await post(port, "/pool/acquire", { cwd: "/tmp" });
    const sid = (JSON.parse(ar.body) as { sessionId: string }).sessionId;
    const r = await post(port, `/pool/session/${sid}/status`, {
      status: "done",
      summary: 12345,
    });
    expect(r.code).toBe(400);
    expect(JSON.parse(r.body)).toHaveProperty("error");
  });

  it("POST /pool/session/:id/status rejects keyOutputs that is not an array (400)", async () => {
    const ar = await post(port, "/pool/acquire", { cwd: "/tmp" });
    const sid = (JSON.parse(ar.body) as { sessionId: string }).sessionId;
    const r = await post(port, `/pool/session/${sid}/status`, {
      status: "done",
      keyOutputs: "not-an-array",
    });
    expect(r.code).toBe(400);
    expect(JSON.parse(r.body)).toHaveProperty("error");
  });

  it("POST /pool/session/:id/status rejects keyOutputs array with non-string elements (400)", async () => {
    const ar = await post(port, "/pool/acquire", { cwd: "/tmp" });
    const sid = (JSON.parse(ar.body) as { sessionId: string }).sessionId;
    const r = await post(port, `/pool/session/${sid}/status`, {
      status: "done",
      keyOutputs: ["valid.ts", 42],
    });
    expect(r.code).toBe(400);
    expect(JSON.parse(r.body)).toHaveProperty("error");
  });

  it("backward compat: POST /pool/session/:id/status with just {status} still works", async () => {
    const ar = await post(port, "/pool/acquire", { cwd: "/tmp" });
    const sid = (JSON.parse(ar.body) as { sessionId: string }).sessionId;
    const r = await post(port, `/pool/session/${sid}/status`, { status: "working" });
    expect(r.code).toBe(200);
    expect((JSON.parse(r.body) as { ok: boolean }).ok).toBe(true);
    expect(host.meta.get(sid)?.status).toBe("working");
    expect(host.meta.get(sid)?.summary).toBeUndefined();
    expect(host.meta.get(sid)?.keyOutputs).toBeUndefined();
  });
});
