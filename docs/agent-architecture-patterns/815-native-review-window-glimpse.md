# Hướng AEI: Native Review Window (Glimpse) — chuyển review diff ra khỏi terminal sang UI chuyên dụng

> **Nguồn gốc:** pi-diff-review | **Coupling:** 🟡 — bridge qua RPC, không đụng core loop | **Agent-agnostic:** ⚠️ — phụ thuộc desktop shell + web UI | **Code sẵn:** ⚠️ (sẵn bg-runner + rpc + desktop; thiếu review window) | **Effort:** 2 tuần

## Nguồn gốc

**pi-diff-review** có lệnh `/diff-review`: mở **cửa sổ review native** bằng **Glimpse + Monaco** với **sidebar tree** (danh sách file thay đổi) và **fuzzy file search** (tìm nhanh file trong diff). Lý do: review diff trong terminal bị giới hạn — khó xem song song original/modified, khó highlight theo cú pháp, khó gõ comment tại dòng. Chuyển review sang **UI chuyên dụng** giúp: (1) tận dụng editor thật (Monaco — syntax highlight, diff view, inline comment); (2) giữ agent loop không bị chặn bởi rendering; (3) một cửa sổ chuyên biệt cho một việc (review) thay vì nhồi vào terminal.

## Mô tả

Với mya, pattern = **lệnh review mở native window qua desktop shell contract**: (1) transport (print/TUI) bắt lệnh `/diff-review` → (2) gom diff data (nối AEL diff-scope + AEH text-encoding) → (3) gửi qua **RPC bridge** (mya đã có `packages/rpc` TCP server + `packages/print/bg-runner`) tới desktop shell → (4) shell mở Glimpse-class window (web UI — mya đã có `packages/web` React) chạy Monaco diff + sidebar tree + fuzzy search → (5) kết quả review (comment, approve) gửi ngược về agent qua event. Không đụng core loop — window là **view bên ngoài** gắn qua RPC. Nối AEK (comment → prompt) để feedback quay vào editor agent.

## Kiến trúc (ASCII)

```
  TERMINAL (print transport)
    │  /diff-review
    ▼
  RPC BRIDGE (packages/rpc TCP + bg-runner manifest)
    │  payload: { files[], diff[], scopes[] }
    ▼
  DESKTOP SHELL (packages/desktop contract — myagent:// deep-link)
    │
    ▼
  NATIVE REVIEW WINDOW (web UI: Monaco + sidebar tree + fuzzy search)
    ├─ sidebar tree: cây file thay đổi
    ├─ fuzzy search: tìm file nhanh
    └─ Monaco: diff view original/modified + inline comment
    │
    ▼  approve / comment
  EVENT VỀ AGENT (nối AEK — compile thành feedback prompt)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/rpc/src/tcp-server.ts — TCP RPC (bridge sẵn)
// ✅ packages/print/src/bg-runner.ts — background session + manifest
//   (mô hình spawn process + kết nối lại — nền cho native window)
// ✅ packages/desktop — desktop shell contract (deep-link, IPC surface)
// ✅ packages/web — React web UI (Monaco-class view có thể ghép vào)
// ✅ packages/tools/src/output-compress.ts — git diff reducers (nguồn diff)
// ✅ packages/intercom — UI compose/session-list (pattern UI gắn transport)

// ❌ THIẾU: lệnh /diff-review + payload contract
// ❌ THIẾU: native window host (Glimpse tương đương) với Monaco
// ❌ THIẾU: sidebar tree + fuzzy file search trong window
```

## Implementation

```typescript
// packages/print/src/diff-review.ts (NEW — transport command)
export interface ReviewWindowRequest {
  kind: "diff-review";
  scope: "git-diff" | "last-commit" | "all-files";   // nối AEL
  files: Array<{ path: string; oldText: string; newText: string }>;
}

export async function openReviewWindow(
  rpc: RpcClient,             // packages/rpc client
  req: ReviewWindowRequest,
): Promise<ReviewVerdict> {
  const session = await rpc.call("review.open", req);  // spawn/attach window
  // window UI (web) render sidebar tree + Monaco diff view
  // user: fuzzy-search file → xem diff → comment/approve
  const verdict = await rpc.call("review.await", { sessionId: session.id });
  return verdict;   // { approved, comments[] } → nối AEK thành prompt
}
// Desktop shell: myagent://review/open?sessionId=... (deep-link đã sẵn contract)
// Không đụng core loop — window là view ngoài qua RPC
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Review diff chất lượng cao (Monaco + sidebar + search) | ❌ Cần desktop shell + web UI — không chạy terminal-only |
| ✅ Agent loop không bị chặn bởi rendering | ❌ RPC bridge thêm surface (security: validate payload) |
| ✅ Comment inline tại dòng → prompt chính xác (AEK) | ❌ Fuzzy search cần index — thêm state window |
| ✅ Tái dùng rpc/bg-runner/desktop có sẵn | ❌ Phân mảnh: review tách khỏi terminal context |

## Khác các hướng gần

| | AEI Native Review Window | AEJ Lazy File Loading | AEL Diff Scope Switching |
|---|---|---|---|
| Trọng tâm | UI chuyên dụng cho review | Tải file on-demand | Nhiều chế độ so sánh |
| Cơ chế | RPC + desktop window | Request-file payload | 3 scope git |
| Quan hệ | Vỏ ngoài (view) | Tối ưu bên trong window | 1 scope của window |

## Khi nào chọn

- Review diff nhiều — terminal không đủ (comment, so song song)
- Đã có desktop shell + web UI + rpc bridge — thêm window host
- Muốn tách review khỏi agent loop (không render trong turn)
- Sẵn sàng duy trì thêm một surface UI native