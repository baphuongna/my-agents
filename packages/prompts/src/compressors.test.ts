import { describe, it, expect } from "vitest";
import { overflowRecovery } from "./compressors.js";

describe("[unit] prompts overflowRecovery", () => {
  const tokenCost = (e: unknown) => (typeof e === "object" && e !== null && "content" in e) ? String((e as { content: unknown }).content).length : 0;

  it("under limit → no change, retry=false", () => {
    const history = [{ role: "user", content: "hi" }];
    const r = overflowRecovery({ history, keepTail: 1, maxTokens: 100, estimateTokens: tokenCost });
    expect(r.history).toBe(history);
    expect(r.retry).toBe(false);
    expect(r.dropped).toBe(0);
  });

  it("over limit → compact head, keep tail, retry=true", () => {
    const history = [
      { role: "user", content: "aaa" },
      { role: "assistant", content: "bbb" },
      { role: "user", content: "ccc" },
    ];
    const r = overflowRecovery({ history, keepTail: 1, maxTokens: 5, estimateTokens: tokenCost });
    expect(r.retry).toBe(true);
    expect(r.dropped).toBe(2);
    // tail (last 1) is kept
    expect(r.history.at(-1)).toEqual({ role: "user", content: "ccc" });
    // head is replaced with a system summary marker
    expect((r.history[0] as { role: string }).role).toBe("system");
  });

  it("keepTail=0 → all head compacted", () => {
    const history = [{ role: "user", content: "xxxxx" }];
    const r = overflowRecovery({ history, keepTail: 0, maxTokens: 1, estimateTokens: tokenCost });
    expect(r.dropped).toBe(1);
    expect(r.history).toHaveLength(1); // just the summary marker
    expect((r.history[0] as { role: string }).role).toBe("system");
  });

  it("maxTokens large enough → no compaction", () => {
    const history = [{ role: "user", content: "hi" }];
    const r = overflowRecovery({ history, keepTail: 1, maxTokens: 10000, estimateTokens: tokenCost });
    expect(r.retry).toBe(false);
    expect(r.dropped).toBe(0);
  });

  it("system marker mentions dropped count", () => {
    const history = [{ role: "user", content: "aaaa" }, { role: "user", content: "bbbb" }];
    const r = overflowRecovery({ history, keepTail: 0, maxTokens: 1, estimateTokens: tokenCost });
    const marker = (r.history[0] as { content: string }).content;
    expect(marker).toMatch(/compacted 2/);
  });
});
