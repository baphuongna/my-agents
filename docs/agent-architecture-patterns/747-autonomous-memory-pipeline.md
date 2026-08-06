# Hướng ABS: Autonomous Memory Pipeline — hai pha extraction từng session → consolidation chéo session bằng model smol, lease chống double-run, scan secrets trước khi ghi

> **Nguồn gốc:** gajae-code (docs/memory.md) | **Coupling:** 🟡 — thêm pipeline 2 pha vào memory manager | **Agent-agnostic:** ⚠️ (consolidation dùng model) | **Code sẵn:** ⚠️ (có dream-cycle + consolidate + lease — chưa có 2-pha pipeline hoàn chỉnh) | **Effort:** 2 tuần

## Nguồn gốc

**gajae-code** có **memory pipeline hai pha**: (1) **extraction từng session** — mỗi session được extract riêng, **bỏ session quá mới / quá cũ / đang active** (session quá mới chưa đủ data, quá cũ stale, active sẽ thay đổi); (2) **consolidation chéo session** — dùng **model smol** (model nhỏ, rẻ) gộp các extraction thành **MEMORY.md + memory_summary.md + skills/** (memory chính, summary, skill đề xuất). Hai cơ chế bảo vệ: **lease chống double-run** (chỉ một process chạy pipeline — không hai instance cùng consolidate) và **scan secrets trước khi ghi** (extraction có thể chứa secret — quét trước khi ghi vào memory). Nguyên tắc: **extraction riêng từng session (lọc active/stale), consolidation chéo bằng model rẻ, lease chống trùng, secrets scan trước persist**.

## Mô tả

mya autonomous memory pipeline: (1) **phase 1 extraction** — mỗi session: extract fact/insight, bỏ session mới quá (< X phút) / cũ quá (> Y ngày) / đang active; (2) **phase 2 consolidation** — model smol gộp extraction chéo session → MEMORY.md + summary + skills/; (3) **lease** — cross-process lock chống double-run; (4) **secrets scan** — threat-scan/redact trước khi ghi. mya có packages/memory sqlite-consolidate.ts (consolidate) + dream-cycle.ts (LLM consolidation khi idle) + packages/cron cross-process-lock.ts (lease) + packages/core threat-scan.ts — ABS thêm **2-pha pipeline** (extraction → consolidation) + **session filtering** (mới/cũ/active) + **secrets gate trước persist**.

## Kiến trúc

```
  SESSIONS (JSONL)
       │
       ▼
  PHASE 1 — EXTRACTION (từng session)
    ├─ bỏ session quá mới (< 30 phút — chưa đủ data)
    ├─ bỏ session quá cũ (> 30 ngày — stale)
    ├─ bỏ session đang active (sẽ thay đổi)
    └─ extract fact/insight per session
       │
       ▼
  PHASE 2 — CONSOLIDATION (chéo session, model smol)
    ├─ MEMORY.md (memory chính)
    ├─ memory_summary.md (summary)
    └─ skills/ (skill đề xuất từ pattern)
       │
       ▼
  LEASE (chống double-run)  +  SECRETS SCAN (trước ghi)
    └─ persist (chỉ khi lease giữ được + không secret)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/memory sqlite-consolidate.ts — consolidate (nền — ABS phase 2)
// ✅ packages/memory dream-cycle.ts — LLM consolidation khi idle (nền — ABS model-smol analog)
// ✅ packages/cron cross-process-lock.ts — file lock/lease (nền — ABS lease)
// ✅ packages/core threat-scan.ts — secrets/injection scan (nền — ABS secrets gate)
// ✅ packages/memory auto-capture.ts — tự capture (nền — ABS extraction analog)

// ❌ THIẾU: 2-pha pipeline tách bạch (extraction → consolidation)
// ❌ THIẾU: session filtering (mới/cũ/active bị loại)
// ❌ THIẾU: secrets gate trước persist (scan xong mới ghi)
```

## Implementation

```typescript
// packages/memory/src/memory-pipeline.ts (MỚI)
import { consolidate } from "./sqlite-consolidate.js";
import { scanContent } from "@my-agent/prompts";

export interface SessionMeta { id: string; startedAt: number; endedAt: boolean; msgCount: number }

const TOO_NEW_MS = 30 * 60_000;   // < 30 phút — chưa đủ data
const TOO_OLD_MS = 30 * 86_400_000; // > 30 ngày — stale

/** Phase 1: lọc session + extract từng session (bỏ mới/cũ/active). */
export function extractEligible(sessions: SessionMeta[], now = Date.now()): SessionMeta[] {
  return sessions.filter(s =>
    s.endedAt &&
    now - s.startedAt > TOO_NEW_MS &&
    now - s.startedAt < TOO_OLD_MS &&
    s.msgCount >= 3, // đủ data để extract có nghĩa
  );
}

export interface PipelineResult { consolidated: number; memoryMd: string; blockedSecrets: number }

/** Pipeline 2 pha: extraction → consolidation, có lease + secrets gate. */
export async function runMemoryPipeline(
  sessions: SessionMeta[],
  db: Parameters<typeof consolidate>[0],
  model: { summarize: (facts: string[]) => Promise<string> },
  acquireLease: () => (() => void) | null,
  secretsGate: (text: string) => { safe: boolean; blocked: number },
): Promise<PipelineResult> {
  const release = acquireLease();
  if (!release) return { consolidated: 0, memoryMd: "", blockedSecrets: 0 }; // lease fail → không double-run

  try {
    const eligible = extractEligible(sessions);                       // phase 1: lọc
    let consolidated = 0;
    for (const s of eligible) {
      const { consolidated: n } = consolidate(db, s.id);              // extract+consolidate per session
      consolidated += n;
    }
    const memoryMd = await model.summarize(eligible.map(s => s.id)); // phase 2: model smol chéo session
    const gate = secretsGate(memoryMd);
    if (!gate.safe) return { consolidated, memoryMd: "", blockedSecrets: gate.blocked }; // không ghi secret
    return { consolidated, memoryMd, blockedSecrets: 0 };           // persist khi đã qua gate
  } finally {
    release(); // lease trả — pipeline sau có thể chạy
  }
}
// Usage:
// const r = await runMemoryPipeline(sessions, db, smolModel, acquireCronLock, scanContent);
// → chỉ session ended + đủ tuổi được extract, lease chống trùng, secret bị chặn trước persist
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Memory tự động (không cần user nhắc — pipeline chạy nền) | ❌ Model cost (consolidation mỗi chu kỳ tốn token) |
| ✅ Session filter (bỏ mới/cũ/active — chỉ data chín) | ❌ Threshold tune (30 phút/30 ngày — phụ thuộc usage) |
| ✅ Lease chống double-run (2 process không consolidate trùng) | ❌ Lease stale (crash giữa chừng → lease hết hạn phải chờ) |
| ✅ Secrets gate (không ghi secret vào memory — an toàn) | ❌ Info loss (model smol summarize có thể mất chi tiết) |

## Khác các hướng gần

| | Ghi trực tiếp mọi session | Consolidate định kỳ (dream-cycle) | ABS: 2-Pha Pipeline |
|---|---|---|---|
| Lọc session | không | ít | **mới/cũ/active rõ** |
| Model | — | 1 model | **smol (rẻ) cho consolidation** |
| Double-run | — | có thể trùng | **lease chặn** |
| Secrets | không check | một phần | **gate trước persist** |

## Khi nào chọn

- Agent chạy nhiều session — muốn memory tự gộp thành MEMORY.md + skills/
- Muốn pipeline an toàn (không trùng lặp, không ghi secret)
- Đã có consolidate (sqlite-consolidate.ts) + lease (cross-process-lock.ts) — chỉ thêm 2-pha orchestration
- Nối packages/memory sqlite-consolidate.ts + dream-cycle.ts + packages/cron cross-process-lock.ts + packages/core threat-scan.ts; guard lease-timeout (lease có TTL — crash không kẹt vĩnh viễn), threshold-calibration (mới/cũ theo usage thật), và secrets-scan-before-write (mọi persist đi qua gate — không sót); ABS = autonomous memory pipeline, kết hợp 749 ABU blob-artifact-externalization (artifact lớn để ngoài session JSONL) + 750 ABV rulebook-normalization-pipeline (skills/ output normalize về Rule shape)
