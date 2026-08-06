# Hướng VJ: Opaque Context Collapse — sau khi hoàn thành việc tự chủ, nén turn history thành summary branch; worker không nhận biết

> **Nguồn gốc:** pi-boomerang (opaque context collapse); "compress autonomous turn history into summary branch"; "worker agent unaware of collapse"; "summary replaces raw trace; raw archived" | **Coupling:** 🟡 — thêm context-collapse compressor vào subagent return path | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (subagent + summarizer sẵn — chưa có opaque collapse + branch archive) | **Effort:** 3-4 tuần

## Nguồn gốc

**pi-boomerang** khi một **worker agent** làm việc **tự chủ** (nhiều turn, nhiều tool call) và **hoàn thành** → toàn bộ **turn history dài** được **nén** thành một **summary branch**. Orchestrator (parent) chỉ nhận **summary** (kết quả + ngữ cảnh tối thiểu), không nhận raw trace dài. **Worker không nhận biết** sự nén — nó chạy bình thường, collapse xảy ra **sau khi** worker xong (opaque, transparent tới worker). Nguyên tắc: **làm việc dài, báo cáo ngắn** — parent không bị overflow context; raw trace **archive** (có thể tra cứu nếu cần) nhưng không load mặc định. Khác **subagent return thuần** (trả raw) — VJ **collapse → summary**; khác truncate — VJ **semantic summary + archive**.

## Mô tả

mya opaque context collapse: (1) **Worker run**: subagent chạy tự chủ (N turn, tool calls). (2) **Completion detect**: worker báo xong → trigger collapse. (3) **Summarize**: nén turn history → summary (outcome, key findings, changed files, decisions) — worker không biết. (4) **Summary branch**: parent nhận summary (context tối thiểu), raw trace **archive** vào nhánh riêng (lazy-load nếu cần). (5) **Opaque**: worker perspective — nó chỉ "làm việc rồi trả kết quả", không thấy collapse. mya có subagent + summarizer — VJ thêm **collapse trigger** + **summary-branch archive** + **opaque guarantee**.

## Kiến trúc

```
  WORKER (autonomous, N turns):
    turn 1: read file → turn 2: edit → turn 3: test →
    turn 4: fix → turn 5: verify → DONE
        │ (completion — worker báo xong)
        ▼
  ┌─── CONTEXT COLLAPSE (worker KHÔNG nhận biết) ─────────┐
  │  raw turn history (5 turns, nhiều tool calls) →        │
  │  SUMMARIZE:                                             │
  │    outcome: "fixed auth bug in login.ts"                │
  │    changed: ["src/login.ts", "src/login.test.ts"]       │
  │    findings: "token refresh logic lỗi race condition"   │
  └───────────────────────┬─────────────────────────────┘
                          │ (summary replaces raw)
                          ▼
  ┌─── SUMMARY BRANCH (parent nhận) ──────────────────────┐
  │  orchestrator context += summary (ngắn, tối thiểu)     │
  │  raw trace → ARCHIVE (lazy, tra cứu khi cần)           │
  │  → parent KHÔNG overflow (chỉ summary, không raw)      │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/subagents — subagent lifecycle (nền — VJ = collapse lúc return)
// ✅ context summarizer/compression — summarize (nền — VJ = collapse engine)
// ✅ 08-subagents tests — subagent (relate — VJ = opaque return)

// ❌ THIẾU: collapse trigger (completion → summarize)
// ❌ THIẾU: summary-branch archive (raw → lazy nhánh riêng)
// ❌ THIẾU: opaque guarantee (worker không thấy collapse)
```

## Implementation

```typescript
// packages/agent/src/opaque-context-collapse.ts (MỚI)
interface RawTurn { turnId: string; toolCalls: string[]; output: string }
interface Summary {
  outcome: string;
  changedFiles: string[];
  findings: string[];
}

class OpaqueContextCollapse {
  private archives = new Map<string, RawTurn[]>(); // branch-id → raw (lazy)

  constructor(
    private summarize: (turns: RawTurn[]) => Promise<Summary>,
  ) {}

  // collapse: nén raw → summary, archive raw
  async collapse(workerId: string, turns: RawTurn[]): Promise<Summary> {
    const summary = await this.summarize(turns);
    // archive raw (lazy-load sau nếu cần)
    this.archives.set(workerId, turns);
    return summary; // chỉ summary tới parent
  }

  // lazy-load raw trace (chỉ khi cần audit/debug)
  loadRaw(workerId: string): RawTurn[] | undefined {
    return this.archives.get(workerId);
  }
}

// Usage (subagent return path — OPAQUE tới worker):
// worker runs turns [t1..t5] then reports done
// const summary = await collapse.collapse(workerId, turns);
// parent.context.push(summary);          // ngắn
// (worker không biết — nó chỉ "xong → trả")
// cần debug? collapse.loadRaw(workerId)  // lazy archive
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Parent không overflow (chỉ summary) | ❌ Summary mất chi tiết (mốt t) |
| ✅ Raw archive (tra cứu được nếu cần) | ❌ Archive storage (raw phình) |
| ✅ Opaque (worker đơn giản, không lo collapse) | ❌ Summarize cost (LLM call mỗi collapse) |
| ✅ Tách execution (worker) khỏi report (summary) | ❌ Summary sai → parent hiểu nhầm |

## Khác các hướng gần

| | Subagent return raw | Truncate history | VJ: Opaque-Collapse |
|---|---|---|---|
| Parent nhận | Raw trace (dài) | Cắt đuôi | **Semantic summary** |
| Raw | Load luôn | Mất | **Archive lazy** |
| Worker biết | ❌ | ❌ | **❌ opaque** |

## Khi nào chọn

- Worker chạy dài (nhiều turn) → raw overflow parent
- Parent chỉ cần kết quả + ngữ cảnh tối thiểu
- Muốn tra cứu raw khi cần (archive, không xóa)
- Nối packages/subagents (worker lifecycle) + context summarizer + 583 hidden-orchestrator-handoff; guard summary fidelity (giữ key findings), archive retention (prune raw cũ), và opaque boundary (collapse luôn sau completion, không interrupt worker); VJ = opaque context collapse, kết hợp 583 hidden-handoff (summary tới orchestrator ẩn) + 584 anchor-accumulation (summary tích lũy)
