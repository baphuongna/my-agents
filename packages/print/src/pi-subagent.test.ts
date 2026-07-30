/**
 * Smoke test for pi-subagent module — verifies the relocated module imports
 * from @earendil-works/pi-coding-agent and exports the expected public API.
 *
 * [smoke]
 */
import { describe, it, expect } from "vitest";
import {
  spawnSubagent,
  trackSubagent,
  listSubagents,
  MAX_SUBAGENT_DEPTH,
  killAllSubagents,
  setSubagentCountListener,
} from "./pi-subagent.js";

describe("[smoke] pi-subagent module", () => {
  it("imports without error", async () => {
    // Re-import to confirm module load is side-effect free.
    const mod = await import("./pi-subagent.js");
    expect(mod).toBeDefined();
  });

  it("exports spawnSubagent as a function", () => {
    expect(typeof spawnSubagent).toBe("function");
  });

  it("exports trackSubagent as a function", () => {
    expect(typeof trackSubagent).toBe("function");
  });

  it("exports listSubagents as a function", () => {
    expect(typeof listSubagents).toBe("function");
  });

  it("exports killAllSubagents as a function", () => {
    expect(typeof killAllSubagents).toBe("function");
  });

  it("exports setSubagentCountListener as a function", () => {
    expect(typeof setSubagentCountListener).toBe("function");
  });

  it("exports MAX_SUBAGENT_DEPTH with value 3", () => {
    expect(MAX_SUBAGENT_DEPTH).toBe(3);
  });
});

describe("[unit] listSubagents on unknown parent", () => {
  it("returns empty array for an untracked parent", () => {
    expect(listSubagents("no-such-parent")).toEqual([]);
  });

  it("killAllSubagents returns 0 for an untracked parent", () => {
    expect(killAllSubagents("no-such-parent")).toBe(0);
  });
});
