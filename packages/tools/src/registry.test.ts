/**
 * registry.ts tests — ToolRegistry registration/lookup/alias + helpers.
 *
 * Covers: register (incl. duplicate throw), get, list, resolve, declareAlias /
 * declareAliases, plus the ok / err / isRecord / modeSatisfies helpers.
 */
import { describe, it, expect } from "vitest";
import { ToolRegistry, ok, err, isRecord, modeSatisfies, type ToolImpl } from "./registry.js";
import type { Tool, ToolResult, TurnContext } from "@my-agent/core";

function fakeTool(name: string, requiredMode: Tool["requiredMode"] = "ReadOnly"): ToolImpl {
  return {
    meta: { name, args: { type: "object" }, requiredMode },
    run: async (): Promise<ToolResult> => ok("c", "ok"),
  };
}

describe("ToolRegistry: register / get / list", () => {
  it("registers and retrieves a tool by name", () => {
    const reg = new ToolRegistry();
    const t = fakeTool("read");
    reg.register(t);
    expect(reg.get("read")).toBe(t);
  });

  it("get returns undefined for an unregistered name", () => {
    const reg = new ToolRegistry();
    expect(reg.get("nope")).toBeUndefined();
  });

  it("throws on duplicate registration of the same name", () => {
    const reg = new ToolRegistry();
    reg.register(fakeTool("read"));
    expect(() => reg.register(fakeTool("read"))).toThrow(/already registered/);
  });

  it("list returns the metadata of all registered tools", () => {
    const reg = new ToolRegistry();
    reg.register(fakeTool("read"));
    reg.register(fakeTool("write", "WorkspaceWrite"));
    const metas = reg.list();
    expect(metas).toHaveLength(2);
    const names = metas.map((m) => m.name);
    expect(names).toContain("read");
    expect(names).toContain("write");
  });

  it("list returns an empty array for a fresh registry", () => {
    expect(new ToolRegistry().list()).toEqual([]);
  });
});

describe("ToolRegistry: alias resolution (§6 R27-14)", () => {
  it("declareAlias maps a raw name to its target", () => {
    const reg = new ToolRegistry();
    reg.declareAlias("search_web", "web_search");
    expect(reg.resolve("search_web")).toBe("web_search");
  });

  it("resolve is pure + deterministic (identical input → identical output)", () => {
    const reg = new ToolRegistry();
    reg.declareAlias("a", "b");
    expect(reg.resolve("a")).toBe("b");
    expect(reg.resolve("a")).toBe("b");
  });

  it("resolve passes through unknown names unchanged", () => {
    const reg = new ToolRegistry();
    expect(reg.resolve("unknown")).toBe("unknown");
  });

  it("declareAliases accepts a Record map at once", () => {
    const reg = new ToolRegistry();
    reg.declareAliases({ fs_read: "read", fs_write: "write" });
    expect(reg.resolve("fs_read")).toBe("read");
    expect(reg.resolve("fs_write")).toBe("write");
  });

  it("a later declareAlias overwrites an earlier mapping for the same key", () => {
    const reg = new ToolRegistry();
    reg.declareAlias("x", "first");
    reg.declareAlias("x", "second");
    expect(reg.resolve("x")).toBe("second");
  });
});

describe("registry helpers: ok / err", () => {
  it("ok builds a successful ToolResult", () => {
    const r = ok("c1", { hello: "world" });
    expect(r.ok).toBe(true);
    expect(r.callId).toBe("c1");
    expect(r.output).toEqual({ hello: "world" });
    expect(r.error).toBeUndefined();
  });

  it("err builds a failed ToolResult with null output", () => {
    const r = err("c2", "boom");
    expect(r.ok).toBe(false);
    expect(r.callId).toBe("c2");
    expect(r.output).toBeNull();
    expect(r.error).toBe("boom");
  });
});

describe("registry helpers: isRecord", () => {
  it("accepts plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });
  it("rejects null, arrays, and primitives", () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord([1, 2])).toBe(false);
    expect(isRecord("str")).toBe(false);
    expect(isRecord(42)).toBe(false);
  });
});

describe("registry helpers: modeSatisfies", () => {
  it("Allow mode satisfies any required mode", () => {
    for (const req of ["ReadOnly", "WorkspaceWrite", "Prompt", "Allow"] as const) {
      expect(modeSatisfies("Allow", req)).toBe(true);
    }
  });
  it("DangerFullAccess satisfies any required mode", () => {
    expect(modeSatisfies("DangerFullAccess", "WorkspaceWrite")).toBe(true);
  });
  it("active === required is satisfied", () => {
    expect(modeSatisfies("WorkspaceWrite", "WorkspaceWrite")).toBe(true);
    expect(modeSatisfies("ReadOnly", "ReadOnly")).toBe(true);
  });
  it("WorkspaceWrite satisfies ReadOnly (rank ordering)", () => {
    expect(modeSatisfies("WorkspaceWrite", "ReadOnly")).toBe(true);
  });
  it("ReadOnly does NOT satisfy WorkspaceWrite", () => {
    expect(modeSatisfies("ReadOnly", "WorkspaceWrite")).toBe(false);
  });
  it("Prompt does NOT satisfy WorkspaceWrite", () => {
    expect(modeSatisfies("Prompt", "WorkspaceWrite")).toBe(false);
  });
});
