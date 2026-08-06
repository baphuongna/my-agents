# Hướng XN: Intermediate Results On Disk — Sub-agent ghi JSON kết quả ra .understand-anything/intermediate/ trên disk thay vì trả về context; orchestrator đọc file

> **Nguồn gốc:** Understand-Anything (`.understand-anything/intermediate/` spillover) | **Coupling:** 🟡 — thêm disk spillover vào subagent result flow | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có spill.ts + subagent — chưa có intermediate-dir pattern) | **Effort:** 1-2 tuần

## Nguồn gốc

**Understand-Anything** giải bài toán sub-agent trả kết quả lớn: thay vì sub-agent **return JSON vào context** của orchestrator (phình context, đắt token), sub-agent **ghi JSON ra `.understand-anything/intermediate/`** trên disk, rồi chỉ trả về orchestrator một **reference** (path + summary ngắn). Orchestrator khi cần chi tiết → **đọc file** (lazy load). Nguyên tắc: **kết quả nặng xuống disk, context giữ nhẹ** — tách "produce result" khỏi "consume result" qua file boundary, không qua context window.

## Mô tả

mya intermediate results on disk: sub-agent phân tích 1 file/nhánh → kết quả (graph node, symbol table, summary dài) ghi vào thư mục intermediate (vd `.mya/intermediate/{taskId}/`) → trả orchestrator chỉ `{ path, summary }`. Orchestrator tổng hợp từ nhiều reference, chỉ load full JSON khi cần reasoning sâu. mya có packages/core spill.ts (context spillover) + packages/agent subagent.ts (sub-agent rounds) — XN thêm **intermediate-dir writer** (sub-agent) + **lazy reader** (orchestrator).

## Kiến trúc

```
  ┌─── SUB-AGENT A (analyze file X) ───────────────────────┐
  │  result = { symbols: [...1500...], deps: [...] }  ← NẶNG │
  │  → writeFile(".mya/intermediate/A.json", result)         │
  │  return { path: ".../A.json", summary: "X: 1500 sym" }   │  ← NHẸ (chỉ ref)
  └─────────────────────────┬───────────────────────────────┘
                            ▼ (context orchestrator NHẸ)
  ┌─── SUB-AGENT B (analyze file Y) ───────────────────────┐
  │  → writeFile(".mya/intermediate/B.json", result)         │
  │  return { path: ".../B.json", summary: "Y: 800 sym" }    │
  └─────────────────────────┬───────────────────────────────┘
                            ▼
  ┌─── ORCHESTRATOR (lazily consume) ──────────────────────┐
  │  context chỉ có [ {A.ref}, {B.ref} ]  ← nhẹ              │
  │  cần chi tiết A → readFile(A.path) → full JSON            │
  │  tổng hợp → final graph                                   │
  └─────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core spill.ts — context spillover (nền — XN disk spillover analog)
// ✅ packages/agent subagent.ts — sub-agent rounds (nền — XN mỗi round = sub-agent)
// ✅ packages/audit — artifact store (nền — XN intermediate = transient artifact)
// ✅ packages/tools — file read/write tools (nền — XN dùng writeFile/readFile)

// ❌ THIẾU: intermediate-dir convention (.mya/intermediate/{task}/)
// ❌ THIẾU: sub-agent → write JSON + return reference (không return full)
// ❌ THIẾU: orchestrator lazy reader (load full chỉ khi cần)
```

## Implementation

```typescript
// packages/agent/src/intermediate-results.ts (MỚI)
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

interface IntermediateRef { path: string; summary: string; bytes: number }

async function writeIntermediate(
  dir: string,
  key: string,
  result: unknown,
  summarizer: (r: unknown) => string,
): Promise<IntermediateRef> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${key}.json`);
  const payload = JSON.stringify(result);
  await writeFile(path, payload, "utf8");
  return { path, summary: summarizer(result), bytes: payload.length };
}

async function readIntermediate<T>(ref: IntermediateRef): Promise<T> {
  return JSON.parse(await readFile(ref.path, "utf8")) as T;
}

// sub-agent side: produce → disk → return ref
async function subAgentAnalyze(
  file: string,
  intermediateDir: string,
  analyze: (f: string) => Promise<{ symbols: string[]; deps: string[] }>,
): Promise<IntermediateRef> {
  const result = await analyze(file);
  return writeIntermediate(
    intermediateDir,
    file.replace(/[^\w]/g, "_"),
    result,
    (r) => `${file}: ${(r as { symbols: string[] }).symbols.length} symbols`,
  );
}

// Usage:
// const refA = await subAgentAnalyze("src/a.ts", ".mya/intermediate/T1", analyze);
// const refB = await subAgentAnalyze("src/b.ts", ".mya/intermediate/T1", analyze);
// // orchestrator context: [{A.ref}, {B.ref}] — nhẹ
// const detail = await readIntermediate(refA); // lazy load khi cần
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Context nhẹ (ref thay vì full JSON) | ❌ Disk I/O (read/write chậm hơn memory) |
| ✅ Lazy load (chỉ đọc detail khi cần) | ❌ File lifecycle (dọn intermediate sau task) |
| ✅ Checkpoint (JSON persist — resume được) | ❌ Serialization cost (JSON.stringify lớn) |
| ✅ Parallel safe (mỗi sub-agent ghi file riêng) | ❌ Debug khó (kết quả ở file, không trong log) |

## Khác các hướng gần

| | Return-in-context | Spill (drop) | XN: Disk Intermediate |
|---|---|---|---|
| Kết quả đi đâu | context orchestrator | drop/truncate | **file (persist)** |
| Orchestrator thấy | full | mất | **ref + lazy load** |
| Resume | ❌ | ❌ | **✅ (đọc lại file)** |

## Khi nào chọn

- Sub-agent trả kết quả lớn (symbol table, graph, full AST) → phình context
- Muốn context orchestrator nhẹ (chỉ reference + summary)
- Cần checkpoint/resume (kết quả persist trên disk)
- Nối packages/core spill.ts + packages/agent subagent.ts + packages/tools; guard intermediate-cleanup (rm sau task — không tích lũy), ref-staleness (file bị xóa → ref invalid → re-analyze), và path-safety (sanitiz key — không path traversal); XN = intermediate results on disk, kết hợp 639 XO incremental-fingerprint-analysis (intermediate cache theo fingerprint) + 641 XQ diff-ripple-analysis (orchestrator consume intermediate graph)
