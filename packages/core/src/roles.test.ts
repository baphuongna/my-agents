import { describe, it, expect, afterEach } from "vitest";
import { homedir } from "node:os";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_ROLE,
  getRolesDir,
  filterToolsForRole,
  loadRoles,
} from "@my-agent/core";
import type { RoleConfig, RoleRegistry } from "@my-agent/core";

const TOOLS = ["read", "write", "edit", "bash", "delegate", "search", "skill"];

describe("DEFAULT_ROLE — the hardcoded seed", () => {
  it("is named 'default'", () => {
    expect(DEFAULT_ROLE.name).toBe("default");
  });

  it("has a human-readable description", () => {
    expect(typeof DEFAULT_ROLE.description).toBe("string");
    expect(DEFAULT_ROLE.description.length).toBeGreaterThan(0);
  });

  it("is a valid RoleConfig (name + description present)", () => {
    expect(typeof DEFAULT_ROLE.name).toBe("string");
    expect(typeof DEFAULT_ROLE.description).toBe("string");
  });
});

describe("getRolesDir — config directory resolution", () => {
  it("points at ~/.mya/roles", () => {
    const dir = getRolesDir();
    expect(dir).toBe(join(homedir(), ".mya", "roles"));
  });

  it("ends with the .mya/roles suffix", () => {
    expect(getRolesDir().replace(/\\/g, "/")).toMatch(/\.mya\/roles$/);
  });
});

describe("filterToolsForRole — tool whitelist/blacklist", () => {
  it("returns the full list when role has no tool restrictions", () => {
    const out = filterToolsForRole(TOOLS, DEFAULT_ROLE);
    expect(out).toEqual(TOOLS);
  });

  it("returns a copy (not the same array reference)", () => {
    const out = filterToolsForRole(TOOLS, DEFAULT_ROLE);
    expect(out).not.toBe(TOOLS);
  });

  it("toolsDenied removes only the blacklisted tools", () => {
    const role: RoleConfig = {
      name: "ro",
      description: "d",
      toolsDenied: ["bash", "delegate"],
    };
    expect(filterToolsForRole(TOOLS, role).sort()).toEqual([
      "edit",
      "read",
      "search",
      "skill",
      "write",
    ]);
  });

  it("toolsAllowed keeps only the whitelisted tools", () => {
    const role: RoleConfig = {
      name: "ro",
      description: "d",
      toolsAllowed: ["read", "search"],
    };
    expect(filterToolsForRole(TOOLS, role).sort()).toEqual(["read", "search"]);
  });

  it("deny + allow compose: deny first, then allow filters", () => {
    const role: RoleConfig = {
      name: "ro",
      description: "d",
      toolsDenied: ["bash"],
      toolsAllowed: ["read", "write", "bash"],
    };
    // bash is denied, then allowed-set {read,write,bash} intersected → read,write
    expect(filterToolsForRole(TOOLS, role).sort()).toEqual(["read", "write"]);
  });

  it("empty toolsDenied array is treated as no-op", () => {
    const role: RoleConfig = {
      name: "ro",
      description: "d",
      toolsDenied: [],
    };
    expect(filterToolsForRole(TOOLS, role)).toEqual(TOOLS);
  });

  it("empty toolsAllowed array is treated as no-op (not an empty result)", () => {
    const role: RoleConfig = {
      name: "ro",
      description: "d",
      toolsAllowed: [],
    };
    expect(filterToolsForRole(TOOLS, role)).toEqual(TOOLS);
  });

  it("toolsAllowed for tools not present in the input are simply absent", () => {
    const role: RoleConfig = {
      name: "ro",
      description: "d",
      toolsAllowed: ["read", "nonexistent"],
    };
    expect(filterToolsForRole(TOOLS, role)).toEqual(["read"]);
  });

  it("does not mutate the input array", () => {
    const input = [...TOOLS];
    filterToolsForRole(input, {
      name: "ro",
      description: "d",
      toolsDenied: ["bash"],
    });
    expect(input).toEqual(TOOLS);
  });
});

describe("loadRoles — registry loading from disk", () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function makeDir(): string {
    dir = mkdtempSync(join(tmpdir(), "roles-test-"));
    return dir;
  }

  it("creates the directory + default.json when it does not exist, returning the default registry", () => {
    const fresh = join(tmpdir(), `roles-new-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    dir = fresh;
    const reg = loadRoles(fresh);
    expect(reg.has("default")).toBe(true);
    const def = reg.get("default")!;
    expect(def.name).toBe("default");
    expect(def.description).toBe(DEFAULT_ROLE.description);
  });

  it("loads role files from the directory", () => {
    const d = makeDir();
    writeFileSync(
      join(d, "researcher.json"),
      JSON.stringify({
        name: "researcher",
        description: "research role",
        toolsAllowed: ["read", "search"],
        modelPrefer: "gpt-4o",
      }),
    );
    const reg: RoleRegistry = loadRoles(d);
    expect(reg.has("researcher")).toBe(true);
    const r = reg.get("researcher")!;
    expect(r.toolsAllowed).toEqual(["read", "search"]);
    expect(r.modelPrefer).toBe("gpt-4o");
  });

  it("getDefault() always returns a role (falls back to hardcoded DEFAULT_ROLE)", () => {
    const d = makeDir();
    writeFileSync(
      join(d, "other.json"),
      JSON.stringify({ name: "other", description: "x" }),
    );
    const reg = loadRoles(d);
    // no default.json present → seeded from DEFAULT_ROLE
    expect(reg.getDefault().name).toBe("default");
  });

  it("getDefault() returns a file-defined 'default' when one exists", () => {
    const d = makeDir();
    writeFileSync(
      join(d, "default.json"),
      JSON.stringify({ name: "default", description: "custom default" }),
    );
    const reg = loadRoles(d);
    expect(reg.getDefault().description).toBe("custom default");
  });

  it("list() returns roles sorted alphabetically by name", () => {
    const d = makeDir();
    writeFileSync(join(d, "zeta.json"), JSON.stringify({ name: "zeta", description: "z" }));
    writeFileSync(join(d, "alpha.json"), JSON.stringify({ name: "alpha", description: "a" }));
    const reg = loadRoles(d);
    const names = reg.list().map((r) => r.name);
    // alpha before default before zeta
    expect(names.indexOf("alpha")).toBeLessThan(names.indexOf("default"));
    expect(names.indexOf("default")).toBeLessThan(names.indexOf("zeta"));
  });

  it("skips invalid JSON files (best-effort)", () => {
    const d = makeDir();
    writeFileSync(join(d, "broken.json"), "{ not valid json");
    const reg = loadRoles(d);
    expect(reg.has("broken")).toBe(false);
    expect(reg.has("default")).toBe(true); // seed still present
  });

  it("skips files with an invalid RoleConfig (missing name)", () => {
    const d = makeDir();
    writeFileSync(
      join(d, "noname.json"),
      JSON.stringify({ description: "no name field" }),
    );
    const reg = loadRoles(d);
    expect(reg.has("noname")).toBe(false);
  });

  it("detects name collisions between files and keeps the first (sorted)", () => {
    const d = makeDir();
    // sorted alphabetically: a-first.json loads before b-second.json
    writeFileSync(
      join(d, "a-first.json"),
      JSON.stringify({ name: "dup", description: "first" }),
    );
    writeFileSync(
      join(d, "b-second.json"),
      JSON.stringify({ name: "dup", description: "second" }),
    );
    const reg = loadRoles(d);
    expect(reg.get("dup")!.description).toBe("first");
  });

  it("ignores non-JSON files in the directory", () => {
    const d = makeDir();
    writeFileSync(join(d, "readme.txt"), "ignore me");
    writeFileSync(join(d, "real.json"), JSON.stringify({ name: "real", description: "r" }));
    const reg = loadRoles(d);
    expect(reg.has("real")).toBe(true);
  });
});
