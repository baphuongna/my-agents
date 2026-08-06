# Hướng JP: Procedural Memory — lưu "cách làm" (quy trình/thủ tục) tái dùng, không chỉ fact

> **Nguồn gốc:** Anderson ACT-R cognitive architecture (declarative vs procedural memory); Tulving memory taxonomy (episodic/semantic/procedural); "procedural memory = how-to knowledge, skills, motor sequences"; LangChain "skills/procedures" agents; Voyager (Minecraft) "skill library" (agent học skill, lưu tái dùng); Robust fill procedural memory; ACT-R production rules
> **Coupling:** 🟡 — thêm procedural store + recall vào memory layer
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (hierarchical memory FI sẵn — chưa tách procedural store)
> **Effort:** 2-4 tuần

## Nguồn gốc

Procedural memory (Anderson ACT-R, Tulving): khác với *declarative* (fact/sự kiện) — procedural lưu **"how-to"** — quy trình, kỹ năng, chuỗi bước (vd "để deploy: build→test→tag→push"). ACT-R biểu diễn production rules (IF condition THEN action). Cognitive: procedural được học qua *lặp* (practice) → automatized. Voyager (Minecraft agent): agent khám phá, viết code skill → lưu "skill library" → task sau recall tái dùng, không học lại từ đầu. Khác **AL (38) memory management / FI (165) hierarchical** (lưu mọi loại trong phân cấp) — JP *tách riêng* procedural làm store riêng, index theo *mục đích* không phải nội dung; khác **82 CD consolidation** (sắp xếp khi "ngủ") — JP là *loại nhớ cụ thể*; khác **224 HP knowledge editing** (sửa fact semantic) — JP sửa *quy trình*; khác **EL (142) skill marketplace** (chia sẻ skill giữa org) — JP là *store nội bộ cá nhân agent*.

## Mô tả

mya procedural memory: khi agent hoàn thành task nhiều bước thành công → rút thành procedure (mục đích + precondition + steps + tools + expected outcome). Lần sau gặp mục đích tương tự → recall procedure → chạy/trích dẫn thay vì suy luận lại. Store riêng, index theo mục đích + precondition (không phải vector nội dung thuần). Có version + success-rate (học qua lặp — Consolidation 82). mya có hierarchical memory (FI) — procedural chưa tách rõ, thường trộn vào semantic/episodic.

## Kiến trúc

```
  TASK SUCCESS (multi-step)
        │
        ▼
  EXTRACT PROCEDURE
   { goal, preconditions, steps[], tools[], expected, version, successRate }
        │
        ▼
  PROCEDURAL STORE (index theo goal+precondition, KHÔNG chỉ vector)
        │
  ▲───────────────────────────────────────▲
  │ recall                                │ consolidation (82 — luyện, sửa, version)
  │                                       │
  NEW TASK (goal tương tự)                 │
        │                                  │
        ▼                                  │
  MATCH (goal + precondition) ──► PROCEDURE ──► RUN / CITE (không suy luận lại)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ FI (165) hierarchical memory — working/episodic/semantic/procedural (có khái niệm)
// ✅ AL (38) memory management — 3-tier (nền)
// ✅ 82 CD consolidation — sắp xếp/kết tinh khi "ngủ" (sẵn)
// ✅ DA (105) self-improving — tích lũy năng lực (sẵn)
// ✅ CJ (88) graph+vector memory — recall (nền)

// ❌ THIẾU: procedural store riêng (tách khỏi semantic)
// ❌ THIẾU: index theo goal+precondition (không chỉ vector nội dung)
// ❌ THIẾU: version + success-rate tracking (học qua lặp)
// ❌ THIẾU: extract-from-success (rút procedure tự động)
```

## Implementation

```typescript
// packages/proc-mem/src/store.ts (NEW)
interface Procedure {
  id: string; goal: string; preconditions: string[];
  steps: Step[]; tools: string[]; expected: unknown;
  version: number; successRate: number; runs: number;
}
class ProceduralMemory {
  async recall(goal: string, ctx: Ctx): Promise<Procedure | null> {
    const cands = this.index.find(goal, ctx);                 // match goal+precondition
    return cands.filter(p => p.preconditions.every(c => ctx.has(c))
                       && p.successRate > 0.6)                // chỉ recall thủ tục đáng tin
                  .sort((a,b) => b.successRate - a.successRate)[0] ?? null;
  }
  async learn(goal: string, trace: Trace, ok: boolean): Promise<void> {
    const steps = extract(trace);                              // rút từ success
    const p = upsert({ goal, steps, version: bump, successRate: ewma(ok) }); // học qua lặp
    this.index.add(p);
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tái dùng — không suy luận lại (Voyager skill library) | ❌ Procedure lỗi lưu lại → lặp sai (cần success-rate) |
| ✅ Tăng tốc task lặp (deploy, report) | ❌ Trì trệ — bám procedure cũ khi cách mới tốt hơn |
| ✅ Học qua lặp — success-rate tăng dần (ACT-R) | ❌ Extract thủ tục tự động khó (đôi khi sai) |
| ✅ Index theo mục đích — recall chính xác | ❌ Bloated store nếu không dọn (consolidation 82) |

## Khác các hướng gần

| | FI Hierarchical | 82 Consolidation | 224 HP Knowledge-Edit | JP: Procedural |
|---|---|---|---|---|
| Loại | Tất cả (phân cấp) | Sắp xếp/s結晶 | Fact semantic | **How-to / skill** |
| Index | Phân cấp | Theo thời gian | Theo fact | **Theo goal+precondition** |
| Khi nào | Tổng quản | "Ngủ" | Sửa sai fact | **Tái dùng quy trình** |

## Khi nào chọn

- Task lặp nhiều bước (deploy, ETL, report) — worth lưu procedure
- Agent thực hiện nhiều lần cùng loại → học qua lặp có giá trị
- Cần tốc độ — recall procedure nhanh hơn suy luận lại
- Luôn: success-rate + version + consolidation (82) — tránh bám procedure lỗi/cũ
