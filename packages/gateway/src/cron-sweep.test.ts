// Shell jobs require MYA_CRON_ALLOW_SHELL=1 (Phase 5 gate).
process.env.MYA_CRON_ALLOW_SHELL = "1";
// Test fixtures use * * * * * (always-due); bypass the every-minute floor.
process.env.MYA_CRON_ALLOW_HIGH_FREQUENCY = "1";
import { describe, it, expect } from "vitest";
import { Gateway } from "@my-agent/gateway";
import { CronScheduler } from "@my-agent/cron";
import type { CronJob } from "@my-agent/cron";

/** A * * * * * job (due every minute — always due at the current minute). */
function dueJob(id: string, prompt = "hi"): CronJob {
  return {
    id, name: id, trigger: "cron", schedule: "* * * * *",
    deliveryTarget: "_cron", prompt, enabled: true, leaseMs: 5 * 60_000,
  };
}

async function sweepWith(onRunOnSession: (s: string, p: string) => Promise<string>): Promise<CronScheduler> {
  const cron = new CronScheduler();
  cron.register(dueJob("j1"));
  // Construct without start() — cronSweep must not require a live HTTP/WS server.
  const gw = new Gateway({
    host: "127.0.0.1", port: 0, cron,
    onRunOnSession: onRunOnSession as never,
  });
  await gw.cronSweep("test-worker");
  return cron;
}

function lastStatus(cron: CronScheduler, id: string): string | undefined {
  const runs = cron.runsOf(id);
  return runs[runs.length - 1]?.status;
}

describe("gateway cron sweep — D2 real-outcome (Phase 1A)", () => {
  it("records 'succeeded' only after the agent turn resolves with text", async () => {
    const cron = await sweepWith(async () => "the result");
    expect(lastStatus(cron, "j1")).toBe("succeeded");
  });

  it("records 'failed' when the runner throws (was silently 'succeeded' — D2)", async () => {
    const cron = await sweepWith(async () => { throw new Error("boom"); });
    expect(lastStatus(cron, "j1")).toBe("failed");
    expect(cron.runsOf("j1").at(-1)?.error).toBe("boom");
  });

  it("records 'failed' on empty response (hermes empty-response soft-fail)", async () => {
    const cron = await sweepWith(async () => "   ");
    expect(lastStatus(cron, "j1")).toBe("failed");
    expect(cron.runsOf("j1").at(-1)?.error).toMatch(/empty response/);
  });

  it("records 'failed' when no runner is wired (not silent 'succeeded')", async () => {
    const cron = new CronScheduler();
    cron.register(dueJob("j1"));
    const gw = new Gateway({ host: "127.0.0.1", port: 0, cron });
    await gw.cronSweep("test-worker");
    expect(lastStatus(cron, "j1")).toBe("failed");
  });

  it("fires each due job on its own _cron:<id> session (per-job isolation)", async () => {
    const seen: string[] = [];
    const cron = new CronScheduler();
    cron.register(dueJob("a"));
    cron.register(dueJob("b"));
    const gw = new Gateway({
      host: "127.0.0.1", port: 0, cron,
      onRunOnSession: (async (sessionId: string) => { seen.push(sessionId); return "ok"; }) as never,
    });
    await gw.cronSweep("test-worker");
    expect(seen.sort()).toEqual(["_cron:a", "_cron:b"]);
  });

  it("Phase 5: a shell job runs via onRunShell (no LLM)", async () => {
    const cron = new CronScheduler();
    cron.register({ ...dueJob("sh"), jobType: "shell", command: "echo hello" } as never);
    let shellCalled = false;
    const gw = new Gateway({
      host: "127.0.0.1", port: 0, cron,
      onRunShell: (async (job: { command?: string; script?: string; workdir?: string }) => {
        shellCalled = true;
        expect(job.command).toBe("echo hello");
        return { ok: true, output: "hello\n" };
      }) as never,
    });
    await gw.cronSweep("test-worker");
    expect(shellCalled).toBe(true);
    expect(lastStatus(cron, "sh")).toBe("succeeded");
  });

  it("Phase 5: a shell job with a non-zero exit → failed", async () => {
    const cron = new CronScheduler();
    cron.register({ ...dueJob("shf"), jobType: "shell", command: "exit 1" } as never);
    const gw = new Gateway({
      host: "127.0.0.1", port: 0, cron,
      onRunShell: (async () => ({ ok: false, output: "", error: "exit 1" })) as never,
    });
    await gw.cronSweep("test-worker");
    expect(lastStatus(cron, "shf")).toBe("failed");
  });

  it("Phase 5: multi-platform delivery — a succeeded job's output is sent to the channel", async () => {
    const cron = new CronScheduler();
    cron.register({ ...dueJob("d"), prompt: "p", deliveryTarget: "channel:test:dest1" } as never);
    const sent: Array<{ id: string; target: string; text: string }> = [];
    // minimal ChannelRegistry stub
    const channels = {
      get: (id: string) => id === "test" ? { send: async (target: string, text: string) => { sent.push({ id, target, text }); return { ok: true }; } } : undefined,
      list: () => [],
    } as never;
    const gw = new Gateway({
      host: "127.0.0.1", port: 0, cron, channels,
      onRunOnSession: (async () => "the daily report") as never,
    });
    await gw.cronSweep("test-worker");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.id).toBe("test");
    expect(sent[0]!.target).toBe("dest1");
    expect(sent[0]!.text).toBe("the daily report");
  });

  it("Phase 5: [SILENT] response is NOT delivered (suppression)", async () => {
    const cron = new CronScheduler();
    cron.register({ ...dueJob("s"), prompt: "p", deliveryTarget: "channel:test:dest" } as never);
    let sent = false;
    const channels = { get: () => ({ send: async () => { sent = true; return { ok: true }; } }), list: () => [] } as never;
    const gw = new Gateway({ host: "127.0.0.1", port: 0, cron, channels, onRunOnSession: (async () => "[SILENT]") as never });
    await gw.cronSweep("test-worker");
    expect(sent).toBe(false); // suppressed
  });

  it("calls cronReload (reconcile) before due — guards the constructor wiring", async () => {
    // Regression guard: cronReload must be ASSIGNED from opts (a prior version
    // declared the field but never assigned it → reconcile was a no-op → CLI
    // file writes never reached the running gateway).
    const cron = new CronScheduler(); // empty — the reload injects the job
    let reloadCalled = false;
    const gw = new Gateway({
      host: "127.0.0.1", port: 0, cron,
      cronReload: () => {
        reloadCalled = true;
        cron.register(dueJob("injected")); // simulate a file-loaded job
      },
      onRunOnSession: (async () => "ok") as never,
    });
    await gw.cronSweep("test-worker");
    expect(reloadCalled).toBe(true);
    expect(lastStatus(cron, "injected")).toBe("succeeded"); // reload's job fired
  });
});
