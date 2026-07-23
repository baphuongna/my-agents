/**
 * Session branch / seed — parent-child chain mechanics.
 *
 * Three child types (deep-dive-r3.md §7.1):
 *
 * | Type        | Marker                          | Routing Inherited |
 * |-------------|---------------------------------|-------------------|
 * | Branch      | `branchedFrom`                  | ❌                 |
 * | Compression | parent `endReason='compression'`| ✅                 |
 * | Delegate    | `delegateFrom`                  | ❌                 |
 *
 * Compression children inherit gateway routing (user/session/chat/thread) so a
 * crash between child creation and gateway peer re-record doesn't strand the
 * child (#59527). Branch + delegate children never inherit routing.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type SessionChildType = "branch" | "compression" | "delegate" | null;

export interface SessionBranchInfo {
  parentId: string | null;
  childType: SessionChildType;
  /** Marker for branch children (maps to Hermes `_branched_from`). */
  branchedFrom?: string;
  /** Marker for delegate children (maps to Hermes `_delegate_from`). */
  delegateFrom?: string;
}

/** Minimal structural shape required to classify a session's child type. */
export interface BranchableSession {
  id: string;
  parentId?: string | null;
  branchedFrom?: string;
  delegateFrom?: string;
  /** The PARENT session's end reason (set on the child for compression detection). */
  parentEndReason?: string;
  /** Pre-computed child type (if the caller already classified it). */
  childType?: SessionChildType;
}

// ─── Classification ───────────────────────────────────────────────────────────

/**
 * Determine the child type of a session from its markers.
 *
 * Priority: explicit markers (`branchedFrom`, `delegateFrom`) take precedence
 * over the compression heuristic (`parentEndReason === "compression"`).
 * A session with no parent is a root (`null`).
 */
export function classifyChildSession(session: {
  parentId?: string | null;
  branchedFrom?: string;
  delegateFrom?: string;
  parentEndReason?: string;
  childType?: SessionChildType;
}): SessionChildType {
  // Pre-computed value (trust the caller).
  if (session.childType) return session.childType;
  // No parent → root session, not a child.
  if (!session.parentId) return null;
  // Explicit markers.
  if (session.branchedFrom) return "branch";
  if (session.delegateFrom) return "delegate";
  // Compression: the parent session ended with 'compression'.
  if (session.parentEndReason === "compression") return "compression";
  return null;
}

/**
 * Walk the compression chain from `sessionId` to find the live tip.
 *
 * A compression child is one whose parent ended with `endReason='compression'`.
 * We follow the chain: start → compression child → its compression child → …
 * until no further compression child exists.
 *
 * Returns the **id** of the last session in the chain, or `null` if `sessionId`
 * has no compression children (no continuation exists).
 */
export function findCompressionTip<T extends BranchableSession>(
  sessions: T[],
  sessionId: string,
): string | null {
  const start = sessions.find((s) => s.id === sessionId);
  if (!start) return null;

  // Build a parent → children index for efficient lookup.
  const childrenByParent = new Map<string, T[]>();
  for (const s of sessions) {
    if (s.parentId) {
      const arr = childrenByParent.get(s.parentId) ?? [];
      arr.push(s);
      childrenByParent.set(s.parentId, arr);
    }
  }

  let tip: string | null = null;
  let current = sessionId;
  const visited = new Set<string>(); // cycle guard

  while (!visited.has(current)) {
    visited.add(current);
    const children = childrenByParent.get(current) ?? [];
    const compChild = children.find((c) => classifyChildSession(c) === "compression");
    if (!compChild) break;
    tip = compChild.id;
    current = compChild.id;
  }

  return tip;
}
