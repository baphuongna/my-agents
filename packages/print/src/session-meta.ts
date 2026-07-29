/**
 * In-memory role-subagent metadata store.
 *
 * The gateway pool surface (`/pool/acquire`, `/pool/tree`, `/pool/kill`) is
 * mux-agnostic: it only tracks sessions + their parent→child links. The actual
 * role/task/model metadata for a role-subagent live here, keyed by sessionId,
 * and are surfaced two ways:
 *
 *   1. `get(id)` → node-level metadata merged onto a /pool/tree entry by the
 *      host's poolStatus callback.
 *   2. `childrenOf(parentId)` → role-subagent children of a session, merged into
 *      the host's poolSubagents callback so /pool/tree nests them
 *      (`main ▸ role-subagent`).
 *
 * This is pure, in-memory, host-side state — it does NOT import any gateway,
 * pool, mux, or view-layer code. It exists as a small testable unit rather than
 * inline closures inside the gateway wiring.
 */
import type { SessionMeta } from "@my-agent/gateway";

export interface RoleChildEntry {
  /** The role-subagent's session id. */
  id: string;
  /** The task prompt (used as the subagent goal when no richer goal exists). */
  goal: string;
  /** Derived status; refined by the caller from the live pool entry if present. */
  status: string;
  depth: number;
  role?: string;
  task?: string;
  model?: string;
  parentSessionId?: string;
}

export class SessionMetaStore {
  private readonly meta = new Map<string, SessionMeta>();

  /** Record metadata for a session. Only set fields are stored; existing entries
   * are replaced wholesale (acquire is one-shot per session). */
  record(sessionId: string, m: SessionMeta): void {
    this.meta.set(sessionId, { ...m });
  }

  /** Get metadata for a session (or undefined). */
  get(sessionId: string): SessionMeta | undefined {
    return this.meta.get(sessionId);
  }

  /** Drop metadata for a session (on kill/release). */
  delete(sessionId: string): void {
    this.meta.delete(sessionId);
  }

  /** Whether a session has any role-subagent metadata. */
  has(sessionId: string): boolean {
    return this.meta.has(sessionId);
  }

  /** List role-subagent children of a parent session, as PoolSubagentEntry-like
   * records. `statusOf` lets the caller refine the status from the live pool
   * entry (busy/idle) when available. */
  childrenOf(
    parentId: string,
    statusOf?: (sessionId: string) => string | undefined,
  ): RoleChildEntry[] {
    const out: RoleChildEntry[] = [];
    for (const [childId, m] of this.meta) {
      if (m.parentSessionId !== parentId) continue;
      out.push({
        id: childId,
        goal: m.task ?? "",
        status: statusOf?.(childId) ?? "acquired",
        depth: 1,
        role: m.role,
        task: m.task,
        model: m.model,
        parentSessionId: m.parentSessionId,
      });
    }
    return out;
  }
}
