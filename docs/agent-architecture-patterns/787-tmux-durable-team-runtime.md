# Hướng ADG: Tmux Durable Team Runtime — spawn worker CLI thật trong tmux panes, coordinate qua file state

> **Nguồn gốc:** oh-my-codex | **Coupling:** 🔴 — gắn cứng tmux + CLI ngoài (Codex/Claude), state qua filesystem | **Agent-agnostic:** ⚠️ — hỗ trợ Codex + Claude, nhưng cần CLI interop | **Code sẵn:** ⚠️ (sẵn skill team; thiếu backend tổng quát) | **Effort:** 2-3 tuần

## Nguồn gốc

`omx team` của **oh-my-codex** spawn **real worker CLI** (Codex CLI hoặc Claude CLI) trong **tmux panes** — mỗi worker là một process thật, có terminal riêng. Coordination không qua IPC phức tạp mà qua **files**: `.omx/state/team/...` chứa task assignment, progress, kết quả; **CLI team interop** cho phép worker báo trạng thái, yêu cầu task mới, nộp kết quả.

Điểm đáng chú ý trong skill: "durable hơn native subagents vì sống sót qua một local reasoning burst" — native subagent thường chết khi parent session chấm dứt, còn worker trong tmux pane sống độc lập, parent có thể attach lại. Skill cũng cảnh báo **không dùng trong Codex App** — môi trường sandbox không có tmux, pattern không chạy được.

## Mô tả

Pattern này tách **execution khỏi parent process**: worker là CLI ngoài chạy trong pane riêng, parent chỉ điều phối qua file contract. Với mya, tương đương là spawn **subagent ngoài tiến trình** — không phải `spawnSubagent` in-process (packages/agent) mà là child process chạy agent binary với session riêng, state ghi vào dir dùng chung, parent poll file state. Lợi ích: worker không chết theo parent, chạy được burst reasoning dài, restart parent vẫn thu hồi được kết quả.

## Kiến trúc (ASCII)

```
  PARENT (omx team)
    │  spawn: tmux new-window "codex ..." / "claude ..."
    ▼
  TMUX SESSION
    ├─ pane 1: worker Codex (task A) ──► .omx/state/team/a/status.json
    ├─ pane 2: worker Claude (task B) ──► .omx/state/team/b/status.json
    └─ pane 3: worker Codex (task C) ──► .omx/state/team/c/status.json
            │  (poll + write qua CLI team interop)
            ▼
  .omx/state/team/
    ├─ {task}/task.md   — assignment (đọc khi khởi động)
    ├─ {task}/status.json — progress: running/done/failed
    └─ {task}/result.md — output nộp lại
  ⚠️ cảnh báo: không chạy trong sandbox (Codex App) — cần tmux
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/agent/src/subagent.ts — spawnSubagent lifecycle
//   (spawn/list/get/kill) nhưng IN-PROCESS, chết theo parent
// ✅ packages/collab — relay + lifecycle (nền coordination)
// ✅ packages/core — LaneHeartbeat + durable-ack (nền status tracking)
// ✅ packages/memory — Brain SQLite (nền .omx/state/team/)
// ✅ packages/tools — permission.ts DELEGATE_BLOCKED_TOOLS (giới hạn worker)

// ❌ THIẾU: spawn worker CLI ngoài tiến trình (child process + tmux)
// ❌ THIẾU: file-based team state contract (task.md/status.json/result.md)
// ❌ THIẾU: parent attach/re-attach lại worker pane
```

## Implementation

```typescript
// packages/agent/src/team-worker.ts (NEW)
export interface TeamWorkerOpts {
  command: "codex" | "claude";          // CLI ngoài
  taskDir: string;                      // .state/team/{task}/
  prompt: string;
}

export async function spawnTeamWorker(opts: TeamWorkerOpts): Promise<WorkerHandle> {
  const { taskDir } = opts;
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(join(taskDir, "task.md"), opts.prompt);
  // tmux pane riêng — worker sống qua parent crash (durable)
  const pane = execSync(`tmux new-window -d "${opts.command} --file ${taskDir}/task.md"`);
  const handle: WorkerHandle = { pane, taskDir, status: "running" };

  // poll file state — worker báo qua CLI team interop
  const timer = setInterval(() => {
    const st = readStatus(join(taskDir, "status.json"));
    handle.status = st;
    if (st === "done" || st === "failed") clearInterval(timer);
  }, 2_000);
  return handle;
}

export function attachWorker(taskDir: string): string {
  // parent restart — attach lại pane, đọc result.md
  return readFileSync(join(taskDir, "result.md"), "utf8");
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Worker durable — sống qua parent crash | ❌ Gắn cứng tmux + CLI ngoài (không chạy sandbox) |
| ✅ Chạy burst reasoning dài không nghẽn parent | ❌ File polling — latency + race trên state |
| ✅ Mỗi worker có terminal riêng (debug được) | ❌ Quản lý pane/session phức tạp |
| ✅ Coordination đơn giản qua filesystem | ❌ CLI interop phải hỗ trợ (Codex/Claude khác nhau) |

## Khác các hướng gần

| | ADG tmux Team | ADF Madmax Profile | subagent in-process (mya) |
|---|---|---|---|
| Worker sống qua parent crash | ✅ | — | ❌ |
| Cần tmux/CLI ngoài | ✅ | Không | Không |
| Coordination | File state | Workflow stages | API in-process |

## Khi nào chọn

- Task song song lớn, mỗi worker chạy lâu (burst reasoning)
- Cần thu hồi kết quả sau khi parent restart
- Môi trường có tmux + CLI ngoài (không phải sandbox App)
- Chấp nhận coordination qua filesystem thay vì IPC chặt