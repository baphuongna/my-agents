import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The cron-cli module reads CRON_FILE at import time via homedir(). We override
 * HOME to a temp dir + vi.resetModules() so each test gets a fresh module with
 * CRON_FILE pointing into the temp tree. */
let dir: string;
let realHome: string | undefined;
let realAllow: string | undefined;
let origFetch: typeof globalThis.fetch;
let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mya-croncli-"));
  realHome = process.env.HOME;
  realAllow = process.env.MYA_CRON_ALLOW_HIGH_FREQUENCY;
  delete process.env.MYA_CRON_ALLOW_HIGH_FREQUENCY;
  process.env.HOME = dir;
  origFetch = globalThis.fetch;
  consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.resetModules();
});

afterEach(() => {
  process.env.HOME = realHome;
  if (realAllow === undefined) delete process.env.MYA_CRON_ALLOW_HIGH_FREQUENCY;
  else process.env.MYA_CRON_ALLOW_HIGH_FREQUENCY = realAllow;
  globalThis.fetch = origFetch;
  vi.restoreAllMocks();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

/** Concatenate all console.log calls into one string. */
function logText(): string {
  return consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
}

/** Build a mock fetch that responds to any URL with the given status + JSON body. */
function mockFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

/** Mock fetch that throws (network error / gateway down). */
function mockFetchDead(): typeof fetch {
  return vi.fn(async () => {
    throw new Error("ECONNREFUSED");
  }) as unknown as typeof fetch;
}

const cronFile = () => join(dir, ".mya", "agent", "cron.json");

describe("cronAdd", () => {
  it("prints usage when called with no args", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch([]);
    await mod.cronAdd();
    expect(logText()).toContain("Usage:");
    expect(logText()).toContain("mya cron add");
  });

  it("prints usage when called with name but no schedule", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch([]);
    await mod.cronAdd("only-name");
    expect(logText()).toContain("Usage:");
  });

  it("refuses '* * * * *' without MYA_CRON_ALLOW_HIGH_FREQUENCY", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch([]);
    await mod.cronAdd("minute", "* * * * *", "test");
    expect(logText()).toContain("Refusing");
    expect(existsSync(cronFile())).toBe(false);
  });

  it("allows '* * * * *' when MYA_CRON_ALLOW_HIGH_FREQUENCY is set", async () => {
    process.env.MYA_CRON_ALLOW_HIGH_FREQUENCY = "1";
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch({});
    await mod.cronAdd("minute", "* * * * *", "test prompt");
    expect(logText()).toContain("Cron job added");
    const jobs = JSON.parse(readFileSync(cronFile(), "utf-8"));
    expect(jobs).toHaveLength(1);
    expect(jobs[0].trigger).toBe("cron");
  });

  it("persists a cron-trigger job to cron.json", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch({});
    await mod.cronAdd("daily", "0 9 * * *", "check status");
    expect(logText()).toContain("✓");
    expect(logText()).toContain("daily");
    const jobs = JSON.parse(readFileSync(cronFile(), "utf-8"));
    expect(jobs).toHaveLength(1);
    expect(jobs[0].name).toBe("daily");
    expect(jobs[0].trigger).toBe("cron");
    expect(jobs[0].schedule).toBe("0 9 * * *");
    expect(jobs[0].enabled).toBe(true);
  });

  it("parses 'every Xm' into on-interval trigger with ms schedule", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch({});
    await mod.cronAdd("interval", "every 5m", "tick");
    const jobs = JSON.parse(readFileSync(cronFile(), "utf-8"));
    expect(jobs[0].trigger).toBe("on-interval");
    expect(jobs[0].schedule).toBe(300_000);
  });

  it("parses 'every Xh' into on-interval trigger", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch({});
    await mod.cronAdd("hourly", "every 1h", "tick");
    const jobs = JSON.parse(readFileSync(cronFile(), "utf-8"));
    expect(jobs[0].trigger).toBe("on-interval");
    expect(jobs[0].schedule).toBe(3_600_000);
  });

  it("parses 'every Xs' into on-interval trigger", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch({});
    await mod.cronAdd("sec", "every 30s", "tick");
    const jobs = JSON.parse(readFileSync(cronFile(), "utf-8"));
    expect(jobs[0].trigger).toBe("on-interval");
    expect(jobs[0].schedule).toBe(30_000);
  });

  it("parses epoch-ms into once trigger", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch({});
    await mod.cronAdd("newyear", "1735689600000", "celebrate");
    const jobs = JSON.parse(readFileSync(cronFile(), "utf-8"));
    expect(jobs[0].trigger).toBe("once");
    expect(jobs[0].schedule).toBe(1735689600000);
  });

  it("generates a unique id with 'cron-' prefix", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch({});
    await mod.cronAdd("a", "every 5m", "p");
    await mod.cronAdd("b", "every 5m", "p");
    const jobs = JSON.parse(readFileSync(cronFile(), "utf-8"));
    expect(jobs).toHaveLength(2);
    expect(jobs[0].id).not.toBe(jobs[1].id);
    expect(jobs[0].id.startsWith("cron-")).toBe(true);
  });

  it("stores optional timezone when provided", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch({});
    await mod.cronAdd("tz", "0 9 * * *", "go", "America/New_York");
    const jobs = JSON.parse(readFileSync(cronFile(), "utf-8"));
    expect(jobs[0].timezone).toBe("America/New_York");
  });

  it("defaults prompt to empty string when undefined", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch({});
    await mod.cronAdd("noprompt", "every 5m");
    const jobs = JSON.parse(readFileSync(cronFile(), "utf-8"));
    expect(jobs[0].prompt).toBe("");
  });

  it("sets deliveryTarget to '_cron'", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch({});
    await mod.cronAdd("dt", "every 5m", "p");
    const jobs = JSON.parse(readFileSync(cronFile(), "utf-8"));
    expect(jobs[0].deliveryTarget).toBe("_cron");
  });

  it("still writes the file when the gateway POST fails", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetchDead();
    await mod.cronAdd("fallback", "every 10m", "p");
    expect(existsSync(cronFile())).toBe(true);
    expect(logText()).toContain("Cron job added");
  });

  it("appends to existing jobs rather than replacing", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch({});
    await mod.cronAdd("first", "every 5m", "p1");
    await mod.cronAdd("second", "every 10m", "p2");
    const jobs = JSON.parse(readFileSync(cronFile(), "utf-8"));
    expect(jobs).toHaveLength(2);
    expect(jobs[0].name).toBe("first");
    expect(jobs[1].name).toBe("second");
  });
});

describe("cronList", () => {
  it("reports 'No cron jobs' when gateway returns empty", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch([]);
    await mod.cronList();
    expect(logText()).toContain("No cron jobs");
  });

  it("reports 'No cron jobs' when gateway is down", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetchDead();
    await mod.cronList();
    expect(logText()).toContain("No cron jobs");
  });

  it("lists jobs returned by the gateway", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch([
      { id: "cron-abc1", name: "daily-check", trigger: "cron", schedule: "0 9 * * *", enabled: true, lastRunAt: 1700000000000, lastStatus: "succeeded" },
      { id: "cron-def2", name: "hourly", trigger: "on-interval", schedule: 3600000, enabled: false },
    ]);
    await mod.cronList();
    const text = logText();
    expect(text).toContain("Cron jobs");
    expect(text).toContain("daily-check");
    expect(text).toContain("hourly");
  });
});

describe("cronRemove", () => {
  it("prints usage when no id given", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch({});
    await mod.cronRemove();
    expect(logText()).toContain("Usage:");
  });

  it("prints not-found when id does not match any job", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch({});
    await mod.cronRemove("nonexistent-id");
    expect(logText()).toContain("not found");
  });

  it("removes a job from cron.json by exact id", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch({});
    // seed the file
    await mod.cronAdd("todelete", "every 5m", "p");
    const jobsBefore = JSON.parse(readFileSync(cronFile(), "utf-8"));
    const id = jobsBefore[0].id;
    await mod.cronRemove(id);
    const jobsAfter = JSON.parse(readFileSync(cronFile(), "utf-8"));
    expect(jobsAfter).toHaveLength(0);
    expect(logText()).toContain("Removed job");
  });

  it("removes a job by name (resolveJobId)", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch({});
    await mod.cronAdd("namedjob", "every 5m", "p");
    await mod.cronRemove("namedjob");
    const jobs = JSON.parse(readFileSync(cronFile(), "utf-8"));
    expect(jobs).toHaveLength(0);
    expect(logText()).toContain("Removed job");
  });

  it("removes a job by id prefix (resolveJobId)", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch({});
    await mod.cronAdd("prefixjob", "every 5m", "p");
    const full = JSON.parse(readFileSync(cronFile(), "utf-8"))[0];
    const prefix = full.id.slice(0, 8);
    await mod.cronRemove(prefix);
    const jobs = JSON.parse(readFileSync(cronFile(), "utf-8"));
    expect(jobs).toHaveLength(0);
  });
});

describe("cronToggle", () => {
  it("prints usage when no id given", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch({});
    await mod.cronToggle();
    expect(logText()).toContain("Usage:");
  });

  it("prints not-found for unknown job", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch({});
    await mod.cronToggle("ghost", "enable");
    expect(logText()).toContain("not found");
  });

  it("toggles enabled state in cron.json (disable)", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch({});
    await mod.cronAdd("toggle", "every 5m", "p");
    const id = JSON.parse(readFileSync(cronFile(), "utf-8"))[0].id;
    await mod.cronToggle(id, "disable");
    const jobs = JSON.parse(readFileSync(cronFile(), "utf-8"));
    expect(jobs[0].enabled).toBe(false);
  });

  it("toggles enabled state in cron.json (enable)", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch({});
    await mod.cronAdd("toggle", "every 5m", "p");
    const id = JSON.parse(readFileSync(cronFile(), "utf-8"))[0].id;
    await mod.cronToggle(id, "disable");
    await mod.cronToggle(id, "enable");
    const jobs = JSON.parse(readFileSync(cronFile(), "utf-8"));
    expect(jobs[0].enabled).toBe(true);
  });
});

describe("cronRun", () => {
  it("prints usage when no id given", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch({});
    await mod.cronRun();
    expect(logText()).toContain("Usage:");
  });

  it("prints not-found for unknown job", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch({});
    await mod.cronRun("ghost");
    expect(logText()).toContain("not found");
  });

  it("reports success when gateway returns 200", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch({});
    await mod.cronAdd("runnable", "every 5m", "p");
    const id = JSON.parse(readFileSync(cronFile(), "utf-8"))[0].id;
    await mod.cronRun(id);
    expect(logText()).toContain("triggered");
  });

  it("reports error when gateway returns non-200", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch({ error: "busy" }, 409);
    await mod.cronAdd("runnable", "every 5m", "p");
    const id = JSON.parse(readFileSync(cronFile(), "utf-8"))[0].id;
    await mod.cronRun(id);
    expect(logText()).toContain("busy");
  });

  it("reports network error when gateway is down", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetchDead();
    await mod.cronAdd("runnable", "every 5m", "p");
    const id = JSON.parse(readFileSync(cronFile(), "utf-8"))[0].id;
    await mod.cronRun(id);
    expect(logText()).toContain("ECONNREFUSED");
  });
});

describe("cronHistory", () => {
  it("prints usage when no id given", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch({});
    await mod.cronHistory();
    expect(logText()).toContain("Usage:");
  });

  it("prints not-found for unknown job", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch({});
    await mod.cronHistory("ghost");
    expect(logText()).toContain("not found");
  });

  it("reports 'No runs recorded' when history is empty", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch([]);
    await mod.cronAdd("history", "every 5m", "p");
    const id = JSON.parse(readFileSync(cronFile(), "utf-8"))[0].id;
    await mod.cronHistory(id);
    expect(logText()).toContain("No runs recorded");
  });

  it("lists runs from the gateway", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch([
      { status: "succeeded", startedAt: 1700000000000, endedAt: 1700000005000 },
      { status: "failed", startedAt: 1700000010000, endedAt: 1700000012000, error: "timeout" },
    ]);
    await mod.cronAdd("history", "every 5m", "p");
    const id = JSON.parse(readFileSync(cronFile(), "utf-8"))[0].id;
    await mod.cronHistory(id);
    const text = logText();
    expect(text).toContain("succeeded");
    expect(text).toContain("failed");
    expect(text).toContain("timeout");
  });
});

describe("cronUpdate", () => {
  it("prints usage when no id or field given", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch({});
    await mod.cronUpdate();
    expect(logText()).toContain("Usage:");
  });

  it("rejects an invalid field name", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetch({});
    await mod.cronAdd("upd", "every 5m", "p");
    const id = JSON.parse(readFileSync(cronFile(), "utf-8"))[0].id;
    await mod.cronUpdate(id, "bogus", "val");
    expect(logText()).toContain("field must be");
  });

  it("sends a patch for a valid field (name)", async () => {
    const mod = await import("./cron-cli.js");
    const fetchMock = mockFetch({});
    globalThis.fetch = fetchMock;
    await mod.cronAdd("upd", "every 5m", "p");
    const id = JSON.parse(readFileSync(cronFile(), "utf-8"))[0].id;
    await mod.cronUpdate(id, "name", "renamed");
    expect(logText()).toContain("Updated");
  });

  it("parses 'enabled' field as boolean", async () => {
    const mod = await import("./cron-cli.js");
    const fetchMock = mockFetch({});
    globalThis.fetch = fetchMock;
    await mod.cronAdd("upd", "every 5m", "p");
    const id = JSON.parse(readFileSync(cronFile(), "utf-8"))[0].id;
    await mod.cronUpdate(id, "enabled", "false");
    expect(logText()).toContain("Updated");
    // Verify the POST body included enabled: false
    const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const patchCall = calls.find((c) => c[1]?.method === "POST" && c[0]?.includes("/patch"));
    expect(patchCall).toBeDefined();
    expect(JSON.parse(patchCall![1].body).enabled).toBe(false);
  });
});

describe("cronStatus", () => {
  it("reports no heartbeat when gateway is not running", async () => {
    const mod = await import("./cron-cli.js");
    globalThis.fetch = mockFetchDead();
    await mod.cronStatus();
    // heartbeat files don't exist in temp HOME → no heartbeat message
    expect(logText()).toContain("No heartbeat");
  });
});
