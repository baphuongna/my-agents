# Hướng UK: Lean NDJSON Agent — loop tối giản không shell, xuất NDJSON có schema + format_version cho CI/script

> **Nguồn gốc:** claw-code `claw-analog` (minimal agent loop, no shell, NDJSON output, schema + format_version); "claw-analog lean loop", "no shell (read/list/glob/grep, optional write)", "NDJSON output with schema", "format_version for CI/script consumption" | **Coupling:** 🟢 — thêm lean NDJSON mode vào agent | **Agent-agnostic:** ⚠️ (tool set cố định, ít) | **Code sẵn:** ⚠️ (agent loop + tools sẵn — chưa có NDJSON schema + lean mode) | **Effort:** 2 tuần

## Nguồn gốc

**claw-code** `claw-analog` là **agent loop tối giản** — cố ý **bỏ shell** (không exec/bash, tránh nguy hiểm + non-deterministic). Tool set thu gọn: **read/list/glob/grep** (chỉ đọc, an toàn) + **tùy chọn write** (opt-in, có thể tắt). Điểm khác biệt cốt lõi: output là **NDJSON** (newline-delimited JSON) — mỗi dòng 1 JSON object, có **`schema`** (định nghĩa field) và **`format_version`** (versioning, để consumer biết format). Mục đích: agent output **machine-readable** cho **CI/script** — pipeline parse NDJSON, không cần regex prose. Nguyên tắc: **lean + deterministic + structured** — ít tool, không shell, output parseable.

## Mô tả

mya lean NDJSON agent: (1) **Lean loop**: agent turn tối giản, tool set cố định (read/list/glob/grep, opt-in write). (2) **No shell**: không exec/bash (an toàn, deterministic). (3) **NDJSON output**: mỗi event 1 JSON line (action/result/summary). (4) **Schema + version**: declare `schema` (field definition) + `format_version` (consumer compat). mya có agent loop + tools — UK thêm **lean-mode** + **ndjson-emitter** + **schema-declaration**.

## Kiến trúc

```
  AGENT LOOP (lean, no shell)
  ┌─ tools: read | list | glob | grep | (write: opt-in) ─────┐
  │                                                            │
  │  turn → tool-call → result → turn → ... → done             │
  │                                                            │
  │  mỗi step → emit 1 NDJSON line                             │
  └───────────────┬───────────────────────────────────────────┘
                  │ (stdout: NDJSON stream)
                  ▼
  {"format_version":1,"schema":"...","type":"meta"}
  {"type":"action","tool":"grep","args":{"pattern":"TODO"}}
  {"type":"result","tool":"grep","matches":["file.ts:42:TODO"]}
  {"type":"action","tool":"read","args":{"path":"file.ts"}}
  {"type":"result","tool":"read","lines":100}
  {"type":"summary","text":"found 3 TODOs"}
                  │
                  ▼ (CI/script parse NDJSON, không regex prose)
  pipeline: jq '.type' | filter action | ...
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/core loop.ts — agent loop (nền — UK lean mode ở đây)
// ✅ packages/tools find.ts/ls.ts/search-index.ts — read/list/grep (nền — UK tool set)
// ✅ packages/tools hashline-edit.ts — write (nền — UK opt-in write)
// ✅ packages/agent sdk.ts — agent SDK (nền — UK NDJSON emit)

// ❌ THIẾU: lean-mode (no-shell, fixed tool set)
// ❌ THIẾU: ndjson-emitter (mỗi event → 1 JSON line stdout)
// ❌ THIẾU: schema-declaration (field definition + format_version)
```

## Implementation

```typescript
// packages/agent/src/lean-ndjson-agent.ts (MỚI)
interface NdjsonEvent { format_version: number; type: string; [k: string]: unknown }

class LeanNdjsonAgent {
  private static readonly FORMAT_VERSION = 1;

  constructor(
    private tools: { name: string; run: (args: Record<string, unknown>) => Promise<unknown> }[],
  ) {}

  private emit(event: NdjsonEvent): void {
    process.stdout.write(JSON.stringify({ format_version: LeanNdjsonAgent.FORMAT_VERSION, ...event }) + '\n');
  }

  // lean loop: turn → tool-call → result → emit each step
  async run(steps: { tool: string; args: Record<string, unknown> }[]): Promise<void> {
    this.emit({ type: 'meta', schema: 'action/result/summary', format_version: LeanNdjsonAgent.FORMAT_VERSION });
    for (const step of steps) {
      this.emit({ type: 'action', tool: step.tool, args: step.args });
      const tool = this.tools.find(t => t.name === step.tool);
      if (!tool) { this.emit({ type: 'error', tool: step.tool, reason: 'unknown tool' }); continue; }
      try {
        const result = await tool.run(step.args);
        this.emit({ type: 'result', tool: step.tool, output: result });
      } catch (e) {
        this.emit({ type: 'error', tool: step.tool, reason: String(e) });
      }
    }
    this.emit({ type: 'summary', steps: steps.length });
  }
}

// Usage:
// const agent = new LeanNdjsonAgent([read, list, glob, grep]);  // no shell
// await agent.run([{tool:'grep', args:{pattern:'TODO'}}, ...]);
// → NDJSON stream (parseable by jq/script)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Machine-readable (CI/script parse NDJSON, không regex prose) | ❌ Tool giới hạn (no shell → không exec/cmd) |
| ✅ Safe + deterministic (no shell, fixed tools) | ❌ Less flexible (không thể chạy arbitrary command) |
| ✅ Versioned (format_version → consumer compat) | ❌ Schema drift (field thay → consumer break) |
| ✅ Lean (ít overhead, nhanh) | ❌ NDJSON verbose (so với compact output) |

## Khác các hướng gần

| | Full agent (shell) | Prose output | UK: Lean-NDJSON |
|---|---|---|---|
| Shell | ✅ | ✅ | **❌ (no shell)** |
| Output | Text/mixed | Prose (human) | **NDJSON (machine, schema+version)** |
| CI-friendly | ⚠ (parse khó) | ❌ (regex) | **✅ (jq parse)** |

## Khi nào chọn

- Cần agent output cho CI/script (machine-parseable, không prose)
- Muốn safe + deterministic (no shell, fixed tool set)
- Pipeline cần versioned output (format_version → compat check)
- Nối packages/core loop.ts + packages/tools find.ts/ls.ts/search-index.ts + packages/agent sdk.ts; guard schema-stability (format_version bump khi field thay), no-shell-discipline (lean mode thật không có exec tool), và NDJSON-validity (mỗi dòng JSON parseable, không line nửa vời); UK = lean NDJSON agent, kết hợp 555 UI permission-mode (lean mode = ReadOnly) + packages/core loop (loop engine reuse)
