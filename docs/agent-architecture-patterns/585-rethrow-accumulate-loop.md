# Hướng VM: Rethrow-Accumulate Loop — chạy task N lần, giữa mỗi pass nén context, thay đổi file giữ lại, summary tăng dần

> **Nguồn gốc:** pi-boomerang (rethrow accumulate loop); "--rethrow N runs task N times"; "compress context between passes"; "file changes persist between passes"; "accumulating summary each pass" | **Coupling:** 🟡 — thêm rethrow runner vào task loop (nén + persist + accumulate giữa pass) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (agent-loop + summarizer sẵn — chưa có rethrow N-pass runner) | **Effort:** 3-4 tuần

## Nguồn gốc

**pi-boomerang** cung cấp cờ `--rethrow N`: chạy **cùng task N lần** liên tiếp. Giữa mỗi **pass** (lần chạy): (1) **nén context** (collapse history → summary, tránh overflow qua nhiều pass), (2) **giữ lại thay đổi file** (file edit từ pass trước persist — không rollback), (3) **summary tăng dần** (mỗi pass append/merge kết quả vào running-summary). Mục đích: **iterative refinement** — task khó cần nhiều lần thử, mỗi lần xây trên lần trước (file đã sửa, kinh nghiệm đã học), context không tràn vì nén giữa pass. Nguyên tắc: **chạy lại + tích lũy** — không reset sạch, mà tiếp tục có chủ đích. Khác **retry thuần** (reset rồi thử lại) — VM **accumulate**; khác single-pass — VM **multi-pass progressive**.

## Mô tả

mya rethrow-accumulate loop: (1) **Pass run**: agent-loop chạy task (full). (2) **Between-pass collapse**: nén turn history → summary (VJ), **giữ file change** (không rollback working dir). (3) **Accumulate**: summary pass này merge vào running-summary (tăng dần qua N pass). (4) **Next pass**: pass k+1 khởi đầu với context = running-summary + file hiện tại (đã sửa). (5) **After N**: running-summary cuối = kết quả tích lũy. mya có agent-loop + summarizer — VM thêm **N-pass runner** + **file-persist policy** + **accumulate merge**.

## Kiến trúc

```
  --rethrow 3 (chạy task 3 lần)
        │
        ▼
  PASS 1: agent-loop chạy task
    → edit files (file state S1)
    → turn history → COLLAPSE → summary₁
    → KEEP file changes (S1 persists)
        │ (nén context, giữ file)
        ▼
  PASS 2: agent-loop (context = summary₁, files = S1)
    → edit thêm (file state S2)
    → turn history → COLLAPSE → summary₂
    → ACCUMULATE: running = summary₁ + summary₂
        │
        ▼
  PASS 3: agent-loop (context = running, files = S2)
    → edit thêm (file state S3)
    → COLLAPSE → summary₃
    → ACCUMULATE: running = summary₁ +₂ +₃
        │
        ▼
  ┌─── KẾT QUẢ TÍCH LŨY (N pass) ─────────────────────────┐
  │  files = S3 (đã sửa qua 3 pass)                         │
  │  summary = summary₁ +₂ +₃ (tăng dần, không overflow)   │
  │  → task được refine qua nhiều lần thử                    │
  └───────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ agent-loop — task run (nền — VM = N-pass runner)
// ✅ 582 opaque-context-collapse (VJ) — nén giữa pass (nền — VM = collapse engine)
// ✅ 584 anchor-accumulation (VL) — accumulate (relate — VM = per-pass accumulate)

// ❌ THIẾU: N-pass runner (--rethrow N loop)
// ❌ THIẾU: file-persist policy (giữ file change, không rollback giữa pass)
// ❌ THIẾU: accumulate merge (summary pass → running-summary)
```

## Implementation

```typescript
// packages/agent/src/rethrow-loop.ts (MỚI)
interface PassResult { pass: number; summary: string; fileState: string }

class RethrowAccumulateLoop {
  constructor(
    private runPass: (context: string) => Promise<{ summary: string }>,
    private collapse: (history: unknown) => Promise<string>,  // VJ
    private now: () => number,
  ) {}

  async rethrow(n: number, seedContext: string): Promise<{ running: string; passes: PassResult[] }> {
    let running = seedContext;
    const passes: PassResult[] = [];
    for (let pass = 1; pass <= n; pass++) {
      // PASS: chạy với context hiện tại (running-summary tích lũy)
      const { summary } = await this.runPass(running);
      // file change tự persist (working dir không rollback giữa pass)
      // ACCUMULATE: merge summary pass vào running
      running = running + `\n[pass ${pass}] ${summary}`;
      passes.push({ pass, summary, fileState: 'persisted' });
    }
    return { running, passes };
  }
}

// Usage:
// const loop = new RethrowAccumulateLoop(runAgentPass, vjCollapse, now);
// const { running } = await loop.rethrow(3, "fix the auth bug");
//   pass 1: try fix → S1, summary₁
//   pass 2: context=summary₁, files=S1 → S2, summary₂
//   pass 3: → S3, summary₃
//   running = kết quả tích lũy 3 pass (task refined)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Task refine qua nhiều lần (iterative) | ❌ N× cost (mỗi pass full agent-loop) |
| ✅ File persist (xây trên lần trước) | ❌ Bad-state propagate (file sai pass trước → pass sau sai tiếp) |
| ✅ Context không overflow (nén giữa pass) | ❌ Nén mất chi tiết giữa pass |
| ✅ Summary tăng dần (kết quả tích lũy) | ❌ Convergence không đảm bảo (không xong sau N) |

## Khác các hướng gần

| | Retry thuần | Single-pass | VM: Rethrow-Accumulate |
|---|---|---|---|
| Giữa pass | Reset sạch | ❌ | **Nén + giữ file + accumulate** |
| File | Reset | — | **persist (xây trên)** |
| Context | Reset | — | **accumulate (tăng dần)** |

## Khi nào chọn

- Task khó cần nhiều lần thử (refine iterative)
- Mỗi pass xây trên pass trước (file + kinh nghiệm)
- Context tràn nếu chạy dài 1 pass → cần nén giữa pass
- Nối agent-loop + 582 opaque-context-collapse (VJ, nén giữa pass) + 584 anchor-accumulation (VL, accumulate); guard bad-state propagation (validate file trước pass), convergence check (dừng sớm nếu đã xong trước N), và accumulate dedup (summary trùng → gộp, không phình); VM = rethrow-accumulate loop, kết hợp 582 VJ (collapse) + 584 VL (accumulate) + 588 operational-handoff (summary cuối có cấu trúc)
