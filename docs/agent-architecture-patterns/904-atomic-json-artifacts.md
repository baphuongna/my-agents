# Hướng AHT: Atomic-JSON-Artifacts — artifact mỗi run ghi theo bộ file cố định `{runId}_{agent}_input.md/_output.md/.jsonl/_meta.json` trong `subagent-artifacts`, dùng `writeAtomicJson` tránh ghi dở file trạng thái

> **Nguồn gốc:** pi-subagents | **Coupling:** 🟢 — artifact persistence | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có atomic write pattern; chưa có fixed artifact schema + writeAtomicJson) | **Effort:** 1 tuần

## Nguồn gốc

**pi-subagents** artifact mỗi run ghi theo **bộ file cố định** `{runId}_{agent}_input.md` / `_output.md` / `.jsonl` / `_meta.json` trong thư mục `subagent-artifacts` bên cạnh session file, dùng **`writeAtomicJson`** để tránh ghi dở file trạng thái. Nguyên tắc: **fixed schema** — artifact theo convention (input/output/jsonl/meta) — predictable, tooling đọc được; **atomic write** — write-to-temp + rename (POSIX atomic) — không bao giờ reader thấy file nửa vời; **co-located** — artifact cạnh session file (cùng lifecycle, dễ cleanup).

## Mô tả

Với mya, pattern = **artifact store fixed-schema + atomic write**: (1) mya đã có **atomic write pattern** (gateway mcp-oauth-store, cron-store, sync) — write-temp + rename; (2) mya có session file (JSONL) trong pool.ts; (3) AHT thêm **artifact convention**: mỗi run → 4 file `input.md` (task description), `output.md` (kết quả text), `.jsonl` (event stream), `meta.json` (status/timing) trong `subagent-artifacts/`; (4) **`writeAtomicJson`** cho meta.json — write `meta.json.tmp` rồi `renameSync` → atomic; (5) **nối AHN** — output lớn thì output.md là artifact, parent nhận path.

## Kiến trúc (ASCII)

```
  subagent-artifacts/
    ├─ {runId}_{agent}_input.md     ← task description (text)
    ├─ {runId}_{agent}_output.md    ← kết quả (text — hoặc path nếu lớn, nối AHN)
    ├─ {runId}_{agent}.jsonl        ← event stream (append-only)
    └─ {runId}_{agent}_meta.json    ← status/timing (atomic write)
         │
         ▼ writeAtomicJson:
         1. write meta.json.tmp     (write-to-temp)
         2. fs.renameSync(tmp → meta.json)   (POSIX atomic)
         └─► reader KHÔNG bao giờ thấy meta.json nửa vời
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/gateway mcp-oauth-store.ts — atomic write pattern (write-temp+rename)
// ✅ packages/cron cron-store.ts — atomic store (cron.json)
// ✅ packages/sync index.ts — writeFileSync atomic-ish (LWW state)
// ✅ packages/agent pool.ts — AgentSessionEntry.sessionFile (JSONL — nền .jsonl)
// ✅ packages/core time.ts — nowWallclock (meta timing)

// ❌ THIẾU: fixed artifact schema (input/output/jsonl/meta convention)
// ❌ THIẾU: writeAtomicJson helper (general — hiện rải rác)
// ❌ THIẾU: subagent-artifacts dir co-located với session
```

## Implementation

```typescript
// packages/agent/src/artifacts.ts (NEW)
import { writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { nowWallclock } from "@my-agent/core";

/** Atomic JSON write — write-temp + rename (POSIX atomic). */
export function writeAtomicJson(path: string, data: unknown): void {
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(tmp, path); // atomic — reader không thấy nửa vời
}

/** Viết artifact bộ 4 file cố định cho mỗi run. */
export function writeRunArtifacts(
  dir: string, runId: string, agent: string,
  input: string, output: string, events: unknown[], meta: Record<string, unknown>,
): void {
  mkdirSync(dir, { recursive: true });
  const base = `${runId}_${agent}`;
  writeFileSync(join(dir, `${base}_input.md`), input);
  writeFileSync(join(dir, `${base}_output.md`), output);
  writeFileSync(join(dir, `${base}.jsonl`), events.map((e) => JSON.stringify(e)).join("\n"));
  writeAtomicJson(join(dir, `${base}_meta.json`), { ...meta, writtenAt: nowWallclock() });
}
// pool.ts: sau sub.wait() → writeRunArtifacts(subagent-artifacts/, sub.id, agent, ...).
// meta.json update status real-time qua writeAtomicJson (nối AHR repair).
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Fixed schema — tooling/tool đọc predictable | ❌ 4 file per run — nhiều file |
| ✅ Atomic write — không nửa vời | ❌ rename cần cùng filesystem (cross-fs fail) |
| ✅ Co-located — dễ cleanup cùng session | ❌ jsonl append cần riêng (không atomic-json) |
| ✅ Nối atomic pattern sẵn | ❌ meta.json update thường xuyên → wear |

## Khác các hướng gần

| | AHT Atomic-JSON-Artifacts | AHN Output-Head-Truncation | AHR Stale-Run-Reconciler |
|---|---|---|---|
| Trọng tâm | Lưu artifact an toàn | Bound output subagent | Sửa orphan run |
| Cơ chế | Fixed schema + writeAtomicJson | Head-truncate + path | PID-liveness + grace |
| Quan hệ | Persist kết quả | Truyền kết quả | Lifecycle kết quả |

## Khi nào chọn

- Cần artifact predictable (tooling/audit đọc được)
- Trạng thái run ghi thường xuyên → phải atomic (không nửa vời)
- Muốn artifact co-located với session (cùng lifecycle)
- Guard: write-temp + rename cùng filesystem, fixed schema convention, jsonl append riêng, meta.json atomic
