# Hướng VT: Hook Steer Contract — hooks before/after.sh nhận JSON trên stdin, stdout thành steer message nuôi agent; hooks trong suốt với agent

> **Nguồn gốc:** pi-autoresearch (hook steer contract); "before.sh / after.sh receive JSON on stdin"; "stdout becomes steer message for agent"; "hooks transparent to agent — agent doesn't know hooks exist"; "hooks feed steering context, not block decisions" | **Coupling:** 🟡 — thêm before/after hook scripts vào experiment loop boundary | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (hooks + steer sẵn — chưa có stdin/stdout steer contract) | **Effort:** 2 tuần

## Nguồn gốc

**pi-autoresearch** dùng **hook scripts** (`before.sh`, `after.sh`) để **bơm steering context** vào agent mà **agent không biết hooks tồn tại**. Cơ chế: hook **nhận JSON trên stdin** (context hiện tại — goal, last metric, experiment description), **xử lý** (vd tính suggestion, format progress), rồi **stdout trở thành steer message** — được inject vào agent như system message. Agent thấy steer message như instruction bình thường, **không thấy hook layer**. Nguyên tắc: **hook = transparent steering** — tách logic điều khiển (hook) khỏi agent perception. Khác 592 UL plugin-hook (hook trả deny/warn decision chặn) — VT hook **nuôi context, không chặn**.

## Mô tả

mya hook steer contract: (1) **`before.sh`**: chạy trước experiment step — nhận JSON stdin (goal, current metric), stdout → steer message cho agent ("you are at 108ms, target 90ms, try caching"). (2) **`after.sh`**: chạy sau experiment — nhận JSON stdin (metric result, decision), stdout → steer feedback ("revert failed, try different approach"). (3) **Transparent injection**: steer message merge vào system prompt — agent không thấy hook boundary. (4) **Contract**: stdin = JSON, stdout = steer text, exit 0 = ok, exit ≠0 = skip (no steer). mya có hooks + steer — VT thêm **stdin/stdout JSON contract** + **transparent-merge**.

## Kiến trúc

```
  EXPERIMENT STEP boundary
        │
        ▼
  ┌─── before.sh (pre-step steer) ──────────────────────────┐
  │  stdin:  {"goal":"10%","metric":108}                     │
  │  process: tính suggestion (target 90ms, try cache)       │
  │  stdout: "Target 90ms. Current 108ms. Try memoization."  │
  │  → MERGE vào agent system prompt (transparent)            │
  └───────────────┬─────────────────────────────────────────┘
                  ▼ (agent chạy experiment, không thấy hook)
  ┌─── after.sh (post-step feedback) ───────────────────────┐
  │  stdin:  {"metric":112,"decision":"revert"}              │
  │  stdout: "Revert. Caching didn't help. Try algorithm."   │
  │  → MERGE vào next turn steer (agent thấy như instruction) │
  └───────────────────────────────────────────────────────────┘

  AGENT VIEW: chỉ thấy steer message (không thấy .sh / stdin / stdout)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools dispatch.ts — tool dispatch (nền — VT hook boundary)
// ✅ 558 UL plugin-hook-aggregation — hook system (relate — VT = steer not decision)
// ✅ packages/core loop.ts — agent loop (nền — VT steer inject ở đây)
// ✅ packages/prompts — system prompt (nền — VT merge steer vào đây)

// ❌ THIẾU: before.sh / after.sh hook scripts (stdin JSON, stdout steer)
// ❌ THIẾU: stdin/stdout JSON contract (hook ↔ orchestrator)
// ❌ THIẾU: transparent-merge (steer → system prompt, agent không thấy hook)
```

## Implementation

```typescript
// packages/agent/src/hook-steer-contract.ts (MỚI)
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

interface SteerContext { goal: string; metric?: number; decision?: string; description?: string }

class HookSteerContract {
  constructor(
    private beforeHook: string | null,   // path to before.sh
    private afterHook: string | null,    // path to after.sh
    private timeoutMs: number = 5000,
  ) {}

  // before: chạy before.sh → stdout = steer message (pre-step)
  async runBefore(ctx: SteerContext): Promise<string | null> {
    if (!this.beforeHook) return null;
    return this.runHook(this.beforeHook, ctx);
  }

  // after: chạy after.sh → stdout = steer feedback (post-step)
  async runAfter(ctx: SteerContext): Promise<string | null> {
    if (!this.afterHook) return null;
    return this.runHook(this.afterHook, ctx);
  }

  // transparent merge: steer message → system prompt (agent không thấy hook)
  async injectSteer(systemPrompt: string, steer: string | null): Promise<string> {
    if (!steer) return systemPrompt;
    return systemPrompt + '\n\n[Steering Context]\n' + steer;  // agent thấy như instruction
  }

  // core: chạy hook với stdin=JSON, capture stdout
  private async runHook(path: string, ctx: SteerContext): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync(path, [], {
        input: JSON.stringify(ctx),
        timeout: this.timeoutMs,
        encoding: 'utf8',
      });
      return stdout.trim() || null;   // stdout = steer message
    } catch {
      return null;                    // exit ≠0 hoặc error → skip (no steer)
    }
  }
}

// Usage:
// const hsc = new HookSteerContract('.auto/before.sh', '.auto/after.sh');
// const before = await hsc.runBefore({goal:'10%', metric:108});
// const prompt = await hsc.injectSteer(systemPrompt, before);  // transparent merge
// ... agent chạy experiment ...
// const after = await hsc.runAfter({metric:112, decision:'revert'});
// → before/after stdout nuôi agent, agent không thấy hook
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Transparent steering (agent không thấy hook, thấy steer) | ❌ Process overhead (spawn .sh mỗi boundary) |
| ✅ Tách logic (steering ở hook, agent tập trung task) | ❌ Stdout trust (hook output rác → steer rác) |
| ✅ Flexible (hook = script bất kỳ, language bất kỳ) | ❌ Timeout risk (hook treo → block loop) |
| ✅ Contract rõ (stdin JSON, stdout steer, exit code) | ❌ Security (.sh arbitrary exec, cần trust) |

## Khác các hướng gần

| | 558 UL plugin-hook | Hardcoded steer | VT: Hook-Steer-Contract |
|---|---|---|---|
| Hook làm gì | Decision (deny/warn) | — | **Steer (nuôi context)** |
| Agent thấy | Hook layer | Steer cứng | **Chỉ steer (transparent)** |
| Contract | Decision object | — | **stdin JSON → stdout steer** |

## Khi nào chọn

- Muốn steering logic tách khỏi agent (hook .sh, agent tập trung task)
- Cần agent không thấy hook layer (transparent merge vào system prompt)
- Hook cần context runtime (stdin JSON) → suggestion động
- Nối packages/tools dispatch.ts + 558 UL plugin-hook-aggregation + packages/prompts; guard hook-trust (chỉ chạy .sh đáng tin, sandbox), timeout-discipline (hook không block loop), và stdout-validation (steer output parseable, không rác); VT = hook steer contract, kết hợp 558 UL (hook system — VT = steer variant) + 596 VX uuid-tagged-steering-hint (steer message injection relate)
