# Hướng AQ: Routing — mode selector + multi-model routing

> **Nguồn gốc:** Anthropic "Building Effective Agents" — routing workflow; Google ADK Coordinator/Dispatcher
> **Coupling:** 🟢 — transparent, dispatch trước khi gọi
> **Agent-agnostic:** ✅ — bất kỳ agent/model có profile
> **Code sẵn:** ⚠️ (1 phần — roles registry + ProviderRegistry sẵn; thiếu router quyết định)
> **Effort:** 3-5 ngày

## Nguồn gốc

Anthropic (2025) liệt kê **routing** là 1 trong 5 workflow patterns: một bộ phân loại (thường là LLM nhỏ hoặc rule) nhận input → quyết định dispatch đến chuyên gia phù hợp. Google ADK gọi là **Coordinator/Dispatcher**. Điểm mạnh: thay vì 1 agent to đùng xử lý mọi thứ, mỗi task đi đúng agent + model "đủ dùng" — rẻ và chính xác hơn. Catalog agentpatternscatalog tách riêng category **routing-composition** (Multi-Model Routing: model rẻ cho câu hỏi rẻ).

## Mô tả

Router nằm trước mọi task: phân loại theo **type** (bug-fix / refactor / review / research / ops) + **độ khó** (heuristic: scope files, pattern match, hoặc LLM nhỏ) → chọn cặp (agent, model) tối ưu. Output router là quyết định có audit — dễ hiểu tại sao task này đi pi chứ không đi claude.

## Kiến trúc

```
┌────────────────────────────────────────────────────────────┐
│                        ROUTER (mya)                         │
│                                                            │
│  task ──► ┌────────────────────────────────────┐            │
│           │ classify: type + difficulty + cost │            │
│           │  rule-based: extension → agent      │            │
│           │  LLM-small: ambiguous tasks         │            │
│           └────────────┬───────────────────────┘            │
│                        ▼ dispatch decision (logged)         │
│   ┌───────────┬──────────────┬───────────────┬───────────┐ │
│   ▼           ▼              ▼               ▼           │ │
│  pi+MiniMax  claude+Opus   opencode+GPT    subagent+fast │ │
│  (bug fix)   (review)      (research)      (trivial)    │ │
└────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/core/src/roles.ts — role registry: role = { prompt, tools, model }
// ✅ packages/ai/src/registry.ts — ProviderRegistry: ordered profiles + taint
// ✅ packages/print/src/mya-bridge.ts — pi.registerTool (roles, skills,...)
// ✅ packages/agent/src/index.ts — createAgent: provider registry + tool registry

// ❌ THIẾU: lớp router quyết định (type/difficulty → agent+model).
//    Hiện roles chọn theo role static; chưa có dispatch theo task.
```

## Implementation

```typescript
// packages/gateway/src/router.ts (NEW)
interface RouteDecision {
  agent: string;          // "pi" | "claude" | "opencode" | "subagent"
  model: string;          // profile id trong ProviderRegistry
  reason: string;         // audit: tại sao chọn
}

class TaskRouter {
  private rules: Array<{
    match: (task: Task) => boolean;
    route: RouteDecision;
  }> = [];

  route(task: Task): RouteDecision {
    // 1. Rule-based nhanh (0 cost): extension/pattern → agent
    for (const rule of this.rules) {
      if (rule.match(task)) { log(`[router] ${rule.route.reason}`); return rule.route; }
    }
    // 2. Difficulty heuristic: scope files, độ phức tạp diff
    const level = estimateDifficulty(task);
    // 3. LLM nhỏ cho task mơ hồ (1 lần gọi model rẻ)
    if (level === "ambiguous") return this.askClassifier(task);
    return this.pickModel(level, task);   // MiniMax cho dễ, Opus cho khó
  }
}

// Route decision lưu vào AuditLog (packages/audit) — truy vết tại sao
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Task đi đúng chuyên gia (chất lượng) | ❌ Router sai → task đi nhầm agent |
| ✅ Model rẻ cho việc dễ (cắt cost) | ❌ Classifier LLM thêm 1 call (chỉ khi mơ hồ) |
| ✅ Decision có audit | ❌ Rule set phải bảo trì theo kinh nghiệm |
| ✅ Đã có roles + provider registry | ❌ Hai agent cùng task → race (cần kanban) |
| ✅ Đơn giản, ít rủi ro | |

## Khi nào chọn

- Nhiều agent với điểm mạnh khác nhau (pi/pi fix nhanh, claude review kỹ)
- Muốn cắt cost (model rẻ cho task lặp lại)
- Muốn audit "tại sao task này đi agent này"
- Đã có roles + registry — thêm router là mảnh cuối
