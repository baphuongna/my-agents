// packages/print/src/runtimes/router.ts
import type { AgentRuntime, SmartRouter } from "@my-agent/core";

interface RouterConfig {
  keywordWeight?: number;
  costWeight?: number;
  defaultRuntime?: string;
  customKeywords?: Map<string, string[]>;
}

const DEFAULT_KEYWORDS: Record<string, string[]> = {
  claude: ["claude", "anthropic"],
  "mya-native": ["mya", "local", "offline"],
};

export class SmartRouterImpl implements SmartRouter {
  private keywordWeight: number;
  private costWeight: number;
  private defaultRuntime: string;
  private customKeywords: Map<string, string[]>;

  constructor(
    private runtimes: Map<string, AgentRuntime>,
    config: RouterConfig = {},
  ) {
    this.keywordWeight = config.keywordWeight ?? 1.0;
    this.costWeight = config.costWeight ?? 0.3;
    this.defaultRuntime = config.defaultRuntime ?? "pi";
    this.customKeywords = config.customKeywords ?? new Map();
  }

  async select(input: {
    prompt: string;
    agentOverride?: string;
    modelOverride?: string;
  }): Promise<{ runtime: AgentRuntime; reason: string }> {
    // Explicit override
    if (input.agentOverride) {
      const rt = this.runtimes.get(input.agentOverride);
      if (rt?.isAvailable()) return { runtime: rt, reason: `override:${input.agentOverride}` };
    }

    // Keyword scoring
    const scores: Array<{ name: string; runtime: AgentRuntime; keywordScore: number; costScore: number }> = [];
    for (const [name, rt] of this.runtimes) {
      if (!rt.isAvailable()) continue;
      const keywords = this.customKeywords.get(name) ?? DEFAULT_KEYWORDS[name] ?? [];
      const keywordScore = keywords.reduce((score, kw) => {
        const regex = new RegExp(`\\b${kw}\\b`, "i");
        return score + (regex.test(input.prompt) ? 1 : 0);
      }, 0);
      const cost = rt.costPerMTokens?.() ?? { input: 0, output: 0 };
      const totalCost = cost.input + cost.output;
      const costScore = totalCost > 0 ? 1 / (1 + totalCost / 10) : 1;
      scores.push({ name, runtime: rt, keywordScore, costScore });
    }

    if (scores.length === 0) throw new Error("No runtime available");

    const best = scores.reduce((a, b) => {
      const aTotal = a.keywordScore * this.keywordWeight + a.costScore * this.costWeight;
      const bTotal = b.keywordScore * this.keywordWeight + b.costScore * this.costWeight;
      return bTotal > aTotal ? b : a;
    });

    // If no keyword matched, use default runtime
    if (best.keywordScore === 0) {
      const defaultRt = this.runtimes.get(this.defaultRuntime);
      if (defaultRt?.isAvailable()) {
        return { runtime: defaultRt, reason: `default:${this.defaultRuntime}` };
      }
    }

    return { runtime: best.runtime, reason: `scored:${best.name}(kw=${best.keywordScore})` };
  }
}
