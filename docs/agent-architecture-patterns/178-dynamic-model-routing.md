# Hướng FV: Dynamic Model Routing & Cascading — mỗi request chọn model rẻ nhất đủ tốt

> **Nguồn gốc:** Zylos "AI Agent Model Routing" (dynamic routing giảm 40-85% inference cost, giữ 90-95% quality); arXiv 2603.04445 "Dynamic Model Routing and Cascading" (balancing competing objectives cho hiệu quả); AWS "Multi-LLM Routing Strategies" (static vs dynamic); digitalapplied "LLM Model Routing 2026" (route mỗi request tới model rẻ nhất xử lý được — cắt 40-85% bill); TrueFoundry (dynamic routing rules theo real-time metrics + budget)
> **Coupling:** 🟡 — các thành phần gọi model phải qua router
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (multi-model + GGG routing sẵn; thiếu cascade + adaptive)
> **Effort:** 2-4 tuần

## Nguồn gốc

Dynamic routing: **không dùng 1 model cho mọi request — chọn model cho từng request theo độ khó/cost/quality** — Zylos: "dynamic model routing reduces inference cost by 40-85% while maintaining 90-95% of the quality of the most capable model"; arXiv 2603.04445: "effective multi-LLM routing requires balancing competing objectives" (giá, chất lượng, latency); AWS: static vs dynamic routing; digitalapplied: "route each request to the cheapest model that can handle it — cuts real LLM bills 40-85% with no visible quality loss"; TrueFoundry: "dynamic routing rules that adapt to real-time performance metrics, ensuring each request meets budget". Điểm khác **GGG routing** (chọn agent/service theo task — đã có) — WWWWWWW *chọn model tinh vi hơn*: (1) difficulty estimate — ước độ khó request (simple → model nhỏ); (2) cascade — chạy model rẻ trước, không đủ tin → gọi model lớn hơn (escalate — cascade arXiv); (3) adaptive — đo thực tế theo thời gian thực (TrueFoundry — success rate per model), học lên (LLM-Advisor score-based optimization — SSRN); (4) budget-aware — request có budget (LLLLLLL) → không vượt; (5) routing policy — quy tắc: task nào model nào (rule/classifier), fallback model lớn cho task khó đã biết; (6) metric — cost tiết kiệm + quality (PP so benchmark, AAAAAA). Nối GGG (nền — routing), LLLLLLL (budget), 147 (học từ data thực), PP (đo quality), KKKKKKK (cache — trước routing), RRRRRRR (A/B chọn policy routing).

## Kiến trúc

```
  REQUEST
        │
        ▼
  ROUTER (policy + difficulty estimate — digitalapplied)
   · task khó biết → model lớn ngay (quy tắc)
   · request đơn giản → model rẻ (có thể xử lý được)
        │
        ├── CASCADE (arXiv 2603.04445): model rẻ → chưa đủ tin? → escalate model lớn
        ├── ADAPTIVE (TrueFoundry): real-time success per model → học (LLM-Advisor)
        └── BUDGET (LLLLLLL): không vượt ngân sách request
        │
        ▼
  METRIC (PP benchmark + AAAAAA): 40-85% cost · 90-95% quality (Zylos)
```

```
mya: multi-model + GGG SẴN — thiếu: cascade + adaptive + budget routing
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ multi-model — có nhiều model provider (nền)
// ✅ GGG routing — chọn theo task/service (mở rộng xuống model)
// ✅ LLLLLLL budget — ngân sách per task (routing constraint)
// ✅ PP eval — đo quality (so model/policy)
// ✅ KKKKKKK cache — trước routing (giảm call)
// ✅ 147 + RRRRRRR — học + A/B policy routing

// ❌ THIẾU: difficulty estimate (độ khó → chọn model)
// ❌ THIẾU: cascade (escalate nếu model rẻ không đủ tin)
// ❌ THIẾU: adaptive routing (real-time metrics — TrueFoundry)
```

## Implementation

```typescript
// packages/router/src/model.ts (NEW)
export class ModelRouter {
  async route(req: LlmRequest): Promise<Model> {
    if (req.known) return pick(req.known);             // quy tắc — task khó biết
    const cheap = cheapest(req);                        // digitalapplied: rẻ nhất xử lý được
    const res = await cheap.call(req);
    return res.confident(THRESHOLD) ? res : escalate(req); // cascade (arXiv 2603.04445)
  } // adaptive: learn(successPerModel, realTime) — TrueFoundry/LLM-Advisor
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ 40-85% cost giảm, 90-95% quality giữ (Zylos) | ❌ Difficulty estimate sai → trả kết quả tệ |
| ✅ Cascade — rẻ trước, thêm lớn khi cần (arXiv) | ❐ Cascade = latency thêm (2 lần gọi) |
| ✅ Adaptive — học theo thực tế (TrueFoundry) | ❌ Policy phức tạp — bảo trì |
| ✅ Xây trên GGG + LLLLLLL + KKK | ❌ Model rẻ "đùa" — cần confidence check tin cậy |

## Khác các hướng gần

| | GGG Routing | KKK Cache | WWWWWWW: Model Router |
|---|---|---|---|
| Đối tượng | Service/agent | Kết quả LLM | **Model LLM** |
| Cơ chế | Theo task | Reuse | **Cascade + adaptive + budget** |
| Quan hệ | Nền | Giảm call | **Chọn rẻ nhất đủ tốt (Zylos)** |

## Khi nào chọn

- Chi phí LLM cao — nhiều request dễ/chỉ cần model nhỏ
- Nhiều model/provider trong pool (multi-model)
- Cần giữ chất lượng — cascade + adaptive đảm bảo
- Đã có GGG + KKK + LLLLLLL — thêm cascade + difficulty