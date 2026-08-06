# Hướng AEJ: Lazy File Content Loading — tải file on-demand khi chuyển scope/file thay vì tải toàn bộ repo

> **Nguồn gốc:** pi-diff-review | **Coupling:** 🟢 — client-side loading, không đụng core | **Agent-agnostic:** ✅ | **Code sẵn:** ✅ (sẵn memory lazy loading + RPC request pattern) | **Effort:** 1 tuần

## Nguồn gốc

**pi-diff-review** (src/git.ts): file contents được **load on-demand khi chuyển scope/file** — window gửi **request-file payload qua Glimpse window** để xin nội dung từng file, **không tải toàn bộ repo** một lúc. Lợi ích: (1) **tiết kiệm bộ nhớ** — repo lớn (hàng nghìn file) không phải giữ toàn bộ diff text trong RAM window; (2) **khởi động nhanh** — window mở ngay với metadata (danh sách file, scope), content về sau khi user thực sự mở file; (3) chỉ fetch đúng cái đang xem — mỗi payload nhỏ, network/RPC nhẹ.

Failure mode bị chống: mở review window → tải diff toàn repo → giật, treo UI, tốn bộ nhớ, chậm khởi động; hoặc tải tất cả file dù user chỉ xem 3 file.

## Mô tả

Với mya, pattern = **request-response loading qua RPC bridge** (nối AEI review window): (1) window khởi động chỉ nhận **metadata**: scope + danh sách file thay đổi (path, status, stat) — nhỏ, render sidebar ngay; (2) user chọn file / chuyển scope → window gửi `request-file { path, scope }` qua RPC; (3) host (agent side) đọc content (nối AEH text-encoding, AEL diff-scope), trả về đúng file đó; (4) window **cache kết quả** để lần sau khỏi xin lại. Đã có nền: mya load memory lười qua `ragfs` (read on-demand), RPC `packages/rpc` request/reply — chỉ cần chuẩn hóa payload `request-file`. Nguyên tắc: **metadata eager, content lazy**.

## Kiến trúc (ASCII)

```
  REVIEW WINDOW MỞ (AEI)
    │  nhận METADATA: { scope, files: [{path,status}], totalBytes }
    │  — nhỏ, render sidebar tree ngay
    ▼
  USER CHỌN FILE / ĐỔI SCOPE (AEL)
    │
    ▼  REQUEST-FILE payload qua RPC
  HOST (agent side) đọc đúng 1 file
    ├─ detect encoding (AEH) · git diff theo scope (AEL)
    └─ trả { path, oldText, newText } — content LAZY
    │
    ▼
  WINDOW cache per-file → xem lại khỏi xin
  (repo nghìn file — RAM chỉ giữ file đang xem)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/rpc/src/tcp-server.ts — request/reply transport (nền request-file)
// ✅ packages/print/src/bg-runner.ts — session + manifest (host process)
// ✅ packages/memory/src/ragfs.ts — read-on-demand (đúng pattern lazy đã có)
// ✅ packages/tools/src/output-compress.ts — git diff reducers (metadata+content)
// ✅ packages/desktop — IPC contract (renderer invoke surface)

// ❌ THIẾU: payload contract chuẩn "request-file" cho window
// ❌ THIẾU: cache per-file bên window
// ❌ THIẾU: prefetch chiến lược (file lân cận / file hay mở)
```

## Implementation

```typescript
// packages/print/src/lazy-file-loader.ts (NEW)
export interface FileMeta { path: string; status: "changed" | "untracked" | "deleted"; }

export class LazyFileLoader {
  private cache = new Map<string, { oldText: string; newText: string }>();

  constructor(
    private rpc: RpcClient,
    private scope: "git-diff" | "last-commit" | "all-files",  // nối AEL
  ) {}

  /** Metadata eager — trả ngay, không đọc content. */
  async listFiles(): Promise<FileMeta[]> {
    return this.rpc.call("review.files", { scope: this.scope });
  }

  /** Content lazy — chỉ đọc khi user mở file, cache lần sau. */
  async loadFile(path: string): Promise<{ oldText: string; newText: string }> {
    const hit = this.cache.get(path);
    if (hit) return hit;                                   // cache hit
    const data = await this.rpc.call("review.request-file", { path, scope: this.scope });
    this.cache.set(path, data);                            // cache per-file
    return data;
  }
}
// Window mở: listFiles() ngay (metadata) → sidebar render tức thì
// User chọn file: loadFile(path) → content về đúng file — repo nghìn file OK
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Bộ nhớ window nhỏ — repo lớn vẫn mượt | ❌ Mỗi lần chuyển file có 1 round-trip RPC |
| ✅ Khởi động nhanh (metadata trước, content sau) | ❌ Cache phải invalidate khi file đổi giữa chừng |
| ✅ Chỉ fetch đúng cái đang xem — RPC nhẹ | ❌ Prefetch thiếu → hơi lag khi mở file liên tục |
| ✅ Đã có nền (ragfs lazy + rpc) — thêm contract | ❌ Cần hợp đồng payload ổn định giữa window/host |

## Khác các hướng gần

| | AEJ Lazy Loading | AEI Native Window | AEL Scope Switching |
|---|---|---|---|
| Trọng tâm | Tải content on-demand | UI chuyên dụng | Nhiều chế độ diff |
| Cơ chế | request-file + cache | RPC + desktop window | 3 scope git |
| Quan hệ | Bên trong window (AEI) | Vỏ ngoài | Đổi nguồn của loader |

## Khi nào chọn

- Repo lớn — review window treo khi tải toàn bộ
- Window UI cần mở nhanh (sidebar trước, content sau)
- Đã có rpc + ragfs lazy pattern — chỉ chuẩn hóa request-file
- Muốn bộ nhớ ổn định bất kể repo bao nhiêu file