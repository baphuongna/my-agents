/**
 * @my-agent/gateway — Cross-device approval relay.
 *
 * R4-2 fix: the web approval modal was disconnected — buttons didn't send
 * decisions. This relay:
 *   1. Tracks pending approval requests with IDs
 *   2. Emits `approval_requested` events via the gateway broadcast
 *   3. Resolves pending requests when decisions arrive (WS or HTTP)
 *
 * Source: §7 Permission (AwaitingApproval → ApprovalChannel.request()),
 *         PLAN-FEATURES-REVIEW-V4 R4-2.
 */
import { nowWallclock } from "@my-agent/core";
import { randomUUID } from "node:crypto";

export interface ApprovalRequestPayload {
  requestId: string;
  callId: string;
  tool: string;
  reason: string;
  requiredMode: string;
  currentMode: string;
  argsSummary?: string;
  createdAt: number;
}

export interface ApprovalDecisionPayload {
  requestId: string;
  decision: "allow" | "deny";
  reason?: string;
}

interface PendingRequest {
  payload: ApprovalRequestPayload;
  resolve: (decision: { decision: "Allow" | "Deny"; reason: string }) => void;
  timer: NodeJS.Timeout;
}

const DEFAULT_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24h (matches core makeApprovalChannel)

export class ApprovalRelay {
  private pending = new Map<string, PendingRequest>();
  private onEmit?: (event: { kind: string; payload: ApprovalRequestPayload }) => void;

  /** Wire the broadcast callback (gateway sets this to broadcast to WS/SSE). */
  setEmitter(fn: (event: { kind: string; payload: ApprovalRequestPayload }) => void): void {
    this.onEmit = fn;
  }

  /** Submit a new approval request. Returns a promise that resolves on decision or timeout. */
  request(payload: Omit<ApprovalRequestPayload, "requestId" | "createdAt">): Promise<{ decision: "Allow" | "Deny"; reason: string }> {
    const requestId = `apr-${randomUUID().slice(0, 18)}`;
    const fullPayload: ApprovalRequestPayload = { ...payload, requestId, createdAt: nowWallclock() };

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.has(requestId)) {
          this.pending.delete(requestId);
          resolve({ decision: "Deny", reason: `approval timed out after ${DEFAULT_TIMEOUT_MS}ms (fail-closed)` });
        }
      }, DEFAULT_TIMEOUT_MS);
      timer.unref?.();

      this.pending.set(requestId, { payload: fullPayload, resolve, timer });

      // Emit to web clients
      this.onEmit?.({ kind: "approval_requested", payload: fullPayload });
    });
  }

  /** Resolve a pending request with a decision (from WS or HTTP). */
  decide(decision: ApprovalDecisionPayload): boolean {
    const pending = this.pending.get(decision.requestId);
    if (!pending) return false;

    clearTimeout(pending.timer);
    this.pending.delete(decision.requestId);
    pending.resolve({
      decision: decision.decision === "allow" ? "Allow" : "Deny",
      reason: decision.reason ?? (decision.decision === "allow" ? "approved via web" : "denied via web"),
    });
    return true;
  }

  /** List all pending requests (for /approval/pending endpoint). */
  listPending(): ApprovalRequestPayload[] {
    return [...this.pending.values()].map((p) => p.payload);
  }

  /** Check if a request is still pending. */
  hasPending(requestId: string): boolean {
    return this.pending.has(requestId);
  }
}
