# Hướng ABU: Blob Artifact Externalization — hai tầng lưu ngoài session JSONL: content-addressed blobs (global, dedup) + session-scoped artifacts

> **Nguồn gốc:** gajae-code (docs/blob-artifact-architecture.md) | **Coupling:** 🟡 — thêm blob store + artifact store vào session persistence | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có spill — chưa có content-addressed blob + artifact:// scheme) | **Effort:** 2 tuần

## Nguồn gốc

**gajae-code** lưu **ngoài session JSONL** bằng **hai tầng**: (1) **content-addressed blobs** — `blob:sha256`, **global** (không thuộc session), **dedup theo hash** (cùng nội dung → cùng blob, lưu 1 lần) — dành cho **binary lớn**; (2) **session-scoped artifacts** — `artifact://`, `agent://` — dành cho **tool output bị truncate** và **subagent output** — gắn với session/agent cụ thể. Mục tiêu: **session file luôn nhẹ** — JSONL chỉ chứa ref (blob:///artifact://) thay vì payload lớn; binary/output lớn nằm ngoài, có địa chỉ ổn định. Nguyên tắc: **payload lớn ra ngoài session, blob content-addressed (global + dedup), artifact session-scoped (tool/subagent output)**.

## Mô tả

mya blob artifact externalization: (1) **blob store** — ghi binary lớn với key `blob:sha256` (content-addressed, global — dedup theo hash); (2) **artifact store** — ghi tool output truncate + subagent output với key `artifact://<session>/<id>` và `agent://<agentId>/<id>` (session-scoped); (3) session JSONL chỉ lưu **ref** — nhẹ. mya có packages/core spill.ts (LargeValueRef — threshold 256KiB, sha-keyed, đã content-address analog) — ABU thêm **blob store chính thức** (global, dedup) + **artifact store** (session/agent scoped) + **ref scheme** (blob:///artifact:///agent://).

## Kiến trúc

```
  SESSION JSONL (luôn nhẹ)
  ┌──────────────────────────────────────────┐
  │  {"role":"tool","output":"blob:sha256:ab12.."}   ← binary lớn → ref
  │  {"role":"tool","output":"artifact://sess1/x"}   ← tool output truncate → ref
  │  {"role":"subagent","output":"agent://sub7/y"}   ← subagent output → ref
  └──────────────────────┬───────────────────┘
                         │
          ┌──────────────┴──────────────┐
          ▼                             ▼
  BLOB STORE (global)            ARTIFACT STORE (session-scoped)
  blob:sha256:<hash>             artifact://<session>/<id>
  ├─ binary lớn                 ├─ tool output truncate
  ├─ content-addressed          ├─ subagent output (agent://)
  └─ dedup theo hash            └─ gắn session/agent
  → global, lưu 1 lần           → resolve theo session context
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core spill.ts — LargeValueRef (sha-keyed, threshold 256KiB) (nền — ABU blob analog)
// ✅ packages/core resolveRef — verify sha (nền — ABU content-addressed verify)
// ✅ packages/memory sqlite-store.ts — lưu artifact refs (liên quan — ABU store)
// ✅ packages/agent exporters.ts — export context (liên quan — ABU ref resolution)

// ❌ THIẾU: blob store global (blob:sha256 — dedup theo hash, không thuộc session)
// ❌ THIẾU: artifact store session-scoped (artifact:// + agent://)
// ❌ THIẾU: ref scheme chuẩn (session JSONL chỉ chứa ref — luôn nhẹ)
```

## Implementation

```typescript
// packages/core/src/blob-artifact.ts (MỚI)
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** BLOB STORE — content-addressed, global, dedup theo hash. */
export class BlobStore {
  constructor(private root: string) { mkdirSync(root, { recursive: true }); }

  /** Ghi blob: key = sha256(content) → cùng content lưu 1 lần (dedup). */
  put(bytes: Buffer): string {
    const hash = createHash("sha256").update(bytes).digest("hex");
    const path = join(this.root, hash);
    if (!existsSync(path)) writeFileSync(path, bytes);
    return `blob:sha256:${hash}`;
  }
  resolve(ref: string): Buffer {
    const hash = ref.replace(/^blob:sha256:/, "");
    return readFileSync(join(this.root, hash));
  }
}

/** ARTIFACT STORE — session-scoped (artifact://<session> + agent://<agent>). */
export class ArtifactStore {
  constructor(private root: string) { mkdirSync(root, { recursive: true }); }

  put(scope: "session" | "agent", ownerId: string, id: string, content: string): string {
    const path = join(this.root, ownerId, id);
    mkdirSync(join(this.root, ownerId), { recursive: true });
    writeFileSync(path, content);
    return `${scope === "session" ? "artifact" : "agent"}://${ownerId}/${id}`;
  }
  resolve(ref: string): string {
    const [scheme, rest] = ref.split("://") as [string, string];
    const [ownerId, id] = rest.split("/") as [string, string];
    return readFileSync(join(this.root, ownerId, id), "utf8");
  }
}

// Usage:
// const blobs = new BlobStore("~/.mya/blobs");
// const ref = blobs.put(bigBinary);            // "blob:sha256:ab12..." — global, dedup
// sessionJsonl.push({ role: "tool", output: ref }); // session file nhẹ
// const artifacts = new ArtifactStore("~/.mya/artifacts");
// const aref = artifacts.put("session", "sess1", "x", truncatedToolOutput);
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Session JSONL nhẹ (chỉ ref — không payload lớn) | ❌ Ref resolution (đọc session phải resolve ref — thêm 1 bước) |
| ✅ Dedup theo hash (cùng binary → 1 blob, tiết kiệm disk) | ❌ GC phức tạp (blob không thuộc session — dọn khi nào?) |
| ✅ Global + content-addressed (địa chỉ ổn định, verify được) | ❌ Ref dangling (blob bị dọn nhưng session vẫn ref) |
| ✅ Artifact session-scoped (tool/subagent output gắn đúng chủ) | ❌ Path traversal (ownerId/id phải sanitize — chống ../) |

## Khác các hướng gần

| | Inline payload (JSONL đầy) | Spill (LargeValueRef) | ABU: Blob + Artifact 2 tầng |
|---|---|---|---|
| Session file | nặng | nhẹ | **nhẹ (ref chuẩn)** |
| Dedup | không | không | **blob content-addressed (global)** |
| Session-scoped | — | không | **artifact:// + agent://** |
| Scheme | raw | spill ref | **blob:// / artifact:// / agent://** |

## Khi nào chọn

- Session có binary lớn / tool output khổng lồ / subagent output — JSONL phình to
- Muốn dedup (nhiều session dùng chung binary) + session nhẹ
- Đã có spill.ts (LargeValueRef) — chỉ thêm 2 tầng chuẩn + scheme
- Nối packages/core spill.ts + session.ts + packages/agent exporters.ts; guard path-safety (ownerId/id sanitize — không ../), gc-strategy (blob GC theo refcount hoặc TTL — không dọn khi còn ref), và ref-resolution (mọi reader phải resolve được ref — không để dangling); ABU = blob artifact externalization, kết hợp 747 ABS autonomous-memory-pipeline (artifact là input cho consolidation) + 638 XN intermediate-results-on-disk (kết quả trung gian cũng ra disk)
