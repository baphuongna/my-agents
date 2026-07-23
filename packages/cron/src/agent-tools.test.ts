/**
 * Tests for makeCronTools (agent-tools.ts) — agent-callable cron management.
 *
 * C6: wraps CronScheduler primitives as ToolImpl. Tools: cron_create, cron_list,
 * cron_delete, cron_run. All agent jobs are prefixed `agent-` and rate-limited
 * to 10.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { CronScheduler } from "./index.js";
import { makeCronTools } from "./agent-tools.js";

describe("makeCronTools", () => {
  let cron: CronScheduler;

  beforeEach(() => {
    // Allow * * * * * for tests (the scheduler refuses every-minute by default).
    process.env.MYA_CRON_ALLOW_HIGH_FREQUENCY = "1";
    cron = new CronScheduler();
  });

  it("returns an array of 4 tools", () => {
    const tools = makeCronTools(cron);
    expect(Array.isArray(tools)).toBe(true);
    expect(tools).toHaveLength(4);
  });

  it("each tool has a meta.name and run function", () => {
    const tools = makeCronTools(cron);
    for (const t of tools) {
      expect(typeof t.meta.name).toBe("string");
      expect(typeof t.run).toBe("function");
    }
  });

  it("tool names are cron_create, cron_list, cron_delete, cron_run", () => {
    const names = makeCronTools(cron).map((t) => t.meta.name);
    expect(names).toContain("cron_create");
    expect(names).toContain("cron_list");
    expect(names).toContain("cron_delete");
    expect(names).toContain("cron_run");
  });

  it("cron_create succeeds and registers a job", async () => {
    const tools = makeCronTools(cron);
    const createTool = tools.find((t) => t.meta.name === "cron_create")!;
    const res = await createTool.run(
      { name: "Daily Report", schedule: "0 9 * * *", prompt: "Summarize today" },
      {} as never,
    );
    expect(res.ok).toBe(true);
    expect(res.callId).toBe("cron_create");
    expect((res.output as { id: string }).id).toMatch(/^agent-/);
    expect(cron.listJobs()).toHaveLength(1);
  });

  it("cron_create fails when required args are missing", async () => {
    const createTool = makeCronTools(cron).find((t) => t.meta.name === "cron_create")!;
    const res = await createTool.run({ name: "x" }, {} as never);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("required");
  });

  it("cron_create enforces the 10-job limit", async () => {
    const createTool = makeCronTools(cron).find((t) => t.meta.name === "cron_create")!;
    for (let i = 0; i < 10; i++) {
      await createTool.run(
        { name: `job${i}`, schedule: "0 9 * * *", prompt: "p" },
        {} as never,
      );
    }
    const res = await createTool.run(
      { name: "job11", schedule: "0 9 * * *", prompt: "p" },
      {} as never,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain("max");
  });

  it("cron_list returns only agent-* jobs", async () => {
    // Register a non-agent job directly
    cron.register({
      id: "system-job", name: "sys", trigger: "cron", schedule: "0 10 * * *",
      deliveryTarget: "_cron", prompt: "p", enabled: true, leaseMs: 5 * 60_000,
    });
    const tools = makeCronTools(cron);
    const createTool = tools.find((t) => t.meta.name === "cron_create")!;
    await createTool.run({ name: "agent-task", schedule: "0 9 * * *", prompt: "p" }, {} as never);

    const listTool = tools.find((t) => t.meta.name === "cron_list")!;
    const res = await listTool.run({}, {} as never);
    expect(res.ok).toBe(true);
    const jobs = (res.output as { jobs: Array<{ id: string }> }).jobs;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.id.startsWith("agent-")).toBe(true);
  });

  it("cron_delete removes an agent job", async () => {
    const tools = makeCronTools(cron);
    const createTool = tools.find((t) => t.meta.name === "cron_create")!;
    const created = await createTool.run(
      { name: "temp", schedule: "0 9 * * *", prompt: "p" },
      {} as never,
    );
    const jobId = (created.output as { id: string }).id;

    const deleteTool = tools.find((t) => t.meta.name === "cron_delete")!;
    const res = await deleteTool.run({ id: jobId }, {} as never);
    expect(res.ok).toBe(true);
    expect(cron.getJob(jobId)).toBeUndefined();
  });

  it("cron_delete refuses non-agent jobs", async () => {
    const deleteTool = makeCronTools(cron).find((t) => t.meta.name === "cron_delete")!;
    const res = await deleteTool.run({ id: "system-job" }, {} as never);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("agent-created");
  });

  it("cron_delete fails without an id", async () => {
    const deleteTool = makeCronTools(cron).find((t) => t.meta.name === "cron_delete")!;
    const res = await deleteTool.run({}, {} as never);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("id required");
  });

  it("cron_run forces a job's nextRunAt to now", async () => {
    const tools = makeCronTools(cron);
    const createTool = tools.find((t) => t.meta.name === "cron_create")!;
    const created = await createTool.run(
      { name: "fire-now", schedule: "0 9 * * *", prompt: "p" },
      {} as never,
    );
    const jobId = (created.output as { id: string }).id;

    const runTool = tools.find((t) => t.meta.name === "cron_run")!;
    const res = await runTool.run({ id: jobId }, {} as never);
    expect(res.ok).toBe(true);
    const job = cron.getJob(jobId);
    expect(job!.nextRunAt).toBeLessThanOrEqual(Date.now());
  });

  it("cron_run fails when the job does not exist", async () => {
    const runTool = makeCronTools(cron).find((t) => t.meta.name === "cron_run")!;
    const res = await runTool.run({ id: "agent-nope" }, {} as never);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("not found");
  });
});
