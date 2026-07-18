import { describe, it, expect, vi } from "vitest";

// ── Mock isolation ─────────────────────────────────────────────────────────
// The /role handler re-scans ~/.mya/roles/ (BUG #5 fix) and persists the active
// role to ~/.mya/agent/current-role (BUG #7 fix). Mock these so the test is
// deterministic and does NOT touch the user's real ~/.mya state.

// Redirect home to a temp dir so persistence writes are harmless.
const { TMP_HOME, mockRoles } = vi.hoisted(() => ({
  TMP_HOME: `/tmp/mya-bridge-role-test-${process.pid}`,
  mockRoles: new Map<string, any>(),
}));
vi.mock("node:os", () => ({ homedir: () => TMP_HOME }));

// Control the role registry without touching disk.
vi.mock("@my-agent/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@my-agent/core")>();
  return {
    ...actual,
    getRolesDir: () => `${TMP_HOME}/.mya/roles`,
    loadRoles: () => ({
      list: () => [...mockRoles.values()],
      getDefault: () => mockRoles.get("default") ?? { name: "default", description: "general" },
      get: (n: string) => mockRoles.get(n),
      has: (n: string) => mockRoles.has(n),
    }),
  };
});

import { createMyaBridge } from "./mya-bridge.js";

function makePi(opts: { full: string[]; onModel?: (m: { id: string }) => void }) {
  const calls: string[][] = [];
  let modelApplied: { id: string } | null = null;
  let roleCmd: { handler: (a: string, c: unknown) => Promise<void> } | null = null;
  const pi = {
    on() {},
    registerTool() {},
    registerShortcut() {},
    registerCommand(name: string, o: { handler: (a: string, c: unknown) => Promise<void> }) {
      if (name === "role") roleCmd = o;
    },
    getActiveTools: () => [...opts.full],
    setActiveTools: (t: string[]) => { calls.push([...t]); },
    async setModel(m: { id: string }) { modelApplied = m; opts.onModel?.(m); return true; },
    modelRegistry: { getAll: () => [{ id: "MiniMax-M3" }] },
  };
  const ctx = { ui: { notify() {} } };
  return { pi, ctx, calls, get roleCmd() { return roleCmd!; }, model: () => modelApplied };
}

describe("/role fixes", () => {
  it("BUG #1: switching reviewer→default RESTORES all tools (reversible)", async () => {
    mockRoles.clear();
    mockRoles.set("default", { name: "default", description: "general" });
    mockRoles.set("reviewer", { name: "reviewer", description: "read-only", toolsAllowed: ["read", "grep", "find", "bash"], modelPrefer: "MiniMax-M3" });

    const full = ["read", "write", "edit", "bash", "grep", "find", "browser_navigate"];
    const s = makePi({ full });
    createMyaBridge({} as never)(s.pi as never);

    // /role reviewer → restricts to read,grep,find,bash (write/edit/browser_navigate dropped)
    await s.roleCmd.handler("reviewer", s.ctx);
    expect(s.calls.at(-1)!.sort()).toEqual(["bash", "find", "grep", "read"]);
    expect(s.calls.at(-1)).not.toContain("write");
    expect(s.calls.at(-1)).not.toContain("browser_navigate");

    // /role default → original full set RESTORED (pre-fix this would stay restricted)
    await s.roleCmd.handler("default", s.ctx);
    expect(s.calls.at(-1)!.sort()).toEqual([...full].sort());
    expect(s.calls.at(-1)).toContain("write");
    expect(s.calls.at(-1)).toContain("edit");

    // model override applied (reviewer has modelPrefer)
    expect(s.model(), "setModel called via pi").not.toBeNull();
    expect(s.model()!.id).toBe("MiniMax-M3");
  });

  it("dead-code fix: pi.setActiveTools IS called (regression guard vs ctx-cast)", async () => {
    mockRoles.clear();
    mockRoles.set("default", { name: "default", description: "g" });
    mockRoles.set("r2", { name: "r2", description: "r", toolsDenied: ["edit"] });

    const s = makePi({ full: ["read", "write", "edit"] });
    createMyaBridge({} as never)(s.pi as never);
    await s.roleCmd.handler("r2", s.ctx);

    // r2 denies edit → [read, write]. Pre-fix this was null (guard on ctx always false).
    expect(s.calls.at(-1)).toEqual(["read", "write"]);
  });

  it("fail-closed: empty filter result still applied (no silent skip)", async () => {
    mockRoles.clear();
    mockRoles.set("default", { name: "default", description: "g" });
    // role whose allowed tools match NOTHING in the active set
    mockRoles.set("ghost", { name: "ghost", description: "x", toolsAllowed: ["nonexistent_tool"] });

    const s = makePi({ full: ["read", "write"] });
    createMyaBridge({} as never)(s.pi as never);
    await s.roleCmd.handler("ghost", s.ctx);

    // filtered is [] → setActiveTools([]) called (fail-closed), not skipped.
    expect(s.calls.at(-1)).toEqual([]);
  });
});
