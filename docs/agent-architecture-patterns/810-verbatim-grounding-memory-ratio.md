# Hướng AED: Verbatim Grounding Memory Ratio — findings grounded bằng quote verbatim, đo bằng ratio

> **Nguồn gốc:** pi-crew-self-distill | **Coupling:** 🟢 — convention khi excavate conventions | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn grounding memory; thiếu ratio metric) | **Effort:** 1 tuần

## Nguồn gốc

**pi-crew-self-distill** yêu cầu mọi **finding** (trong quá trình **excavate conventions** — đào quy ước từ codebase) phải **grounded bằng quote verbatim file:line** — trích nguyên văn kèm đường dẫn + số dòng, không paraphrase. Độ grounded được đo bằng **"memory-ratio 15% (9/60 findings)"** — 60 findings thì chỉ 9 cái có quote verbatim → ratio 15% → không đủ chuẩn, phải đào thêm.

Pattern chống **recall/hallucination**: agent "nhớ" (recall) quy ước mơ hồ hoặc bịa (hallucinate) khi không có bằng chứng. Metric định lượng làm cho việc đánh giá khách quan — không phải "có vẻ grounded" mà là con số: bao nhiêu % findings có quote verbatim.

## Mô tả

Với mya, `packages/memory` đã có **grounding.ts** (nền grounding) và Brain (lưu facts có nguồn). Pattern thêm: **finding format chuẩn** — mỗi finding có `evidence: { file, line, quote }` bắt buộc; **memory-ratio metric** — % findings có quote verbatim (tính khi excavate); **gate** — ratio < ngưỡng (ví dụ 80%) thì chưa được viết guidance. Nối `packages/eval` — ratio là một metric test được; nối ADJ ladder (criteria inspectable — findings là evidence). Gap: chưa có ratio metric + gate.

## Kiến trúc (ASCII)

```
  EXCAVATE CONVENTIONS (đào quy ước từ codebase)
    │
    ▼ FINDING FORMAT (bắt buộc)
  finding = { claim, evidence: { file, line, quote VERBATIM } }
    │
    ▼ MEMORY-RATIO METRIC
  memory-ratio = findings có quote verbatim / tổng findings
  ví dụ: 15% (9/60) → KHÔNG đạt → đào thêm
    │
    ▼ GATE
  ratio ≥ ngưỡng (80%) ──► mới viết guidance
  ratio < ngưỡng      ──► chống recall/hallucination — chưa viết
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/memory/src/grounding.ts — grounding (nền evidence format)
// ✅ packages/memory — Brain facts có nguồn (nền lưu findings)
// ✅ packages/memory/src/governance.ts — governance (nền gate)
// ✅ packages/eval — tiers (nền metric test)
// ✅ packages/tools/src/codegraph.ts — codegraph (tìm file:line nhanh)

// ❌ THIẾU: finding format chuẩn (claim + evidence verbatim)
// ❌ THIẾU: memory-ratio metric (đếm % có quote)
// ❌ THIẾU: gate ratio < ngưỡng → chặn viết guidance
```

## Implementation

```typescript
// packages/memory/src/memory-ratio.ts (NEW)
export interface Finding {
  claim: string;
  evidence?: { file: string; line: number; quote: string };
}

/** quote verbatim: trích NGUYÊN VĂN file:line — không paraphrase */
export function isVerbatim(f: Finding, source: (path: string) => string): boolean {
  if (!f.evidence) return false;
  const lines = source(f.evidence.file).split("\n");
  const actual = lines[f.evidence.line - 1]?.trim();
  return !!actual && actual.includes(f.evidence.quote.trim());
}

export function memoryRatio(findings: Finding[], read: (p: string) => string): number {
  if (findings.length === 0) return 0;
  const grounded = findings.filter((f) => isVerbatim(f, read)).length;
  return Math.round((grounded / findings.length) * 100);
}

export function gateGuidance(findings: Finding[], read: (p: string) => string, threshold = 80): boolean {
  const ratio = memoryRatio(findings, read);
  if (ratio < threshold) {
    // chống recall/hallucination — chưa đủ bằng chứng thì chưa viết guidance
    console.warn(`memory-ratio ${ratio}% < ${threshold}% — excavate thêm`);
    return false;
  }
  return true;
}

// ví dụ: 9/60 findings có quote → ratio 15% → gate chặn
export function exampleCheck(): number {
  const findings: Finding[] = [
    { claim: "dùng retry policy", evidence: { file: "src/x.ts", line: 12, quote: "retry(3)" } },
    { claim: "quy ước tên file", /* thiếu evidence — recall mơ hồ */ },
  ];
  return memoryRatio(findings, () => "export function retry(3) { ... }");
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chống hallucination — bằng chứng bắt buộc | ❌ Quote verbatim cồng kềnh khi viết finding |
| ✅ Metric định lượng, không cảm tính | ❌ Ratio thô — quote đúng nhưng claim sai vẫn đếm |
| ✅ Gate chặn viết guidance thiếu bằng chứng | ❌ File đổi dòng → quote stale |
| ✅ Excavate conventions chất lượng cao hơn | ❌ Tốn thời gian đào thêm khi ratio thấp |

## Khác các hướng gần

| | AED Memory Ratio | ADK Trace | AEC Apply Log |
|---|---|---|---|
| Grounding | Quote verbatim file:line | Hành trình turn | Hàng thay đổi |
| Metric | % findings grounded | Score trace | Verified cột |
| Chống gì | Recall/hallucination | Thiếu context | Thay đổi không verify |

## Khi nào chọn

- Excavate conventions từ codebase — cần bằng chứng thật
- Agent hay paraphrase/recall quy ước sai
- Đã có grounding + governance — thêm ratio metric + gate
- Muốn đánh giá "độ grounded" bằng con số