# Hướng AGI: Runtime Header Injection — `buildRuntimeHeader` chèn vào system prompt: target repo, output paths được phép ghi, "Keep findings on disk", "write failure note to assigned path and exit cleanly" — contract rõ ràng cho child agent

> **Nguồn gốc:** piolium (agent-runner.ts) | **Coupling:** 🟢 — system prompt assembly | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có prompts assembler + spawn goal, thiếu runtime-header contract) | **Effort:** 0.5-1 tuần

## Nguồn gốc

**piolium** `buildRuntimeHeader` chèn **contract block** vào đầu system prompt của child agent (specialist được spawn). Nội dung: (1) **target repo** đang audit cái gì; (2) **output paths được phép ghi** (whitelist, không ghi lung tung); (3) **"Keep findings on disk"** — kết quả phải persist ra file; (4) **"write failure note to assigned path and exit cleanly"** — nếu lỗi, ghi note lỗi rồi exit sạch (không crash, không nuốt error). Nguyên tắc: **child agent có contract rõ ràng — biết làm gì, ghi đâu, lỗi thì sao**.

## Mô tả

mya runtime-header-injection: (1) **prompts assembler đã sẵn** — `packages/prompts` assembler.ts (3-tier prompt assembly); (2) **spawn goal đã sẵn** — `packages/agent` spawnSubagent(goal); (3) **buildRuntimeHeader** — chèn target/paths/keep-on-disk/failure-contract vào system prompt; (4) **path whitelist** — chỉ ghi assigned path (nối AGF disk artifact); (5) **failure contract** — exit cleanly + ghi note. Nối AGF (phases) và path-safety (`packages/tools` path-safety.ts).

## Kiến trúc (ASCII)

```
  SPAWN child agent (specialist)
       │
       ▼  buildRuntimeHeader() chèn vào SYSTEM PROMPT
  ┌────────────────────────────────────────┐
  │ RUNTIME HEADER (contract):              │
  │  • Target repo: <path>                  │ ◀── đang audit cái gì
  │  • Allowed output paths: [P3.json]      │ ◀── whitelist ghi
  │  • "Keep findings on disk"              │ ◀── persist ra file
  │  • "On failure: write note to assigned  │ ◀── lỗi → ghi note + exit sạch
  │     path and exit cleanly"              │     (không crash, không nuốt)
  └────────────────────────────────────────┘
       │
       ▼  child agent biết: làm gì, ghi đâu, lỗi thì sao
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/prompts assembler.ts — 3-tier prompt assembly (system prompt build)
// ✅ packages/agent index.ts — spawnSubagent(goal, opts)
// ✅ packages/tools path-safety.ts — path whitelist/guard foundation
// ✅ packages/core exit.ts — clean exit pattern (nền failure contract)

// ❌ THIẾU: buildRuntimeHeader (target/paths/keep-on-disk/failure contract)
// ❌ THIẾU: path whitelist injection vào system prompt
```

## Implementation

```typescript
// packages/prompts/src/runtime-header.ts (MỚI)
export interface RuntimeHeaderInput {
  readonly targetRepo: string;
  readonly allowedOutputPaths: string[];   // whitelist ghi
  readonly assignedFailurePath: string;    // ghi note lỗi nếu fail
}
/** Chèn runtime contract vào system prompt cho child agent. */
export function buildRuntimeHeader(input: RuntimeHeaderInput): string {
  return [
    "# Runtime Contract",
    `Target repo: ${input.targetRepo}`,
    `Allowed output paths (write ONLY here):`,
    ...input.allowedOutputPaths.map((p) => `  - ${p}`),
    ``,
    `Keep findings on disk — persist results to the assigned output path.`,
    `On failure: write a short failure note to ${input.assignedFailurePath} and exit cleanly ` +
      `(do NOT crash, do NOT silently swallow errors).`,
    ``,
  ].join("\n");
}
// Sử dụng: systemPrompt = buildRuntimeHeader(input) + specialistInstructions
//          spawnSubagent(goal, { systemPrompt })
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Child agent có contract rõ — biết làm gì | ❌ Header dài chiếm token |
| ✅ Path whitelist — không ghi lung tung | ❌ Agent có thể bỏ qua contract (không enforce) |
| ✅ Failure contract — exit sạch, không nuốt error | ❌ Cần path-safety enforcement thật (không chỉ prompt) |

## Khác các hướng gần

| | AGI Runtime Header | prompts assembler | path-safety |
|---|---|---|---|
| Trọng tâm | Contract cho child agent | 3-tier prompt | Path guard (enforce) |
| Path | whitelist trong prompt | ctxFiles | runtime check |
| Failure | exit cleanly + note | không | block |

## Khi nào chọn

- Spawn child agent cần contract rõ (target/output/failure)
- Muốn whitelist output path trong system prompt
- Cần child agent exit sạch khi lỗi (không crash)
- Guard: path-safety enforce THẬT (không chỉ prompt), failure note required, header ngắn gọn
