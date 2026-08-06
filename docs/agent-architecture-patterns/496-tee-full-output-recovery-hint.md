# Hướng SB: Tee Full-Output Recovery Hint — nén output nhưng tee bản đầy đủ ra file xoay vòng, in hint

> **Nguồn gốc:** rtk (output tee / recovery hint); "tee full output to rotating file"; "compressed output + recovery path hint"; "truncated output links to full log"; "rotating output buffer with hint pointer"
> **Coupling:** 🟢 — thêm tee writer cạnh compressor (compress cho LLM + tee đầy đủ ra file)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (packages/ai compressor + session store sẵn — chưa có rotating tee file + hint printer)
> **Effort:** 1-2 tuần

## Nguồn gốc

**rtk** pattern **tee full-output recovery**: khi nén/cắt output tool (ví dụ `read` trả 10k dòng → nén thành 50 dòng preview) cho LLM, **đồng thời** ghi bản **đầy đủ** (full 10k dòng) ra **file xoay vòng** (rotating buffer) và **in hint** (đường dẫn file) trong output nén. Nguyên tắc: **LLM nhận bản ngắn, nhưng user/agent có thể khôi phục bản đầy đủ** qua hint path — không mất dữ liệu vĩnh viễn, chỉ ẩn khỏi context. Giống `tee` Unix (ghi 2 nơi) + `less` (xem đầy đủ khi cần). Khác **493 reversible-compression** (undo nén context) — SB là **tee output tool** (khôi phục qua file, không qua TTL); khác truncation đơn thuần — SB **có hint recovery**.

## Mô tả

mya tee full-output recovery hint: (1) **Tee writer**: output tool (đầy đủ) ghi song song — (a) compress cho LLM, (b) **tee** đầy đủ ra file xoay vòng (`output-telemetry/seg-<id>.log`, max N file FIFO). (2) **Hint in compressed**: output nén kết thúc bằng hint `[full output: /path/seg-<id>.log]`. (3) **Recovery**: agent/user thấy hint → `read`/`less` file đầy đủ để xem chi tiết. (4) **Rotating**: file xoay vòng (FIFO — khi đầy N file, xóa cũ nhất) → không phình đĩa. (5) **Cross-ref**: segment-id link output nén ↔ file đầy đủ. mya có compressor + session store — SB thêm **rotating tee file** + **hint printer** (segment-id path).

## Kiến trúc

```
  TOOL OUTPUT (full, 10k dòng):
        │
        ├───► COMPRESS ──► 50 dòng preview + hint  ──► LLM (token giảm)
        │                   "...truncated...            (nhưng có hint)
        │                    [full output: /tmp/telemetry/seg-abc.log]"
        │
        └───► TEE (đầy đủ) ─► ROTATING FILE (FIFO)
                             output-telemetry/
                               seg-abc.log  (full 10k dòng)
                               seg-def.log
                               ... (max N file, cũ nhất bị xóa)
                                  │
                                  │ agent/user thấy hint
                                  ▼
                          read /tmp/telemetry/seg-abc.log
                          → khôi phục full output (recovery)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/ai — compressor (nền — SB tee cạnh nó)
// ✅ session store — file persistence (nền — SB rotating file)
// ✅ 493 reversible-compression — TTL undo (gần — SB = file tee thay vì TTL)

// ❌ THIẾU: rotating tee writer (ghi đầy đủ ra file FIFO, max N)
// ❌ THIẾU: hint printer (segment-id path trong output nén)
// ❌ THIẾU: recovery reader (read file đầy đủ từ hint path)
// ❌ THIẾU: segment-id cross-ref (output nén ↔ file đầy đủ)
```

## Implementation

```typescript
// packages/ai/src/tee-recovery.ts (MỚI)
import { writeFileSync, readFileSync, readdirSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

class TeeRecovery {
  private dir: string;
  constructor(dir: string, private maxFiles = 50) {
    this.dir = dir;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  // tee: compress cho LLM + ghi đầy đủ ra rotating file + return hint
  tee<T extends string>(full: T, compress: (s: T) => T, previewLines = 50): T {
    const segId = randomBytes(6).toString('hex');
    const path = join(this.dir, `seg-${segId}.log`);
    writeFileSync(path, full, 'utf8'); // tee đầy đủ
    this.rotate(); // FIFO xoay vòng
    const compressed = compress(full);
    const hint = `\n...[truncated — full output: ${path}]`;
    return (compressed + hint) as T;
  }

  // rotating FIFO (xóa cũ nhất khi vượt maxFiles)
  private rotate(): void {
    const files = readdirSync(this.dir)
      .map(f => ({ f, mtime: statMtime(join(this.dir, f)) }))
      .sort((a, b) => a.mtime - b.mtime);
    while (files.length >= this.maxFiles) {
      const old = files.shift();
      if (old) unlinkSync(join(this.dir, old.f));
    }
  }

  // recovery: đọc đầy đủ từ hint path
  recover(path: string): string | null {
    if (!existsSync(path) || !path.startsWith(this.dir)) return null; // path safety
    return readFileSync(path, 'utf8');
  }
}

function statMtime(p: string): number { try { return require('node:fs').statSync(p).mtimeMs; } catch { return 0; } }

// Usage:
// const forLLM = tee.tee(rawOutput, compressToPreview, 50);
// // LLM nhận preview + hint; full ở /tmp/telemetry/seg-abc.log
// if (need full) → const full = tee.recover('/tmp/telemetry/seg-abc.log');
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Recovery (full output không mất, đọc lại qua hint) | ❌ Đĩa (ghi đầy đủ song song — FIFO giới hạn nhưng vẫn tốn) |
| ✅ LLM nhận bản ngắn (token giảm) + hint | ❌ Hint path dài (thêm token mỗi output nén) |
| ✅ Rotating (FIFO — không phình vô hạn) | ❌ File hết (quá N + cũ bị xóa → recovery mất) |
| ✅ Phối 493 reversible (file tee thay TTL) | ❌ Path safety (phải guard traversal — không cho read ngoài dir) |

## Khác các hướng gần

| | 493 Reversible-Compression | Truncation thuần | SB: Tee-Recovery |
|---|---|---|---|
| Khôi phục | TTL window (memory) | ❌ (mất luôn) | **File rotating (hint)** |
| Bản đầy đủ | TTL store | Hủy | **Tee file (FIFO)** |
| Khi hết | TTL expire → lossy | — | **Quá N file → cũ xóa** |

## Khi nào chọn

- Output tool lớn (nén cho LLM nhưng user muốn xem đầy đủ)
- Muốn recovery (không mất dữ liệu, chỉ ẩn khỏi context)
- Chấp nhận ghi đĩa (rotating FIFO giới hạn)
- Nối packages/ai (compressor) + session store (file); guard path safety (traversal — chỉ read trong dir) + rotate (FIFO max N) + hint format (segment-id path parse được); phối 493 reversible (TTL undo cho context vs SB file tee cho output)
