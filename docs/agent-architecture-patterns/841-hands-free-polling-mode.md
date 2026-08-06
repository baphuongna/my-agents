# Hướng AFI: Hands-Free Polling Mode — trả sessionId ngay, agent poll status/output với incremental/drain và rate limiting

> **Nguồn gốc:** pi-interactive-shell | **Coupling:** 🟢 — session API, không đụng core loop | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn bg-runner session; thiếu poll/drain contract) | **Effort:** 1 tuần

## Nguồn gốc

**pi-interactive-shell** (session-manager.ts): **mode hands-free trả sessionId ngay** (tool không chờ CLI xong — trả handle lập tức), **agent poll status/output** với **incremental/drain** — (1) **incremental** — chỉ nhận **dòng mới** (server track vị trí — client không nhận lại dòng cũ), (2) **drain** — nhận hết phần còn lại tới hiện tại — và **rate limiting** — chạy dài hạn **không chặn turn** (agent gọi poll theo nhịp, CLI chạy nền).

Giá trị: (1) **không chặn turn** — CLI chạy lâu (build, test, migrate) không treo tool call — agent nhận sessionId và tiếp tục; (2) **tiết kiệm** — incremental: không tốn bandwidth/token cho dòng cũ đã thấy; (3) **kiểm soát** — agent quyết định poll khi nào (rate limit), drain khi cần toàn bộ; (4) **tách bạch** — session-manager quản lý vòng đời CLI nền, agent chỉ tiêu thụ qua poll.

## Mô tả

Với mya, pattern = **long-running session API trên tool exec**: (1) mya đã có **`packages/print/bg-runner.ts`** — background session + manifest + TCP RPC (mô hình session nền đã sẵn) — pattern này áp cho **tool execution** (codeexec/test/migrate dài); (2) **contract** — tool `exec_long` trả `{ sessionId, status: "running" }` ngay; agent poll `poll_status(sessionId)` / `poll_output(sessionId, { mode: "incremental" | "drain", maxLines })`; (3) **server state** — session manager track `cursor` (vị trí output đã gửi) — incremental trả từ cursor, drain trả hết rồi cập nhật cursor; (4) **rate limiting** — poll tối đa N lần/phút (agent không spam) — nối budget/cost tracker (core có budget.ts); (5) **timeout/abort** — session treo → watchdog (AEZ tinh thần) + abort (AEP) — kill process nền; (6) **nối AET** — output build/test dài → parse qua test-run-detector khi cần verdict. Đây là pattern **async tool ergonomics**: tool không bắt agent chờ — trả handle, agent chủ động lấy kết quả theo nhịp.

## Kiến trúc (ASCII)

```
  AGENT GỌI exec_long (build/test/migrate — chạy dài)
    │
    ▼ SESSION MANAGER (session-manager pattern — bg-runner nền)
  ├─ spawn process nền (codeexec/bg-runner)
  └─ trả NGAY: { sessionId, status:"running" }   ──► KHÔNG chặn turn
    │
    ▼ AGENT POLL (theo nhịp — rate limiting)
  ├─ poll_status(sessionId) ──► { status } 
  ├─ poll_output({ mode:"incremental" }) ──► CHỈ dòng MỚI (server track cursor)
  └─ poll_output({ mode:"drain" })       ──► hết phần còn lại → cập nhật cursor
    │
    ▼ KẾT THÚC (exit code) → kết quả → nối AET parse nếu là test
  (CLI chạy nền — agent không treo, dòng cũ không gửi lại)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/print/src/bg-runner.ts — background session + manifest + TCP RPC
//   (mô hình session nền — nền cho session-manager)
// ✅ packages/tools/src/codeexec.ts — spawn child (execution engine)
// ✅ packages/core/src/budget.ts — budget/cost (rate limiting tinh thần)
// ✅ packages/core/src/loop.ts — vòng agent (nơi poll theo nhịp)
// ✅ packages/eval/src/test-run-detector.ts (AET) — parse output test khi xong
// ✅ packages/workflows/src/runner.ts — abort/timeout (AEP)

// ❌ THIẾU: exec_long tool contract (sessionId trả ngay)
// ❌ THIẾU: poll API (status + output incremental/drain + cursor)
// ❌ THIẾU: rate limiting poll + watchdog/abort session treo
```

## Implementation

```typescript
// packages/tools/src/hands-free-session.ts (NEW)
export type PollMode = "incremental" | "drain";

export interface LongSession {
  sessionId: string;
  status: "running" | "exited";
  cursor: number;               // vị trí output đã gửi cho agent
}

export class SessionManager {
  private sessions = new Map<string, LongSession>();
  private outputs = new Map<string, string[]>();

  /** Trả sessionId NGAY — không chặn turn. */
  start(id: string, spawn: () => Promise<number>): { sessionId: string; status: "running" } {
    this.sessions.set(id, { sessionId: id, status: "running", cursor: 0 });
    this.outputs.set(id, []);
    void spawn().then((code) => {
      const s = this.sessions.get(id);
      if (s) s.status = code === 0 ? "exited" : "exited";
    });
    return { sessionId: id, status: "running" };
  }

  /** Incremental: chỉ dòng MỚI (server track cursor — không gửi lại dòng cũ). */
  pollOutput(sessionId: string, mode: PollMode, maxLines = 200): { lines: string[]; status: string } {
    const s = this.sessions.get(sessionId);
    const all = this.outputs.get(sessionId) ?? [];
    const start = mode === "incremental" ? s?.cursor ?? 0 : 0;
    const lines = all.slice(start, start + maxLines);
    if (s && mode === "incremental") s.cursor = Math.min(all.length, s.cursor + lines.length);
    else if (s) s.cursor = all.length;               // drain → cursor về cuối
    return { lines, status: s?.status ?? "exited" };
  }

  append(sessionId: string, chunk: string): void {
    this.outputs.get(sessionId)?.push(...chunk.split("\n"));
  }

  /** Rate limiting: poll tối đa N lần/phút cho mỗi session. */
  pollBudget(sessionId: string, maxPerMinute = 20, now = Date.now()): boolean { /* … */ return true; }
}
// Agent: exec_long → {sessionId} → tiếp tục turn → poll theo nhịp (rate limit)
// Nối AET: output test dài → drain → parseTestOutput → verdict
// Nối AEP: session treo (watchdog) → kill process nền — không kẹt mãi
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không chặn turn — CLI dài chạy nền, agent tiếp tục | ❌ Poll thêm round-trip + cần rate limit kỷ luật |
| ✅ Incremental — không tốn bandwidth/token cho dòng cũ | ❌ Cursor state phải nhất quán (agent mất sync → lệch) |
| ✅ Drain — lấy toàn bộ khi cần (parse verdict) | ❌ Session nền cần cleanup (leak nếu không drain/kill) |
| ✅ Nền bg-runner/codeexec có sẵn | ❌ Exit code/status edge (kill -9, crash) phải xử lý |

## Khác các hướng gần

| | AFI Hands-Free Poll | AFH PTY Overlay | AEZ Tab Status |
|---|---|---|---|
| Trọng tâm | Chạy dài không chặn turn | CLI tương tác + takeover | Trạng thái session |
| Cơ chế | sessionId + poll/drain/cursor | PTY + input arbiter | FSM + watchdog 180s |
| Quan hệ | Non-interactive path | Interactive path (ngược) | Trạng thái ngoài |

## Khi nào chọn

- Agent chạy lệnh dài (build/test/migrate) — không muốn treo turn
- Cần lấy output từng phần (incremental) để theo dõi tiến trình
- Đã có bg-runner session + codeexec spawn — thêm poll/drain contract
- Muốn agent chủ động poll theo nhịp (rate limit) thay vì chờ blocking