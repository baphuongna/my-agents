# Hướng FN: Context Engineering & Token Budget — quản lý ngữ cảnh để token hiệu quả nhất

> **Nguồn gốc:** MindStudio "Token Reduction Strategies — 8 Techniques" (semantic compression, RTK, logs to SQLite, capped thinking → 50-99% cost cut with near-zero quality loss); Reddit r/PromptEngineering (Hierarchical Summarization, Rolling Context, Explicit budget); elvex "Optimize Context Windows: 7 Strategies" (Context Budgets — max token limits enforced by automated trimming, Tiered); maxim "Context Window Management" (200K+ token windows don't eliminate budgeting — linear cost)
> **Coupling:** 🟡 — các thành phần đồng ý chung cơ chế nén/ngân sách
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (summarizer + memory + retrieval sẵn; thiếu budget governance)
> **Effort:** 2-4 tuần

## Nguồn gốc

Context engineering: **làm chủ context window — token có ngân sách, tự nén/trim/gợi đúng thứ quan trọng** — MindStudio: "semantic compression, RTK, logs to SQLite, capped thinking budgets cut AI agent token costs by 50-99% with near-zero quality loss"; Reddit r/PromptEngineering: "Don't pass raw docs — hierarchical summarization; rolling context — keep only the last 5 interactions; explicit token budget"; elvex "7 Strategies": "set maximum token limits for different interaction types and enforce them through automated trimming — tiered approach"; Maxim "Context Window Management": "models with 200K+ token windows make budgeting easier but don't eliminate it — cost per token still scales linearly".

## Mô tả

mya context budget: (1) **budget theo loại** — token tối đa mỗi loại ngữ cảnh (system/task/history/tools — elvex tiered); (2) **trimming tự động** — đầy là cắt tự theo thứ tự ưu tiên (Reddit rolling: giữ N lượt gần nhất); (3) **hierarchical summarization** — không nhét raw doc vào; chỉ đưa bản tóm (Reddit + MindStudio compression); (4) **RAG chọn lọc** — lấy đúng đoạn cần cho task (tiered retrieval từ J memory + R kb), không lôi cả kho; (5) **monitor** — đếm token thực chi/loại (MindStudio logs to SQLite), so trước-sau (PP eval); (6) **tinh chỉnh** — từ metric đặt lại budget (looping — JJJJJJJ).

## Kiến trúc

```
  CONTEXT WINDOW (maxim: 200K+ không loại bỏ việc budget)
        │
        ▼
  BUDGET (elvex tiered): max token mỗi loại — enforcing bằng trimming tự động
   · system · task · history · tools
        │
        ▼
  TRIMMING & NÉN: rolling (giữ N lượt gần — Reddit) · hierarchical summary
   · semantic compression (MindStudio — 50-99% cắt token, gần như không mất chất lượng)
        │
        ▼
  RAG ĐÚNG (J/JJJ và R): chỉ lấy đoạn liên quan task — không cả kho
        │
        ▼
  MONITOR (SQLite logs): token thực → điều chỉnh budget (PP eval so trước/sau)
```

```

mya: summarizer + memory + retrieval Sẵn — thiếu: budget governance + trimming
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ summarizer — nén văn bản dài (nền cho hierarchical)
// ✅ JJJJJJJ memory hierarchy + R kb — các bậc nguồn
// ✅ WWWWWW intent — chọn gì đưa vào context
// ✅ YYY metrics — theo dõi chi phí/token
// ✅ KKKKKKK cache — giảm token lặp (bổ trợ)
// ✅ PP eval + 147 feedback — so chất lượng trước/sau

// ❌ THIẾU: budget config per loại (elvex)
// ❌ THIẾU: automated trimming/rolling (Reddit)
// ❌ THIẾU: token accounting log (SQLite — MindStudio)
// ❌ THIẾU: điều chỉnh budget từ token metric (loop)
```

## Implementation

```typescript
// packages/context/src/budget.ts (NEW)
const BUDGET = { system: 2000, task: 4000, history: 3000, tools: 1000 }; // elvex tiered
export class ContextEngine {
  build(req: LlmRequest): Prompt {
    return {
      system: trim(req.system, BUDGET.system),
      task: trim(req.task, BUDGET.task),                       // budget theo loại
      history: rolling(req.history, BUDGET.history, 5),       // Reddit: giữ N lượt gần
      tools: topK(req.tools, BUDGET.tools),                    // giữ tool liên quan task
    }; // semantic compression: summary thay raw (MindStudio)
  }
  async run(req: LlmRequest) {
    const p = this.build(req);
    const r = await llm.call(p);
    sqlite.log({ tokens: r.usage, budget: BUDGET, time: now() }); // MindStudio logs
    return r;
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ 50-99% token giảm, chất lượng gần không đổi (MindStudio) | ❌ Nén sai → mất thông tin quan trọng |
| ✅ Budget rõ ràng — không phình context (elvex enforced) | ❐ Trimming quá tay → mất lịch sử/cảnh |
| ✅ Nhanh + rẻ — chỉ gửi đúng cần (RAG tiered) | ❌ Budget đúng cho từng task cần đo/sửa liên tục |
| ✅ Xây trên summarizer + JJJJJ + R | ❌ Phụ thuộc RAG đúng — sai đoạn sai kết |

## Khác các hướng gần

| | KKKKKKK Cache | JJJJJJJ Memory | OOOOOOO Context/Budget |
|---|---|---|---|
| Mục đích | Tiết kiệm token lặp | Nhớ lâu | **Giới hạn + chọn lọc context** |
| Cơ chế | KV/semantic reuse | Nhiều tầng bậc | **Budget + trim + nén** |
| Quan hệ | Task lặp lại | Nguồn sâu | **Governance của context window** |

## Khi nào chọn

- Agent bị "context bloat" — token cao, chất lượng giảm dần
- Render dài (doc/history) — cần tóm + lấy đúng đoạn thay đưa nguyên
- Đã có summarizer + JJJJ + R + KKK — thêm budget + trimming + logs
- Muốn tối ưu cost bền vững theo data (MindStudio — đo rồi sửa)