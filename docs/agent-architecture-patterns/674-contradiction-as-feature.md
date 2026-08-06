# Hướng YX: Contradiction as Feature — 3 loại mâu thuẫn (temporal/domain/intrinsic-tension) được giữ nguyên, không flatten — người thật mâu thuẫn là đặc tính, không phải bug
> **Nguồn gốc:** awesome-human-distillation (FINDINGS.md) | **Coupling:** 🟡 — thêm contradiction taxonomy vào memory/conflict pipeline | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (memory/conflict.ts detect mâu thuẫn — chưa có 3-class taxonomy + retention policy) | **Effort:** 2 tuần

## Nguồn gốc

**awesome-human-distillation** khi chưng cất persona từ dữ liệu người thật nhận ra: người thật **mâu thuẫn** — nói một đằng làm một nẻo, thích A lúc sáng ghét A lúc tối. Các pipeline naive **flatten** (gộp/trung hòa) mâu thuẫn → persona thành "người máy nhất quán", mất chiều sâu. Giải pháp: phân loại mâu thuẫn thành 3 loại và **giữ nguyên** (không resolve): (1) **temporal contradiction** — khác theo thời gian (quan điểm thay đổi theo kinh nghiệm); (2) **domain contradiction** — khác theo ngữ cảnh (strict ở công sở, thoải mái ở nhà); (3) **intrinsic tension** — căng thẳng nội tại cố hữu (muốn an toàn nhưng thích mạo hiểm). Nguyên tắc: **mâu thuẫn của người thật là đặc tính (feature), không phải bug** — persona giữ được tính người.

## Mô tả

mya contradiction-as-feature: (1) **Classifier 3 loại**: mỗi mâu thuẫn detect được → gán temporal/domain/intrinsic-tension. (2) **Retention policy**: temporal → lưu kèm timestamp + context (không overwrite); domain → lưu kèm scope/tag domain; intrinsic → lưu như tension pair (cả 2 vế, không chọn 1). (3) **No flatten**: memory pipeline không merge/trung hòa — giữ cả 2 ghi nhận, đánh dấu contradiction. (4) **Use**: khi assemble prompt, mâu thuẫn được trình bày có nhãn (vd "theo ngữ cảnh work vs home") thay vì chọn 1. mya có memory/conflict.ts (`detectContradictions`, `checkAndResolveConflicts`) — YX thêm **3-class taxonomy** + **retention policy** + **labeled rendering**.

## Kiến trúc

```
  MEMORY WRITE PATH (2 facts trái ngược cùng topic)
  ┌─────────────────────────────────────────────────────────┐
  │  fact A: "thích remote work"   fact B: "cần văn phòng"   │
  │  └─ detectContradictions() → pair (A, B)                  │
  └─────────────────────────┬───────────────────────────────┘
                            ▼
  ┌─── CLASSIFY 3 LOẠI ────────────────────────────────────┐
  │  temporal         → { kind, tsA, tsB, context }          │
  │  domain           → { kind, scopeA, scopeB }             │
  │  intrinsic-tension→ { kind, poles: [A, B] }              │
  └─────────────────────────┬───────────────────────────────┘
                            ▼
  ┌─── RETENTION (không flatten) ──────────────────────────┐
  │  lưu CẢ 2 fact + marker contradiction:{kind, meta}       │
  │  không merge, không xóa vế nào                          │
  └─────────────────────────┬───────────────────────────────┘
                            ▼
  ┌─── PROMPT RENDER (có nhãn) ────────────────────────────┐
  │  "[domain: work] thích remote"                           │
  │  "[domain: home] cần văn phòng"                          │
  │  → agent hiểu đây là tension, không phải lỗi dữ liệu      │
  └─────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/memory conflict.ts — detectContradictions (detect cặp mâu thuẫn, nền — YX classify sau detect)
// ✅ packages/memory conflict.ts — checkAndResolveConflicts (resolve pipeline, nền — YX thêm "keep" policy)
// ✅ packages/memory governance.ts — detectContradictions (nền — YX reuse)
// ✅ packages/memory retrieve.ts — retrieval (nền — YX render labeled)

// ❌ THIẾU: 3-class taxonomy (temporal/domain/intrinsic-tension)
// ❌ THIẾU: retention policy per class (không flatten khi resolve)
// ❌ THIẾU: labeled rendering (prompt hiện cả 2 vế + nhãn scope/time)
```

## Implementation

```typescript
// packages/memory/src/contradiction-classes.ts (MỚI)

type ContradictionKind = "temporal" | "domain" | "intrinsic-tension";

interface ContradictionClass {
  kind: ContradictionKind;
  a: string; b: string;
  meta: { tsA?: number; tsB?: number; scopeA?: string; scopeB?: string };
}

// Classify cặp mâu thuẫn theo meta có sẵn
function classifyContradiction(a: string, b: string, meta: {
  tsA?: number; tsB?: number; scopeA?: string; scopeB?: string;
}): ContradictionClass {
  if (meta.scopeA && meta.scopeB && meta.scopeA !== meta.scopeB) {
    return { kind: "domain", a, b, meta };          // khác ngữ cảnh
  }
  if (meta.tsA !== undefined && meta.tsB !== undefined && meta.tsB - meta.tsA > 30 * 24 * 3600_000) {
    return { kind: "temporal", a, b, meta };        // cách > 30 ngày
  }
  return { kind: "intrinsic-tension", a, b, meta }; // tension cố hữu
}

// Retention: KHÔNG flatten — lưu cả 2 vế kèm class
function retainContradiction(
  store: Map<string, { text: string; class?: ContradictionClass }>,
  key: string, a: string, b: string, meta: Parameters<typeof classifyContradiction>[2],
): void {
  store.set(key + ":a", { text: a, class: classifyContradiction(a, b, meta) });
  store.set(key + ":b", { text: b, class: classifyContradiction(a, b, meta) });
  // không merge, không ghi đè — giữ nguyên 2 vế
}

// Render có nhãn cho prompt
function renderContradictions(store: Map<string, { text: string; class?: ContradictionClass }>): string[] {
  const out: string[] = [];
  for (const { text, class: c } of store.values()) {
    if (!c) { out.push(`- ${text}`); continue; }
    const tag = c.kind === "temporal" ? `[temporal:${new Date(c.meta.tsB!).toISOString()}]`
      : c.kind === "domain" ? `[domain:${c.meta.scopeB}]` : `[tension]`;
    out.push(`- ${tag} ${text}`);
  }
  return out;
}
// Usage:
// retainContradiction(store, "work-style", "thích remote", "cần văn phòng", { scopeA: "work", scopeB: "home" });
// renderContradictions(store); // → "[domain:home] cần văn phòng" — không flatten
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Persona giữ tính người (mâu thuẫn là chiều sâu) | ❌ Prompt dài hơn (cả 2 vế + nhãn) |
| ✅ Không mất context (temporal/domain giữ metadata) | ❌ Classifier sai → nhãn gây hiểu lầm |
| ✅ Intrinsic tension thành tính cách (không resolve vội) | ❌ Retention phức tạp (không overwrite đơn giản) |
| ✅ Agent hiểu mâu thuẫn = feature, không repair nhầm | ❌ Retrieval phải xử lý cặp, không chỉ 1 fact |

## Khác các hướng gần

| | Flatten (resolve) | Conflict detect-only | YX: Contradiction-as-Feature |
|---|---|---|---|
| Xử lý mâu thuẫn | Merge/trung hòa | Detect + báo | **Giữ nguyên + phân lớp + nhãn** |
| Context | ❌ mất | ⚠️ | **✅ temporal/domain meta** |
| Rendering | 1 vế | raw | **Labeled 2 vế** |

## Khi nào chọn

- Memory lưu persona/kiến thức người dùng có mâu thuẫn thật
- Không muốn pipeline tự resolve (mất chiều sâu dữ liệu)
- Agent cần hiểu tension (vd domain-based behavior) thay vì repair
- Nối packages/memory conflict.ts + governance.ts + retrieve.ts + prompts/assembler; guard classifier-quality (đủ meta để classify đúng), retention-policy (class nào giữ/class nào expire), và render-clarity (nhãn rõ, không gây confusion); YX = contradiction as feature, kết hợp packages/memory conflict.ts (detect nền) + 684 ZH quality-convergence (đo chất lượng phân lớp)
