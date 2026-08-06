# Hướng YU: Triple Verification Gate — trước khi công nhận mental model: cross-domain recurrence (≥2 domain) + generativity (dự đoán stance mới) + exclusivity — filter epistemic chống bloat "tips ai cũng nói" (FINDINGS.md)

> **Nguồn gốc:** awesome-human-distillation (FINDINGS.md) | **Coupling:** 🟢 — filter logic, không đổi runtime | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có memory + governance — chưa có epistemic gate) | **Effort:** 2-3 tuần

## Nguồn gốc

**awesome-human-distillation** khi tổng hợp "mental model" từ nhiều nguồn phải qua **triple verification gate** — 3 tiêu chí epistemic trước khi công nhận một model là đáng lưu: (1) **cross-domain recurrence** — pattern xuất hiện ở ≥ 2 domain (không phải ngẫu nhiên một chỗ); (2) **generativity** — model dự đoán được stance mới chưa từng thấy (không chỉ mô tả lại cái đã có); (3) **exclusivity** — model có giá trị riêng, không trùng "tips ai cũng nói". Mục đích: **filter epistemic chống bloat** — memory không nhét đầy chân lý hiển nhiên vô dụng.

## Mô tả

mya áp dụng triple-verification-gate: khi auto-capture (memory/auto-capture) hoặc curator đề xuất một "mental model / insight" mới, trước khi vào store chạy **3 check**: (1) **recurrence**: model xuất hiện ở bao nhiêu domain trong memory? ≥ 2 → pass; (2) **generativity**: model có dự đoán được stance/trả lời mới không — test bằng cách hỏi model áp vào case chưa thấy? (dùng LLM hoặc heuristic: model có dạng quy tắc áp dụng được không, không chỉ mô tả); (3) **exclusivity**: model khác gì pattern đã có — độ tương đồng embedding/thẻ thấp → pass. Pass 3/3 → lưu; fail → reject (hoặc hạ cấp thành "observation" không phải "model"). mya có sẵn memory/auto-capture (bắt pattern), graph (knowledge graph), embeddings (đo tương đồng), governance (kiểm soát memory) — YU thêm **epistemic gate** + **hạ cấp rule**.

## Kiến trúc

```
  Insight mới (auto-capture / curator đề xuất)
       │
       ▼
  TRIPLE GATE:
    ├─ 1. CROSS-DOMAIN RECURRENCE: xuất hiện ở ≥ 2 domain?
    │       → đếm domain trong memory (graph query)
    ├─ 2. GENERATIVITY: dự đoán được stance/case mới?
    │       → áp model vào case chưa thấy (LLM check / heuristic)
    └─ 3. EXCLUSIVITY: khác pattern đã có?
            → embedding similarity thấp (memory/embeddings)
       │
       ▼
  Pass 3/3 → lưu là "model" (tier cao)
  Fail 1-2 → hạ cấp "observation" (tier thấp, decay nhanh hơn)
  Fail 3/3 → reject — "tips ai cũng nói" không vào store
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/memory auto-capture.ts — bắt pattern từ conversation (nền — YU input)
// ✅ packages/memory graph.ts — knowledge graph (nền — YU domain recurrence query)
// ✅ packages/memory embeddings.ts — đo tương đồng (nền — YU exclusivity)
// ✅ packages/memory governance.ts — kiểm soát memory (nền — YU gate chạy trong governance)
// ✅ packages/memory weibull.ts — decay theo loại (nền — YU hạ cấp tier)

// ❌ THIẾU: triple gate (recurrence/generativity/exclusivity checks)
// ❌ THIẾU: hạ cấp rule (model → observation khi fail 1-2)
```

## Implementation (TS)

```typescript
// packages/memory/src/epistemic-gate.ts (MỚI)
export interface Insight {
  id: string;
  text: string;
  domains: string[];   // nơi pattern xuất hiện
  embedding?: number[];
}

export interface GateResult {
  pass: boolean;
  tier: "model" | "observation" | "rejected";
  reasons: string[];
}

export class TripleGate {
  constructor(
    private similarity: (a: number[], b: number[]) => number, // embeddings
    private existingEmbeddings: number[][],
  ) {}

  private recurrence(insight: Insight): boolean {
    return new Set(insight.domains).size >= 2; // ≥ 2 domain
  }

  private generativity(insight: Insight): boolean {
    // heuristic: model có dạng quy tắc áp dụng được (if/then, "khi X thì Y")
    return /\b(khi|nếu|thì|always|never|when)\b/i.test(insight.text);
  }

  private exclusivity(insight: Insight, threshold = 0.85): boolean {
    if (!insight.embedding) return true; // không đo được → không chặn
    return !this.existingEmbeddings.some((e) => this.similarity(insight.embedding!, e) >= threshold);
  }

  gate(insight: Insight): GateResult {
    const reasons: string[] = [];
    const r = this.recurrence(insight); if (!r) reasons.push("recurrence: chỉ 1 domain");
    const g = this.generativity(insight); if (!g) reasons.push("generativity: không dự đoán case mới");
    const x = this.exclusivity(insight); if (!x) reasons.push("exclusivity: trùng pattern đã có");

    if (r && g && x) return { pass: true, tier: "model", reasons };
    if (reasons.length <= 2) return { pass: false, tier: "observation", reasons }; // hạ cấp, không reject
    return { pass: false, tier: "rejected", reasons }; // "tips ai cũng nói"
  }
}

// Usage:
// const gate = new TripleGate(cosineSimilarity, existing);
// const r = gate.gate({ id, text: "Khi API trả 429, hãy backoff rồi retry", domains: ["web", "ai"], embedding });
// r.tier === "model"      → lưu tier cao (decay chậm)
// r.tier === "observation" → lưu tier thấp (decay nhanh — weibull)
// r.tier === "rejected"    → không vào store
```

## Được

- ✅ Chống bloat epistemic — "tips ai cũng nói" không vào memory
- ✅ 3 tiêu chí rõ — recurrence/generativity/exclusivity đo được
- ✅ Hạ cấp mềm — fail 1-2 thành observation, không mất thông tin
- ✅ Tái dùng memory có sẵn — graph (domain), embeddings (similarity), weibull (decay)
- ✅ Tier phân biệt — model bền, observation decay nhanh

## Mất

- ❌ Generativity heuristic hời — regex không bắt được model dạng narrative
- ❌ Domain đếm sai — cùng domain đổi tên bị tính 2 lần
- ❌ Exclusivity ngưỡng — threshold 0.85 tùy chỉnh, embedding chất lượng quyết định

## Khác các hướng gần

| | Lưu mọi insight | Dedup bằng hash | YU: Triple Gate |
|---|---|---|---|
| Tiêu chí | không | trùng text | **3 tiêu chí epistemic** |
| Bloat | cao | trung bình | **thấp (reject/hạ cấp)** |
| Tier | không | không | **model/observation/rejected** |

## Khi nào chọn

- Memory mya bị bloat bởi insight tầm thường lặp lại
- Muốn phân biệt model đáng tin (nhiều domain, dự đoán được) vs observation
- Có auto-capture + graph + embeddings + weibull sẵn — YU thêm gate
- Nối packages/memory auto-capture.ts (input) + graph.ts (domain count) + embeddings.ts (exclusivity) + weibull.ts (decay theo tier); guard domain-canonical (chuẩn hóa tên domain — không đếm trùng), threshold-calibration (similarity threshold theo golden set), và gate-review (model bị reject oan — log + curator xem lại); YU = epistemic gate, kết hợp 673 YW honest-limits-mandate (model phải kèm giới hạn) + 672 YV expression-dna (đo phong cách nguồn) + 671 kế tiếp YU trong cùng batch
