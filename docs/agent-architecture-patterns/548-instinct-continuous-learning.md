# Hướng UB: Instinct Continuous Learning — thu PreToolUse/PostToolUse thành instinct nguyên tử, có confidence + scope + promotion

> **Nguồn gốc:** ECC `continuous-learning-v2` (PreToolUse/PostToolUse capture, instinct store), confidence scoring 0.3–0.9, scope project/global, promotion logic; "turn tool observations into atomic instincts", "confidence 0.3–0.9", "promote when seen in 2+ projects" | **Coupling:** 🟡 — thêm instinct-capture + promotion vào tool dispatch | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (tool dispatch + memory sẵn — chưa có instinct-capture + confidence + promotion) | **Effort:** 3-4 tuần

## Nguồn gốc

**ECC** `continuous-learning-v2` biến mỗi tool observation thành **instinct nguyên tử** — một đơn vị học nhỏ, cụ thể, có metadata. Khi agent dùng tool: **PreToolUse** capture context/intent (tool nào, args gì, vì sao), **PostToolUse** capture outcome (thành công/fail, output). Cặp này → 1 instinct, gắn **confidence 0.3–0.9** (thấp khi mới thấy 1 lần, cao khi thấy nhiều). Mỗi instinct có **scope**: `project` (chỉ project hiện tại) hoặc `global` (áp dụng mọi project). Khi một instinct project gặp ở **2+ project** khác nhau → **promote** lên global (pattern phổ biến, đáng nhớ chung). Nguyên tắc: **học từng tool-call nguyên tử**, **confidence tăng dần**, **scope mở rộng khi lặp lại cross-project**.

## Mô tả

mya instinct continuous learning: (1) **PreToolUse capture**: ghi intent trước khi tool chạy. (2) **PostToolUse capture**: ghi outcome sau khi tool chạy. (3) **Instinct form**: Pre+Post → instinct nguyên tử `{trigger, action, outcome, confidence, scope}`. (4) **Confidence decay/rise**: gặp lại → +confidence; lâu không gặp → −confidence. (5) **Promotion**: instinct project gặp 2+ project → global. mya có tool dispatch + memory — UB thêm **instinct-capturer** + **confidence-tracker** + **scope-manager** + **promoter**.

## Kiến trúc

```
  TOOL DISPATCH (agent gọi tool)
        │
        ├── PreToolUse ──▶ capture {tool, args, intent, context}
        │
        │   tool chạy ...
        │
        └── PostToolUse ─▶ capture {ok, output, latency}
                │
                ▼
  ┌─── INSTINCT FORM (Pre+Post → atomic) ────────────────────┐
  │  { trigger:"edit parser", action:"save+test",             │
  │    outcome:"pass", confidence:0.5, scope:"project A" }    │
  └───────────────────────┬─────────────────────────────────┘
                          │
            ┌─────────────┴──────────────┐
            ▼                            ▼
  ┌─── CONFIDENCE ───────────┐  ┌─── PROMOTION ──────────────┐
  │ gặp lại → +0.1           │  │ project instinct gặp ở     │
  │ lâu không gặp → −0.05    │  │ 2+ project khác → promote  │
  │ floor 0.3 / ceil 0.9     │  │ scope: project → global    │
  └──────────────────────────┘  └────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools dispatch.ts — tool dispatch (nền — UB capture ở đây)
// ✅ packages/memory brain-store.ts — durable store (nền — UB instinct persist)
// ✅ packages/memory learning-graph.ts — learning graph (nền — UB confidence/edge)
// ✅ packages/audit trust.ts — trust scoring (nền — UB confidence analog)

// ❌ THIẾU: PreToolUse/PostToolUse capturer (intent + outcome → instinct)
// ❌ THIẾU: confidence tracker (decay/rise, floor/ceil 0.3–0.9)
// ❌ THIẾU: scope manager (project vs global)
// ❌ THIẾU: promoter (2+ project → global)
```

## Implementation

```typescript
// packages/agent/src/instinct-learning.ts (MỚI)
interface Instinct {
  trigger: string; action: string; outcome: string;
  confidence: number; scope: 'project' | 'global';
  seenProjects: Set<string>;
}

class InstinctContinuousLearning {
  private instincts: Instinct[] = [];
  constructor(private now: () => number, private project: string) {}

  // PreToolUse + PostToolUse → form instinct
  capture(pre: { intent: string }, post: { action: string; outcome: string }): Instinct {
    const existing = this.instincts.find(
      i => i.trigger === pre.intent && i.action === post.action,
    );
    if (existing) {
      existing.confidence = Math.min(0.9, existing.confidence + 0.1); // rise
      existing.seenProjects.add(this.project);
      if (existing.seenProjects.size >= 2) existing.scope = 'global';  // promote
      return existing;
    }
    const inst: Instinct = {
      trigger: pre.intent, action: post.action, outcome: post.outcome,
      confidence: 0.3, scope: 'project', seenProjects: new Set([this.project]),
    };
    this.instincts.push(inst);
    return inst;
  }

  // decay confidence (gọi định kỳ — instinct lâu không gặp yếu đi)
  decay(thresholdMs: number): void {
    for (const i of this.instincts) {
      if (this.now() - 0 > thresholdMs) i.confidence = Math.max(0.3, i.confidence - 0.05);
    }
  }

  // recall relevant instinct (trigger match, confidence threshold)
  recall(intent: string, minConfidence = 0.5): Instinct[] {
    return this.instincts.filter(i => i.trigger === intent && i.confidence >= minConfidence);
  }
}

// Usage:
// const inst = learning.capture({intent:'edit parser'}, {action:'save+test', outcome:'pass'});
// → confidence 0.3 (lần đầu) → gặp lại 0.4 → ... → 2 project → global
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Học nguyên tử (mỗi tool-call → instinct cụ thể) | ❌ Instinct bùng nổ (nhiều → noise) |
| ✅ Confidence thực tế (tăng dần, không binary) | ❌ Promotion false (2 project tình cờ → global sai) |
| ✅ Scope thông minh (project→global khi phổ biến) | ❌ Decay tuning (rate chủ quan) |
| ✅ Cross-project generalization (global instinct tái dùng) | ❌ Recall precision (trigger match có thể mơ hồ) |

## Khác các hướng gần

| | TD Failure-Lesson | Auto-save each turn | UB: Instinct-Learning |
|---|---|---|---|
| Cái gì | Fail → lesson | Lưu mọi thứ | **Tool-call → atomic instinct + confidence** |
| Trigger | Failure only | Mỗi turn | **Mỗi tool-call (Pre+Post)** |
| Confidence | ❌ | ❌ | **0.3–0.9 decay/rise** |

## Khi nào chọn

- Agent dùng tool lặp pattern → muốn học thủ tục (cách dùng tool hiệu quả)
- Muốn confidence thực tế (không binary remember/forget)
- Cần cross-project generalization (instinct phổ biến → global)
- Nối packages/tools dispatch.ts + packages/memory learning-graph.ts + brain-store + packages/audit trust.ts; guard instinct bùng nổ (dedup, decay pruner), promotion precision (yêu cầu outcome consistent cross-project, không chỉ count), và recall noise (confidence threshold + scope filter); UB = instinct continuous learning, kết hợp 547 UA memory-persistence-hooks (instinct persist qua lifecycle) + 550 UD self-eval (instinct quality check)
