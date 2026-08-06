# Hướng DN: Error Analysis — phân tích failure có hệ thống thay vì vá từng lỗi

> **Nguồn gốc:** "Why Do Multi-Agent LLM Systems Fail?" (Cemri, 602 cites); ErrorProbe (ACL 2026 findings); Confident AI error analysis guide
> **Coupling:** 🟢 — tầng phân tích, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (trace/eval sẵn; thiếu triage framework)
> **Effort:** 1-2 tuần

## Nguồn gốc

LLM error analysis: **gom failure, phân loại, tìm root cause có hệ thống** — không vá từng lỗi rời. Cemri "Why Do Multi-Agent LLM Systems Fail?" (602 cites): framework phân tích MAS failures — **2 primary failure categories** (cognitive — hiểu/suy luận sai; context — thiếu/đặt context sai) + phân tầng; ErrorProbe (ACL 2026 findings): "self-improving framework for **semantic failure attribution** — identifies responsible agents and originating error"; Confident AI: 6 steps error analysis — "collect failures in one place, read the judge's reasoning not just the score"; SSRN taxonomy failure modes: "validation fails → return structured error feedback rather than silent failure". Khác **BBBBB self-improve** (tự sửa tự động) — OOOOO là *hiểu vấn đề trước* (analysis → quyết định sửa gì); khác **JJJJJ tool bench** (đo tool) — OOOOO phân tích *mọi loại fail* của task.

## Mô tả

mya error-analysis layer (nightly — cron + nền eval): (1) **collect** — mọi task fail (SSSS evals, ZZZZ drift, QQQQ trace thật, user complaint) gom 1 chỗ (Confident step 1); (2) **cluster** — phân nhóm fail giống nhau (embedding + LLM — theo root cause nghi ngờ); (3) **classify theo taxonomy** — Cemri 2 nhóm (cognitive: hiểu sai task/hiểu sai output; context: thiếu context/tool sai context) + nhánh (prompt/example/tool/memory/handoff...); (4) **attribution** — ErrorProbe: agent nào chịu trách (EEEEE credit ngược — blame); (5) **root-cause report** — không chỉ score (Confident: read judge reasoning) → đề xuất fix đúng loại: prompt (P), skill (YY), memory (MM), tool (HHHHH), gate (SSSS), cấu trúc (IIII); (6) **feed** — vào BBBBB (fix), NNNNN (regression case). Tránh: phân tích mà không hành động (vòng họp).

## Kiến trúc

```
  FAILURE POOL: SSSS evals · ZZZZ drift · QQQQ trace thật · user complaint
        │
        ▼
  (1) COLLECT (1 chỗ — Confident step 1)
  (2) CLUSTER (nhóm fail giống nhau — embedding + LLM)
  (3) CLASSIFY (taxonomy Cemri 602 cites)
       ├─ COGNITIVE: hiểu sai task · hiểu sai output · suy luận
       └─ CONTEXT: thiếu context · sai context · tool context
  (4) ATTRIBUTE (ErrorProbe ACL 2026 — agent chịu trách — EEEEE blame)
  (5) ROOT-CAUSE REPORT (đọc judge reasoning — không chỉ score)
        │
        ▼
  (6) FEED: BBBBB fix · NNNNN regression case · HHHHH tool · IIII cấu trúc
```

```
mya: trace + eval + audit SẸN — thiếu: pool + cluster + taxonomy + report
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ QQQQ trace + SSSS evals + ZZZZ drift — nguồn fail
// ✅ EEEEE credit — attribution (blame ngược)
// ✅ BBBBB — nhận đề xuất fix
// ✅ GGGG judge reasoning — đọc lý do (không chỉ score)
// ✅ NNNNN — thêm case regression từ fail
// ✅ HHHHH/IIII — fix tool/cấu trúc

// ❌ THIẾU: failure pool chuẩn (1 chỗ)
// ❌ THIẾU: cluster + classify theo taxonomy
// ❌ THIẾU: root-cause report pipeline (định kỳ)
```

## Implementation

```typescript
// packages/eval/src/error-analysis.ts (NEW)
type FailureClass =
  | "cognitive-misunderstand"      // Cemri: hiểu sai task/output
  | "cognitive-reasoning"
  | "context-missing"              // thiếu context
  | "context-misplaced"            // tool/sai context
  | "handoff" | "tool" | "memory";

function analyze(pool: Failure[]): AnalysisReport {
  const clusters = clusterBySimilarity(pool);         // embedding + LLM
  return clusters.map((c) => ({
    class: classifyByTaxonomy(c),                     // Cemri 602 cites
    agent: attributeBlame(c),                         // ErrorProbe ACL 2026
    rootCause: readJudgeReasoning(c),                 // Confident step 2
    fix: proposeFix(c.class),                         // → BBBBB/NNNNN/HHHHH
  }));
}
// định kỳ (cron) — report → triage (CCC) → hành động đúng loại
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Sửa theo root cause — không vá lỗi (Cemri) | ❐ Cluster/classify bằng LLM — có thể nhầm nhóm |
| ✅ Failure pool 1 chỗ — nhìn bức tranh tổng | ❌ Report mà không action = phí (phải feed BBBBB) |
| ✅ Attribution (ErrorProbe) — biết sửa ai | ❌ Phân tích định kỳ tốn chi phí (cron, model rẻ) |
| ✅ Nối toàn bộ eval/trace/improve | ❌ Taxonomy cần calibrate theo domain |

## Khác các hướng gần

| | ZZZZ Drift | EEEEE Credit | OOOOO: Analysis |
|---|---|---|---|
| Vấn đề | Suy giảm theo t | Ai đóng góp | **Fail thuộc loại nào, gốc đâu** |
| Cơ chế | Golden định kỳ | Attribution | **Pool + cluster + taxonomy** |
| Mối quan hệ | 1 nguồn fail | Blame ngược | **Tổng hợp + định hướng fix** |

## Khi nào chọn

- Nhiều fail rải rác khó thấy gốc (nhìn chung)
- Muốn sửa đúng nhóm vấn đề (BBBBB có định hướng)
- Đã có trace + eval + credit — thêm analysis layer
- Sẵn sàng pipeline định kỳ (cron) + hành động