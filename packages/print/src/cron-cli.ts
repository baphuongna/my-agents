/**
 * mya cron — CLI for cron job management.
 *
 * Usage:
 *   mya cron list                    # List all jobs
 *   mya cron add <name> <schedule>    # Add a new job (cron expr or "every Xm" or epoch ms)
 *   mya cron remove <id>             # Remove a job
 *   mya cron enable <id> | disable   # Toggle enabled
 *   mya cron run <id>                # Run now
 *   mya cron history <id>            # Show run history
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { nowWallclock } from "@my-agent/core";

const GW_PORT = parseInt(process.env["MYA_PORT"] ?? "3000", 10);

const A = {
  bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
  green: (s: string) => `\x1b[38;2;143;187;122m${s}\x1b[39m`,
  red: (s: string) => `\x1b[38;2;201;79;79m${s}\x1b[39m`,
  yellow: (s: string) => `\x1b[38;2;210;153;34m${s}\x1b[39m`,
  muted: (s: string) => `\x1b[38;2;130;130;140m${s}\x1b[39m`,
  dim2: (s: string) => `\x1b[38;2;100;100;110m${s}\x1b[39m`,
  accent: (s: string) => `\x1b[38;2;138;190;183m${s}\x1b[39m`,
};

interface CronJob {
  id: string;
  name: string;
  trigger: "cron" | "on-interval" | "once";
  schedule: string | number;
  prompt: string;
  deliveryTarget: string;
  enabled: boolean;
  timezone?: string;
  lastRunAt?: number;
  nextRunAt?: number;
  lastStatus?: string;
  lastError?: string;
}

async function fetchJobs(): Promise<CronJob[]> {
  try {
    const r = await fetch(`http://127.0.0.1:${GW_PORT}/cron/jobs`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return [];
    return (await r.json()) as CronJob[];
  } catch { return []; }
}

function fmtTime(ts?: number): string {
  if (!ts) return "-";
  const d = new Date(ts);
  return d.toISOString().replace("T", " ").slice(0, 19) + "Z";
}

function parseSchedule(s: string): { trigger: "cron" | "on-interval" | "once"; schedule: string | number } {
  // "every Xm|Xh|Xs" → on-interval
  const everyMatch = s.match(/^every\s+(\d+)([smhd])$/i);
  if (everyMatch) {
    const n = Number(everyMatch[1]);
    const unit = everyMatch[2]!.toLowerCase();
    const ms = unit === "s" ? n * 1000 : unit === "m" ? n * 60_000 : unit === "h" ? n * 3_600_000 : n * 86_400_000;
    return { trigger: "on-interval", schedule: ms };
  }
  // epoch ms (number-like) → once
  if (/^\d{10,13}$/.test(s)) {
    return { trigger: "once", schedule: Number(s) };
  }
  // default: cron expression
  return { trigger: "cron", schedule: s };
}

export async function cronList(): Promise<void> {
  const jobs = await fetchJobs();
  if (jobs.length === 0) {
    console.log(`${A.muted("No cron jobs. Add one with:")} ${A.accent("mya cron add <name> <schedule> <prompt>")}`);
    return;
  }
  console.log(`${A.bold("Cron jobs")} (${jobs.length})`);
  console.log("");
  console.log(`  ${A.muted("ID".padEnd(20))} ${"NAME".padEnd(20)} ${"TRIGGER".padEnd(12)} ${"SCHEDULE".padEnd(20)} ${"STATUS".padEnd(12)} ${"LAST RUN"}`);
  console.log(`  ${A.muted("─".repeat(110))}`);
  for (const j of jobs) {
    const statusIcon = j.enabled ? A.green("● enabled") : A.dim2("○ disabled");
    const lastStatus = j.lastStatus
      ? j.lastStatus === "succeeded" ? A.green("succeeded")
      : j.lastStatus === "failed" ? A.red("failed")
      : j.lastStatus === "lease-expired" ? A.yellow("expired")
      : A.muted(j.lastStatus)
      : A.muted("-");
    const scheduleStr = j.trigger === "on-interval" ? `${(j.schedule as number / 1000)}s` : String(j.schedule);
    console.log(`  ${j.id.slice(0, 18).padEnd(20)} ${j.name.slice(0, 18).padEnd(20)} ${j.trigger.padEnd(12)} ${scheduleStr.slice(0, 18).padEnd(20)} ${statusIcon.padEnd(20)} ${fmtTime(j.lastRunAt)}`);
  }
}

export async function cronAdd(name?: string, schedule?: string, prompt?: string): Promise<void> {
  if (!name || !schedule) {
    console.log(`${A.bold("Usage:")} mya cron add <name> <schedule> [prompt]`);
    console.log("");
    console.log(`${A.bold("Schedules:")}`);
    console.log(`  ${A.accent("* * * * *")}            ${A.muted("cron expression (5 fields, UTC)")}`);
    console.log(`  ${A.accent("every 5m")}             ${A.muted("every 5 minutes (s|m|h|d)")}`);
    console.log(`  ${A.accent("every 1h")}             ${A.muted("every hour")}`);
    console.log(`  ${A.accent("1735689600000")}        ${A.muted("once at epoch ms (10-13 digits)")}`);
    console.log("");
    console.log(`${A.bold("Examples:")}`);
    console.log(`  mya cron add daily-check "0 9 * * *" "Check git status and report"`);
    console.log(`  mya cron add reminder "every 30m" "Show pending tasks"`);
    console.log(`  mya cron add newyear 1735689600000 "Happy new year!"`);
    return;
  }
  const { trigger, schedule: schedValue } = parseSchedule(schedule);
  const id = `cron-${nowWallclock().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  // Persist to cron.json
  const cronFile = join(homedir(), ".mya", "agent", "cron.json");
  const arr: Array<{ id: string; name: string; trigger: "cron" | "on-interval" | "once"; schedule: string | number; prompt: string; enabled: boolean; deliveryTarget: string }> = existsSync(cronFile)
    ? (JSON.parse(readFileSync(cronFile, "utf-8")) as Array<{ id: string; name: string; trigger: "cron" | "on-interval" | "once"; schedule: string | number; prompt: string; enabled: boolean; deliveryTarget: string }>)
    : [];
  arr.push({ id, name, trigger, schedule: schedValue, prompt: prompt ?? "", enabled: true, deliveryTarget: "_cron" });
  writeFileSync(cronFile, JSON.stringify(arr, null, 2));

  console.log(`${A.green("✓")} Cron job added:`);
  console.log(`  ID:       ${id}`);
  console.log(`  Name:     ${name}`);
  console.log(`  Trigger:  ${trigger}`);
  console.log(`  Schedule: ${schedule}`);
  console.log(`  Prompt:   ${prompt ?? "(none)"}`);
  console.log("");
  console.log(`${A.muted("Saved to:")} ${cronFile}`);
  console.log(`${A.muted("Restart gateway:")} ${A.accent("mya serve")} ${A.muted("or wait for next sweep (30s)")}`);
}

export async function cronRemove(id?: string): Promise<void> {
  if (!id) {
    console.log(`${A.red("Usage:")} mya cron remove <id>`);
    return;
  }
  const cronFile = join(homedir(), ".mya", "agent", "cron.json");
  if (!existsSync(cronFile)) {
    console.log(`${A.red("No cron.json found.")}`);
    return;
  }
  const arr = JSON.parse(readFileSync(cronFile, "utf-8")) as Array<{ id: string }>;
  const filtered = arr.filter((j) => j.id !== id && !id.startsWith(j.id.slice(0, 8)));
  if (filtered.length === arr.length) {
    console.log(`${A.yellow("Job not found in cron.json:")} ${id}`);
    console.log(`${A.muted("It may only exist in the running gateway. Restart to clear.")}`);
  } else {
    writeFileSync(cronFile, JSON.stringify(filtered, null, 2));
    console.log(`${A.green("✓")} Removed job ${id} from cron.json`);
  }
  // Also try API
  try {
    await fetch(`http://127.0.0.1:${GW_PORT}/cron/jobs/${id}`, { method: "DELETE", signal: AbortSignal.timeout(1000) });
  } catch { /* gateway may not be running */ }
}

export async function cronToggle(id?: string, action?: "enable" | "disable"): Promise<void> {
  if (!id || !action) {
    console.log(`${A.red("Usage:")} mya cron {enable|disable} <id>`);
    return;
  }
  try {
    const r = await fetch(`http://127.0.0.1:${GW_PORT}/cron/jobs/${id}/patch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: action === "enable" }),
      signal: AbortSignal.timeout(2000),
    });
    if (r.ok) console.log(`${A.green("✓")} Job ${id} ${action}d`);
    else console.log(`${A.red("✗")} ${(await r.json() as { error: string }).error}`);
  } catch (e) {
    console.log(`${A.red("✗")} ${(e as Error).message}`);
  }
  // Also patch the file
  const cronFile = join(homedir(), ".mya", "agent", "cron.json");
  if (existsSync(cronFile)) {
    const arr = JSON.parse(readFileSync(cronFile, "utf-8")) as Array<{ id: string; enabled: boolean }>;
    for (const j of arr) {
      if (j.id === id || id.startsWith(j.id.slice(0, 8))) j.enabled = action === "enable";
    }
    writeFileSync(cronFile, JSON.stringify(arr, null, 2));
  }
}

export async function cronRun(id?: string): Promise<void> {
  if (!id) {
    console.log(`${A.red("Usage:")} mya cron run <id>`);
    return;
  }
  try {
    const r = await fetch(`http://127.0.0.1:${GW_PORT}/cron/jobs/${id}/run`, {
      method: "POST",
      signal: AbortSignal.timeout(2000),
    });
    if (r.ok) console.log(`${A.green("✓")} Job ${id} triggered`);
    else console.log(`${A.red("✗")} ${(await r.json() as { error: string }).error}`);
  } catch (e) {
    console.log(`${A.red("✗")} ${(e as Error).message}`);
  }
}

export async function cronHistory(id?: string): Promise<void> {
  if (!id) {
    console.log(`${A.red("Usage:")} mya cron history <id>`);
    return;
  }
  console.log(`${A.muted("Run history (from cron.json lastRunAt, no detailed log yet)")}`);
  const cronFile = join(homedir(), ".mya", "agent", "cron.json");
  if (!existsSync(cronFile)) {
    console.log(`${A.muted("No cron.json")}`);
    return;
  }
  const arr = JSON.parse(readFileSync(cronFile, "utf-8")) as Array<{ id: string; name: string }>;
  const job = arr.find((j) => j.id === id || id.startsWith(j.id.slice(0, 8)));
  if (job) console.log(`  ${A.accent(job.name)} (${job.id})`);
  console.log(`${A.muted("Detailed per-run history will be added in a future update.")}`);
}
