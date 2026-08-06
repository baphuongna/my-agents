# Hướng EV: Intent Router — phân lớp ý định user rồi chuyển đúng agent

> **Nguồn gốc:** NVIDIA AI-Q Intent Classifier Blueprint ("3 roles 1 LLM call: intent classification + meta response + depth"); Tian Pan "The Intent Classification Layer Most Agent Routers Skip" 2026 (417 tools → 20% accuracy khi không có layer); Zep "Semantic Similarity as Intent Router"; WonderLab "Intent Recognition and Routing"
> **Coupling:** 🟢 — thêm lớp phân lớp trước, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (routing RR + tool registry sẵn; thiếu intent layer + semantic router)
> **Effort:** 1-2 tuần

## Nguồn gốc

Intent router: **phân lớp ý định user trước, rồi chuyển tới agent/tool đúng** — Tian Pan 2026: "Most agent routers load every tool schema on every request and let the LLM decide. At 417 tools, that approach collapses to 20% accuracy" — đây là vấn đề kinh điển; NVIDIA AI-Q: "The Intent Classifier performs three roles in one LLM call: intent classification, meta response generation, depth" — hợp nhất phân lớp + trả lời ngay + độ sâu (hỏi thêm hay làm luôn); Zep: "a fast and effective intent router using a simple in-memory vector store + embeddings"; WonderLab: "Intent routing gives each request to the agent best equipped to handle it — determine what the user actually wants". Điểm khác **RR routing** (chọn agent theo tag/task) — WWWWWW *phân lớp ý định tường minh*: user nói gì (ý định), cần agent nào, cần hỏi thêm không. Tách khỏi việc nạp hết tool schema mỗi lần (chống rối 417 tools). Nối RR (routing — chuyển tiếp sau intent), NNN (tool registry — đích), SS (hỏi thêm vs làm luôn — chi phí), KK (chia task nếu nhiều ý định), KKKKKK (prefs — intent theo người).

## Mô tả

mya intent router: (1) **phân lớp tường minh** — mỗi request: intent = { loại hành động, độ phức tạp, gấp, agent phù hợp, cần hỏi thêm không } — 1 LLM call gọn (NVIDIA AI-Q 3-role); (2) **semantic router** — vector embed intent template (Zep): match nhanh + rẻ (không cần LLM mỗi lần) → LLM chỉ cho intent lạ; (3) **giảm tải tool schema** — thay vì nạp 417 tools, nạp subset theo intent (chống collapse 20% — Tian Pan); (4) **meta response** — intent rõ + đủ thông tin → làm luôn (depth=execute); intent mơ hồ → hỏi thêm 1 câu (depth=clarify — tránh tốn vô ích SS); (5) **multi-intent** — 1 request nhiều việc → tách (KK) rồi route từng cái (RR); (6) **học** — intent misroute (user đính chính "tôi không hỏi cái đó") → cập nhật template/intent map (III learning + RRRRRR flywheel).

## Kiến trúc

```
  REQUEST ──► INTENT LAYER (NVIDIA AI-Q 3-role 1 call)
        │  intent = { loại · phức tạp · gấp · agent phù hợp · depth }
        ▼
  SEMANTIC ROUTER (Zep — vector embed): match nhanh/rẻ → LLM chỉ intent lạ
        │
        ▼
  DEPTH: rõ đủ → execute · mơ hồ → clarify (hỏi 1 câu — SS)
        │
        ▼
  NẠP TOOL SUBSET THEO INTENT (Tian Pan — chống rối 417 tools → drop 20%)
        │
        ▼
  ROUTE (RR): → agent phù hợp · multi-intent → tách (KK)
        │
        ▼
  HỌC: misroute → user sửa → intent map cập nhật (III + flywheel)
```

```
mya: RR + NNN SẸN — thiếu: intent layer + semantic router + depth (clarify/execute)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ RR routing — chọn agent/tool (bước sau intent)
// ✅ NNN tool registry — danh mục (nạp subset theo intent)
// ✅ SS cost gate — quyết định clarify vs execute (tránh tốn)
// ✅ KK mapreduce — tách multi-intent
// ✅ III learning — học misroute qua chỉnh sửa
// ✅ RRRRRR flywheel — cập nhật intent template

// ❌ THIẾU: intent layer (phân lớp tường minh — 3-role)
// ❌ THIẾU: semantic router (vector — Zep)
// ❌ THIẾU: tool subset selection theo intent
```

## Implementation

```typescript
// packages/intent/src/router.ts (NEW)
export class IntentRouter {
  async route(req: Request): Promise<Plan> {
    const fast = semanticMatch(req, this.templates);       // Zep — vector, rẻ
    const intent = fast.confident ? fast : await llm(req); // LLM chỉ intent lạ
    const depth = intent.unclear ? "clarify" : "execute"; // NVIDIA depth
    const tools = registry.subset(intent.kind);           // Tian Pan — không nạp hết
    return { intent, depth, tools, agent: rr.pick(intent) }; // R
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chính xác hơn khi nhiều tools (417 → 20% nếu không có — Tian Pan) | ❌ Thêm layer — latency nhẹ mỗi request |
| ✅ Semantic router nhanh/rẻ (Zep) — LLM chỉ xử lý intent lạ | ❐ Intent lạ/sai — cần fallback + học |
| ✅ Depth: không tốn khi mơ hồ (hỏi thay vì làm bừa — SS) | ❌ Template intent cần duy trì (RRRRRR học) |
| ✅ Xây trên RR + NNN | ❌ Multi-intent phức tạp — tách chưa đủ |

## Khác các hướng gần

| | RR Routing | XXXX Select Tools | WWWWWW: Intent |
|---|---|---|---|
| Bước | Sau intent | Trong turn | **Trước tiên — phân lớp ý định** |
| Cơ chế | Chọn agent | Embed + top-k | **LLM 3-role + semantic vector + depth** |
| Quan hệ | Đích route | Kết quả | **Đầu vào của cả 2** |

## Khi nào chọn

- Nhiều tool/agent — LLM tự chọn bị rối (417 tools collapse — Tian Pan)
- Request mơ hồ thường xuyên — cần phân lớp + hỏi thêm trước
- Cần route nhanh/rẻ cho intent quen (semantic vector)
- Đã có RR + NNN + SS — thêm intent layer + depth