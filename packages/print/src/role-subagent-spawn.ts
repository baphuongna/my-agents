/**
 * spawnRoleSubagent — the LOGIC layer for spawning a role-subagent.
 *
 * This is the ONLY module in the logic layer that imports the view SPI.
 * It calls `openView()` / `resolveViewBackend()` against the interface — it
 * does NOT import any mux (tmux, herdr, standalone) directly. Adding a new
 * view backend is zero change here (it's handled by the SPI registry).
 *
 * Flow (per docs/mya-subagent-design.md — "End-to-end spawn flow"):
 *   1. POST /pool/acquire {cwd, role, task, model, parentSessionId} → sessionId
 *   2. Build argv: mya --gateway-session <id> --role <role> --task <task> [--model <m>]
 *   3. openView({command: argv, title: role, cwd}) → ViewHandle (hand-off to view layer)
 *   4. Track handle by sessionId (for /agents view.focus)
 *
 * The spawned mya process boots with the role applied + auto-runs the task.
 * The parent session tracks it via /pool/tree (parentSessionId nesting).
 */
import { openView, resolveViewBackend, VIEW_BACKENDS, type ViewHandle } from "./view/view-backend.js";
import { authHeaders } from "./gw-auth.js";
import { nowWallclock } from "@my-agent/core";

/** Options for spawning a role-subagent. */
export interface SpawnRoleSubagentOpts {
  /** Role name (e.g. "coder"). Must exist in the role registry. */
  role: string;
  /** The task prompt the spawned mya should auto-run. */
  task: string;
  /** Preferred model for the role-subagent (optional). */
  model?: string;
  /** Working directory for the spawned session. */
  cwd: string;
  /** Parent session id — the new session is registered as its child. */
  parentSessionId: string;
  /** Gateway base URL (e.g. "http://127.0.0.1:3000"). */
  gatewayUrl: string;
}

/** Result of a successful spawn. */
export interface SpawnResult {
  sessionId: string;
  handle: ViewHandle;
}

/**
 * In-process handle registry: sessionId → ViewHandle.
 *
 * When a role-subagent is spawned, its ViewHandle is stored here so the
 * `/agents open <id>` command can call `view.focus(handle)` later.
 * This is module-level (not per-bridge) because spawns and the /agents
 * command both run in the main session's process.
 */
const handleRegistry = new Map<string, ViewHandle>();

/** Get the ViewHandle for a previously spawned role-subagent (or undefined). */
export function getViewHandle(sessionId: string): ViewHandle | undefined {
  return handleRegistry.get(sessionId);
}

/** Focus the view of a previously spawned role-subagent.
 * Returns true if the focus was attempted, false if no handle/backend-focus. */
export async function focusRoleSubagentView(sessionId: string): Promise<boolean> {
  const handle = handleRegistry.get(sessionId);
  if (!handle) return false;
  // MEDIUM-1 fix: route focus to the backend that OPENED the handle (by id),
  // not whichever backend detects NOW (env could change mid-session).
  const backend = VIEW_BACKENDS.find((b) => b.id === handle.backendId) ?? resolveViewBackend();
  if (!backend.focus) return false;
  await backend.focus(handle);
  return true;
}

/** Remove a handle from the registry (e.g. after kill). */
export function forgetViewHandle(sessionId: string): void {
  handleRegistry.delete(sessionId);
}

// ═══════════════════════════════════════════════════════════════════
// waitRoleSubagent — poll /pool/tree until a subagent completes
// ═══════════════════════════════════════════════════════════════════

/** Minimal tree-node shape for /pool/tree scanning (avoids importing mya-bridge
 * — keeps this module dependency-free on the rendering layer). */
interface PoolTreeNode {
  sessionId?: string;
  status?: string;
  summary?: string;
  keyOutputs?: string[];
  subagents?: Array<{
    id: string;
    status: string;
    summary?: string;
    keyOutputs?: string[];
  }>;
}

/** Options for waiting on a role-subagent to reach a terminal status. */
export interface WaitRoleSubagentOpts {
  /** Session ID of the role-subagent to wait for. */
  sessionId: string;
  /** Gateway base URL (e.g. "http://127.0.0.1:3000"). */
  gatewayUrl: string;
  /** Poll interval in milliseconds (default 2000). */
  pollIntervalMs?: number;
  /** Overall timeout in milliseconds (default 300_000 = 5 min). */
  timeoutMs?: number;
}

/** Result of waiting for a role-subagent.
 * `status` is one of: "done" | "failed" | "timeout" | "not_found". */
export interface WaitResult {
  status: string;
  summary?: string;
  keyOutputs?: string[];
}

/** Promise-based sleep (used between poll cycles). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Scan a /pool/tree response for a node matching `sessionId`.
 * Checks both top-level nodes (`sessionId` field) and nested subagents (`id` field).
 * Returns the node's status + optional summary/keyOutputs, or undefined if absent. */
function findNodeInTree(
  tree: PoolTreeNode[],
  sessionId: string,
): { status: string; summary?: string; keyOutputs?: string[] } | undefined {
  for (const node of tree) {
    if (node.sessionId === sessionId) {
      return {
        status: node.status ?? "idle",
        ...(node.summary !== undefined ? { summary: node.summary } : {}),
        ...(node.keyOutputs !== undefined ? { keyOutputs: node.keyOutputs } : {}),
      };
    }
    const sub = node.subagents?.find((s) => s.id === sessionId);
    if (sub) {
      return {
        status: sub.status,
        ...(sub.summary !== undefined ? { summary: sub.summary } : {}),
        ...(sub.keyOutputs !== undefined ? { keyOutputs: sub.keyOutputs } : {}),
      };
    }
  }
  return undefined;
}

/**
 * Wait for a role-subagent to reach a terminal status (done/failed) by polling
 * GET /pool/tree. Scans both top-level nodes and nested `.subagents[]`.
 *
 * Returns:
 * - `{ status: "done", summary?, keyOutputs? }` — subagent completed successfully.
 * - `{ status: "failed", summary?, keyOutputs? }` — subagent reported failure.
 * - `{ status: "timeout" }` — overall timeout elapsed while still working.
 * - `{ status: "not_found" }` — session absent from the tree on first successful poll.
 *
 * Uses `authHeaders()` from `./gw-auth.js` and `AbortSignal.timeout` on each fetch.
 */
export async function waitRoleSubagent(opts: WaitRoleSubagentOpts): Promise<WaitResult> {
  const pollIntervalMs = opts.pollIntervalMs ?? 2000;
  const deadline = nowWallclock() + (opts.timeoutMs ?? 300_000);

  for (;;) {
    let res: Response;
    try {
      res = await fetch(`${opts.gatewayUrl}/pool/tree`, {
        headers: authHeaders(),
        signal: AbortSignal.timeout(2000),
      });
    } catch {
      // Network error — retry if still within the deadline.
      if (nowWallclock() >= deadline) return { status: "timeout" };
      await sleep(pollIntervalMs);
      continue;
    }

    if (!res.ok) {
      if (nowWallclock() >= deadline) return { status: "timeout" };
      await sleep(pollIntervalMs);
      continue;
    }

    const tree = (await res.json()) as PoolTreeNode[];
    const node = findNodeInTree(tree, opts.sessionId);
    if (!node) {
      return { status: "not_found" };
    }

    if (node.status === "done" || node.status === "failed") {
      return {
        status: node.status,
        ...(node.summary !== undefined ? { summary: node.summary } : {}),
        ...(node.keyOutputs !== undefined ? { keyOutputs: node.keyOutputs } : {}),
      };
    }

    // Still working/idle — check deadline, then wait before the next poll.
    if (nowWallclock() >= deadline) return { status: "timeout" };
    await sleep(pollIntervalMs);
  }
}

/**
 * Spawn a role-subagent: acquire a gateway session + open a view running mya.
 *
 * @returns { sessionId, handle } — the gateway session id + the view handle.
 * @throws if the gateway acquire fails or the view backend can't open.
 */
export async function spawnRoleSubagent(opts: SpawnRoleSubagentOpts): Promise<SpawnResult> {
  // 1. Acquire a gateway session with role/task/model/parent metadata.
  const acquireRes = await fetch(`${opts.gatewayUrl}/pool/acquire`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      cwd: opts.cwd,
      role: opts.role,
      task: opts.task,
      ...(opts.model !== undefined && { model: opts.model }),
      parentSessionId: opts.parentSessionId,
    }),
  });
  if (!acquireRes.ok) {
    const body = await acquireRes.text().catch(() => "");
    throw new Error(
      `spawnRoleSubagent: /pool/acquire failed (${acquireRes.status})${body ? `: ${body}` : ""}`,
    );
  }
  const acquired = (await acquireRes.json()) as { sessionId?: string };
  const sessionId = acquired.sessionId;
  if (!sessionId) {
    throw new Error("spawnRoleSubagent: gateway returned no sessionId");
  }

  // 2. Build argv for the spawned mya process.
  const argv: string[] = [
    "mya",
    "--gateway-session", sessionId,
    "--role", opts.role,
    "--task", opts.task,
    ...(opts.model ? ["--model", opts.model] : []),
  ];

  // 3. Open a view running mya (SPI — no mux import in this file).
  // 4. Track the handle for /agents view.focus.
  // F2: if openView fails, release the acquired session so it doesn't dangle
  //    in the pool as a ghost with no running process.
  try {
    const handle = await openView({ command: argv, title: opts.role, cwd: opts.cwd });
    handleRegistry.set(sessionId, handle);
    return { sessionId, handle };
  } catch (e) {
    await fetch(`${opts.gatewayUrl}/pool/kill/${encodeURIComponent(sessionId)}`, {
      method: "POST",
      headers: authHeaders(),
    }).catch(() => {});
    throw e;
  }
}
