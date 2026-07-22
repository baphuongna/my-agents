/**
 * @my-agent/cron — Agent-callable cron management tools.
 *
 * C6: wraps CronScheduler primitives as ToolImpl so the agent can create,
 * list, delete, and run cron jobs. Security: all jobs are prefixed `agent-`
 * and rate-limited to 10 per agent. Permission: WorkspaceWrite + ask rule.
 *
 * Source: §07 Tools + §12.3 Cron, PLAN-FEATURES C6.
 */
import { randomUUID } from "node:crypto";
import type { ToolImpl } from "@my-agent/tools";
import type { ToolResult } from "@my-agent/core";
import type { CronScheduler, CronJob } from "./index.js";

const MAX_AGENT_JOBS = 10;
const AGENT_PREFIX = "agent-";

export function makeCronTools(cron: CronScheduler): ToolImpl[] {
  /** C6-1: Create a cron job (agent-scoped). */
  const cronCreate: ToolImpl = {
    meta: {
      name: "cron_create",
      description: "Create a scheduled cron job. The job runs an agent prompt on a schedule.",
      args: {
        type: "object",
        properties: {
          name: { type: "string", description: "Human-readable job name" },
          schedule: { type: "string", description: "Cron expression (e.g. '0 9 * * *') or interval in ms" },
          prompt: { type: "string", description: "The prompt to run on schedule" },
          trigger: { type: "string", enum: ["cron", "on-interval", "once"], description: "Trigger type (default: cron)" },
        },
        required: ["name", "schedule", "prompt"],
      },
      requiredMode: "WorkspaceWrite",
    },
    async run(args: unknown): Promise<ToolResult> {
      const a = args as { name?: string; schedule?: string; prompt?: string; trigger?: string };
      if (!a.name || !a.schedule || !a.prompt) {
        return { callId: "cron_create", ok: false, output: null, error: "name + schedule + prompt required" };
      }
      // Rate limit: max 10 agent-created jobs
      const existing = cron.listJobs().filter((j) => j.id.startsWith(AGENT_PREFIX));
      if (existing.length >= MAX_AGENT_JOBS) {
        return { callId: "cron_create", ok: false, output: null, error: `max ${MAX_AGENT_JOBS} agent jobs reached` };
      }
      const id = `${AGENT_PREFIX}${a.name.replace(/[^a-zA-Z0-9-]/g, "-")}-${randomUUID().slice(0,8)}`;
      const trigger = (a.trigger ?? "cron") as CronJob["trigger"];
      const schedule = trigger === "on-interval" ? Number(a.schedule) || 60_000 : a.schedule;
      try {
        cron.register({
          id, name: a.name, trigger, schedule,
          deliveryTarget: "_cron", prompt: a.prompt,
          enabled: true, leaseMs: 5 * 60_000,
        });
        return { callId: "cron_create", ok: true, output: { id, name: a.name } };
      } catch (e) {
        return { callId: "cron_create", ok: false, output: null, error: (e as Error).message };
      }
    },
  };

  /** C6-2: List agent-created cron jobs. */
  const cronList: ToolImpl = {
    meta: {
      name: "cron_list",
      description: "List cron jobs created by this agent (agent-* prefix only).",
      args: { type: "object", properties: {} },
      requiredMode: "ReadOnly",
    },
    async run(): Promise<ToolResult> {
      const jobs = cron.listJobs()
        .filter((j) => j.id.startsWith(AGENT_PREFIX))
        .map((j) => ({ id: j.id, name: j.name, schedule: j.schedule, enabled: j.enabled, nextRunAt: j.nextRunAt }));
      return { callId: "cron_list", ok: true, output: { jobs } };
    },
  };

  /** C6-3: Delete an agent-created cron job. */
  const cronDelete: ToolImpl = {
    meta: {
      name: "cron_delete",
      description: "Delete a cron job by ID (must be agent-created).",
      args: {
        type: "object",
        properties: { id: { type: "string", description: "Job ID to delete" } },
        required: ["id"],
      },
      requiredMode: "WorkspaceWrite",
    },
    async run(args: unknown): Promise<ToolResult> {
      const a = args as { id?: string };
      if (!a.id) return { callId: "cron_delete", ok: false, output: null, error: "id required" };
      if (!a.id.startsWith(AGENT_PREFIX)) {
        return { callId: "cron_delete", ok: false, output: null, error: "can only delete agent-created jobs" };
      }
      try {
        cron.removeJob(a.id);
        return { callId: "cron_delete", ok: true, output: { deleted: a.id } };
      } catch (e) {
        return { callId: "cron_delete", ok: false, output: null, error: (e as Error).message };
      }
    },
  };

  /** C6-4: Run a cron job immediately (manual trigger). */
  const cronRun: ToolImpl = {
    meta: {
      name: "cron_run",
      description: "Trigger a cron job to run immediately (manual fire).",
      args: {
        type: "object",
        properties: { id: { type: "string", description: "Job ID to run" } },
        required: ["id"],
      },
      requiredMode: "WorkspaceWrite",
    },
    async run(args: unknown): Promise<ToolResult> {
      const a = args as { id?: string };
      if (!a.id) return { callId: "cron_run", ok: false, output: null, error: "id required" };
      const job = cron.getJob(a.id);
      if (!job) return { callId: "cron_run", ok: false, output: null, error: "job not found" };
      // Force-update nextRunAt to now so the next sweep picks it up
      try {
        cron.updateJob(a.id, { nextRunAt: 1 } as Partial<CronJob>);
        return { callId: "cron_run", ok: true, output: { triggered: a.id, message: "will fire on next sweep" } };
      } catch (e) {
        return { callId: "cron_run", ok: false, output: null, error: (e as Error).message };
      }
    },
  };

  return [cronCreate, cronList, cronDelete, cronRun];
}
