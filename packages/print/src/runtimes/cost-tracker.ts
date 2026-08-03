// packages/print/src/runtimes/cost-tracker.ts
import type { AgentEvent, CostTracker } from "@my-agent/core";
import { nowWallclock } from "@my-agent/core";

interface SessionCost {
  totalUsd: number;
  turns: number;
  tokensIn: number;
  tokensOut: number;
  events: number;
  startedAt: number;
  lastActivity: number;
}

const COST_RATES: Record<string, { input: number; output: number }> = {
  pi: { input: 3, output: 15 },
  claude: { input: 3, output: 15 },
  "mya-native": { input: 0.15, output: 0.6 },
};

export class CostTrackerImpl implements CostTracker {
  private sessions = new Map<string, SessionCost>();
  private runtimeTypes = new Map<string, string>();

  setRuntimeType(sessionId: string, type: string): void {
    this.runtimeTypes.set(sessionId, type);
  }

  record(sessionId: string, event: AgentEvent): void {
    let cost = this.sessions.get(sessionId);
    if (!cost) {
      cost = {
        totalUsd: 0, turns: 0, tokensIn: 0, tokensOut: 0,
        events: 0, startedAt: nowWallclock(), lastActivity: nowWallclock(),
      };
      this.sessions.set(sessionId, cost);
    }

    cost.events++;
    cost.lastActivity = nowWallclock();

    if (event.type === "turn_end") {
      cost.turns++;
      cost.tokensIn += event.tokensIn;
      cost.tokensOut += event.tokensOut;

      if (event.costUsd !== undefined && event.costUsd > 0) {
        cost.totalUsd += event.costUsd;
      } else {
        const rt = this.runtimeTypes.get(sessionId) ?? "pi";
        const rate = COST_RATES[rt] ?? COST_RATES["pi"] ?? { input: 0, output: 0 };
        cost.totalUsd +=
          (event.tokensIn / 1_000_000) * rate.input +
          (event.tokensOut / 1_000_000) * rate.output;
      }
    }
  }

  getSessionCost(sessionId: string): { totalUsd: number; turns: number } | undefined {
    const cost = this.sessions.get(sessionId);
    return cost ? { totalUsd: cost.totalUsd, turns: cost.turns } : undefined;
  }

  getFullCost(sessionId: string): SessionCost | undefined {
    return this.sessions.get(sessionId);
  }

  forget(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.runtimeTypes.delete(sessionId);
  }

  getAggregateCost(): { totalUsd: number; totalTurns: number; sessions: number } {
    let totalUsd = 0;
    let totalTurns = 0;
    for (const cost of this.sessions.values()) {
      totalUsd += cost.totalUsd;
      totalTurns += cost.turns;
    }
    return { totalUsd, totalTurns, sessions: this.sessions.size };
  }
}
