# Hướng VP: Operational Handoff Schema — summary dùng cấu trúc [BOOMERANG COMPLETE] cố định: outcome/changed-files/relevant-reads/commands/validation/failures

> **Nguồn gốc:** pi-boomerang (operational handoff schema); "fixed [BOOMERANG COMPLETE] structure"; "outcome / changed-files / relevant-reads / commands / validation / failures"; "machine-parseable handoff summary"; "deterministic summary shape" | **Coupling:** 🟢 — thêm fixed-schema summary vào subagent return (VJ collapse) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (subagent summary sẵn — chưa có fixed-schema + parser) | **Effort:** 2-3 tuần

## Nguồn gốc

**pi-boomerang** khi worker hoàn thành, summary (VJ) không tự do dạng — mà dùng **cấu trúc cố định** `[BOOMERANG COMPLETE]` với **6 section**: **outcome** (kết quả), **changed-files** (file đã sửa), **relevant-reads** (file đã đọc, ngữ cảnh), **commands** (lệnh đã chạy), **validation** (kiểm chứng gì pass), **failures** (lỗi còn lại). Nguyên tắc: **summary có dạng máy-parse được** — fixed schema → orchestrator/user/máy đọc được chính xác từng phần (không lướt prose). Khác **free-form summary** (văn xuôi) — VP **deterministic shape**; khác log dump — VP **curated operational fields**.

## Mô tả

mya operational handoff schema: (1) **Fixed schema**: summary bắt đầu `[BOOMERANG COMPLETE]` + 6 section header cố định. (2) **Generate**: VJ collapse → summary theo schema (LLM buộc theo template). (3) **Parse**: orchestrator/tool parse section → structured object (trích changed-files để verify, validation để confirm). (4) **Verify**: dùng `validation` section để kiểm chứng claim (test pass?). (5) **Failures**: `failures` section cho biết rủi ro còn lại. mya có subagent summary — VP thêm **fixed-schema template** + **schema parser**.

## Kiến trúc

```
  WORKER xong → VJ collapse → SUMMARY theo SCHEMA cố định:

  ┌─── [BOOMERANG COMPLETE] ──────────────────────────────┐
  │  outcome:       "fixed auth race condition in login"    │
  │  changed-files: ["src/login.ts", "src/login.test.ts"]  │
  │  relevant-reads:["src/token.ts", "docs/auth.md"]        │
  │  commands:      ["npm test", "npx tsc --noEmit"]        │
  │  validation:    "all tests pass, tsc clean"            │
  │  failures:      "none" (hoặc "e2e flaky, skipped")      │
  └───────────────────────┬─────────────────────────────┘
                          │ (machine-parse)
                          ▼
  ┌─── PARSE → STRUCTURED ────────────────────────────────┐
  │  { outcome, changedFiles, reads, commands,             │
  │    validation, failures }                              │
  │  → orchestrator verify: chạy lại commands? check files?│
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 582 opaque-context-collapse (VJ) — summary (nền — VP = schema cho summary)
// ✅ packages/subagents — subagent return (nền — VP = handoff shape)
// ✅ 583 hidden-orchestrator-handoff (VK) — handoff (relate — VP = schema cho handoff)

// ❌ THIẾU: fixed-schema template ([BOOMERANG COMPLETE] + 6 section)
// ❌ THIẾU: schema-guided generator (LLM buộc theo schema)
// ❌ THIẾU: schema parser (summary → structured object)
```

## Implementation

```typescript
// packages/agent/src/operational-handoff.ts (MỚI)
interface HandoffSchema {
  outcome: string;
  changedFiles: string[];
  relevantReads: string[];
  commands: string[];
  validation: string;
  failures: string;
}
const SECTIONS = ['outcome', 'changed-files', 'relevant-reads', 'commands', 'validation', 'failures'] as const;

class OperationalHandoffSchema {
  // prompt template ép LLM sinh summary theo schema
  static prompt(): string {
    return `Output EXACTLY this structure (fill each section):\n` +
      `[BOOMERANG COMPLETE]\n` +
      `outcome: <one-line result>\n` +
      `changed-files: <comma-separated paths>\n` +
      `relevant-reads: <comma-separated paths read>\n` +
      `commands: <comma-separated commands run>\n` +
      `validation: <what was verified pass>\n` +
      `failures: <remaining issues or "none">`;
  }

  // parse summary text → structured object
  static parse(text: string): HandoffSchema {
    const result: Record<string, string | string[]> = {};
    const lines = text.split('\n');
    for (const line of lines) {
      const m = line.match(/^(outcome|changed-files|relevant-reads|commands|validation|failures):\s*(.*)$/i);
      if (!m) continue;
      const [, keyRaw, val] = m;
      const key = keyRaw!.toLowerCase();
      const isList = key === 'changed-files' || key === 'relevant-reads' || key === 'commands';
      result[key.replace('-', '')] = isList && val!.trim() !== 'none'
        ? val!.split(',').map(s => s.trim()).filter(Boolean)
        : val!.trim();
    }
    return result as unknown as HandoffSchema;
  }
}

// Usage:
// collapse prompt += OperationalHandoffSchema.prompt();   // ép schema
// const summary = await llm(...);
// const handoff = OperationalHandoffSchema.parse(summary);
//   → { changedFiles: ["src/login.ts", ...], validation: "all pass", ... }
// orchestrator: verify handoff.commands, check handoff.changedFiles
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Machine-parseable (orchestrator/tool đọc chính xác) | ❌ Schema cứng (thiếu section → parse lỗi) |
| ✅ Deterministic shape (luôn 6 section) | ❌ LLM không tuân (sai format) |
| ✅ Verifiable (validation/commands để check lại) | ❌ Section ép buộc (failure='none' khi thật có) |
| ✅ Failures rõ (rủi ro còn lại) | ❌ Parse brittle (format lệch → miss) |

## Khác các hướng gần

| | Free-form summary | Log dump | VP: Operational-Handoff |
|---|---|---|---|
| Dạng | Văn xuôi | Raw log | **Fixed schema 6 section** |
| Parse | ❌ | Khó | **✅ machine-parse** |
| Verify | ❌ | ❌ | **✅ validation/commands** |

## Khi nào chọn

- Orchestrator/tool cần parse summary (trích changed-files, validation)
- Muốn summary deterministic (luôn cùng shape)
- Cần verify claim (validation/commands để re-check)
- Nối 582 opaque-context-collapse (VJ, summary source) + packages/subagents return + 583 hidden-handoff (VK, schema cho handoff ẩn); guard schema compliance (validate 6 section có đủ), LLM-format robustness (fallback parse + re-prompt nếu lệch), và section honesty (failures thật, không 'none' che giấu); VP = operational handoff schema, kết hợp 582 VJ (collapse) + 584 anchor-accumulation (schema → merge sạch vào anchor) — schema cố định làm summary tích lũy parse được
