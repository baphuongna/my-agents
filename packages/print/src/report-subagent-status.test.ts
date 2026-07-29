/**
 * reportSubagentStatus — the spawned role-subagent's task-status reporting
 * trigger (Phase 2 gap-fill). Verifies: no-op for top-level (no sessionId),
 * correct POST body (minimal + full), best-effort (never throws).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { reportSubagentStatus } from "./mya-bridge.js";

vi.mock("./gw-auth.js", () => ({ authHeaders: () => ({ Authorization: "Bearer test" }) }));

describe("[unit] reportSubagentStatus (task-status reporting trigger)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is a no-op when sessionId is undefined (top-level session, not a role-subagent)", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    await reportSubagentStatus(undefined, "working");
    expect(f).not.toHaveBeenCalled();
  });

  it("POSTs {status} (minimal) when sessionId is set, no summary/keyOutputs", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    await reportSubagentStatus("sess-1", "working");
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toContain("/pool/session/sess-1/status");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ status: "working" });
  });

  it("POSTs status + summary + keyOutputs when provided (structured result on done)", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    await reportSubagentStatus("sess-2", "done", "refactored auth module", ["src/auth.ts", "src/auth.test.ts"]);
    const [, init] = f.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      status: "done",
      summary: "refactored auth module",
      keyOutputs: ["src/auth.ts", "src/auth.test.ts"],
    });
  });

  it("never throws when fetch rejects (best-effort — gateway unreachable)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    await expect(reportSubagentStatus("sess-3", "done")).resolves.toBeUndefined();
  });
});
