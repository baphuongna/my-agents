# Hướng AGR: Graceful SDK Fallback — FffService check isAvailable; nếu FFF fail thì find/grep/multi_grep degrade về SDK, ripgrep fallback riêng, không crash khi thiếu dependency

> **Nguồn gốc:** pi-pretty | **Coupling:** 🟢 — degrade layer thuần | **Agent-agnostic:** ✅ | **Code sẵn:** ✅ (mya có ai/fallback.ts + ProviderRegistry taint — pattern fallback mạnh; áp dụng cho tool search tương tự) | **Effort:** 0.5 tuần

## Nguồn gốc

**pi-pretty** `FffService` có method `isAvailable()` kiểm tra FFF (bundled indexer) đã cài/chạy được không. Nếu **FFF không cài/fail** → `find`/`grep`/`multi_grep` **degrade về SDK implementation** (Node fs recursive). Riêng `multi_grep` có **ripgrep fallback riêng** (nếu FFF grep path fail, thử ripgrep binary). Triết lý: **không bao giờ crash khi thiếu optional dependency** — luôn có path SDK an toàn; **mỗi tool có fallback chain riêng** (find→SDK, grep→SDK, multi_grep→ripgrep→SDK).

Nguyên tắc: **probe isAvailable trước** (không assume dependency có); **degrade không crash** (luôn có path SDK); **fallback chain per-tool** (không một-size-fits-all); **optional dependency optional** (core không break khi thiếu).

## Mô tả

Với mya, pattern này **đã có nền vững** ở provider layer: packages/ai `fallback.ts` (`streamWithFallback` thử profile theo thứ tự, skip tainted) + `registry.ts` (ProviderRegistry taint/cooldown). Áp dụng cùng triết lý cho **tool search**: nếu FFF/native indexer không sẵn, find/grep degrade về Node fs SDK path — core không crash. mya **chưa có** wrapper `isAvailable` + degrade rõ ràng cho tool find/grep (hiện dùng fs trực tiếp), nhưng pattern đã được chứng minh ở provider fallback.

## Kiến trúc (ASCII)

```
  find / grep / multi_grep
        │
        ▼
  FffService.isAvailable()? ── NO ──► SDK impl (Node fs recursive)  [an toàn]
        │ YES
        ▼
  try FFF index/grep
        │
        ├─ ok → return (fast, frecency-ranked)
        └─ fail → multi_grep: ripgrep binary fallback → SDK fs fallback
  ── không bao giờ crash khi thiếu optional dependency
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/ai/src/fallback.ts — streamWithFallback (try profile order, skip tainted)
// ✅ packages/ai/src/registry.ts — ProviderRegistry taint/cooldown (probe + degrade)
// ✅ packages/tools/src/find.ts — find tool (fs-based SDK path sẵn)
// ⚠️ KHÔNG có FffService.isAvailable() wrapper + degrade rõ ràng cho find/grep
// ❌ KHÔNG có ripgrep fallback riêng cho multi_grep
```

## Implementation

```typescript
// packages/tools/src/search-fallback.ts (NEW)
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

export interface SearchBackend {
  isAvailable(): boolean;
  find(root: string, pattern: RegExp): Promise<string[]>;
  grep(root: string, needle: string): Promise<string[]>;
}

/** FFF backend (bundled indexer, optional). */
export class FffBackend implements SearchBackend {
  isAvailable(): boolean { return process.env.MYA_FFF !== "off"; }
  async find(root: string, p: RegExp): Promise<string[]> { /* ...FFF fast path... */ return []; }
  async grep(root: string, n: string): Promise<string[]> { return []; }
}

/** SDK fallback (Node fs recursive) — luôn sẵn, không crash. */
export class SdkBackend implements SearchBackend {
  isAvailable(): boolean { return true; }
  async find(root: string, p: RegExp): Promise<string[]> {
    const out: string[] = [];
    const walk = async (d: string) => {
      for (const e of await readdir(d, { withFileTypes: true })) {
        const full = join(d, e.name);
        if (e.isDirectory()) await walk(full);
        else if (p.test(e.name)) out.push(full);
      }
    };
    await walk(root); return out;
  }
  async grep(root: string, n: string): Promise<string[]> { /* SDK grep */ return []; }
}

/** Resolve backend: FFF if available else SDK. multi_grep thêm ripgrep middle. */
export function resolveSearch(): SearchBackend {
  const fff = new FffBackend();
  return fff.isAvailable() ? fff : new SdkBackend();
}

/** multi_grep chain: FFF → ripgrep binary → SDK (per-tool fallback). */
export async function multiGrep(root: string, needles: string[]): Promise<string[][]> {
  try { return await Promise.all(needles.map((n) => resolveSearch().grep(root, n))); }
  catch {
    try {                                              // ripgrep binary fallback
      return await Promise.all(needles.map(async (n) => (await exec("rg", ["-l", n, root])).stdout.trim().split("\n").filter(Boolean)));
    } catch { return needles.map(() => []); }           // SDK an toàn cuối cùng
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không crash khi thiếu optional dependency | ❌ Fallback SDK chậm hơn FFF nhiều |
| ✅ Fallback chain per-tool (find/grep/multi_grep) | ❌ Phải probe isAvailable mỗi call (cache?) |
| ✅ Luôn có path an toàn (SDK fs) | ❌ Ripgrep binary cũng optional (probe riêng) |

## Khác các hướng gần

| | AGR SDK Fallback | AGQ FFF Frecency | ai/fallback.ts |
|---|---|---|---|
| Trọng tâm | Degrade khi thiếu FFF | Ranking find/grep | Provider fallback chain |
| Cơ chế | isAvailable → SDK, ripgrep middle | frequency × recency | try profile order, skip tainted |
| Quan hệ | Nối robustness | Nối search UX | Nối provider resilience |

## Khi nào chọn

- Tool dùng optional dependency (native binary, indexer) — không crash khi thiếu
- Cần fallback chain per-tool (find/grep/multi_grep khác nhau)
- Muốn SDK path luôn an toàn làm last resort
- Guard: probe isAvailable trước, degrade không throw, ripgrep middle cho multi_grep
