# Hướng RA: Terminal State as Files — mỗi terminal là file text (pid/cwd/last_command/exit+output)

> **Nguồn gốc:** Leaks Claude Code (BashOutput, background process state); "terminal as addressable text file"; "pid/cwd/last_command/exit+output per terminal"; "terminal_id resource"; "state persistence across commands"
> **Coupling:** 🟢 — thêm terminal-state serializer layer (terminal → file-like record agent read)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (bash tool + terminal session sẵn — chưa có per-terminal state file)
> **Effort:** 1-2 tuần

## Nguồn gốc

**Leaks Claude Code** quản lý **background process/terminal** bằng `run_in_background` + BashOutput — mỗi terminal có **terminal_id**, state (pid, cwd, last_command, exit code, output buffer). **Terminal state as files** trừu tượng hóa: mỗi terminal = **file text** có cấu trúc (`pid`, `cwd`, `last_command`, `exit`, `output`) — agent **read** terminal như read file, không cần theo dõi state thủ công. Nguyên tắc: **terminal là resource có địa chỉ** — agent nói "read terminal://3" lấy state đầy đủ (chạy gì, exit mấy, output gì). Khách **099 progressive-disclosure** (show on demand) — RA là **terminal-as-record**; khác log thuần — RA **structured fields**.

## Mô tả

mya terminal state as files: (1) **Spawn**: mỗi terminal/bash-session nhận terminal-id, ghi state-file `{ id, pid, cwd, lastCommand, exitCode, output }`. (2) **Update**: mỗi command → update state-file (lastCommand, exitCode, append output). (3) **Read**: agent `read terminal://N` → lấy state đầy đủ (không cần nhớ). (4) **Address**: terminal-id URI (`terminal://3`) như path file. (5) **Cleanup**: terminal exit → state-file giữ (history) nhưng mark terminated. mya có `bash` tool + terminal session — RA thêm **state serializer** (terminal → record) + **terminal:// URI** + **output ring-buffer** (tránh file phình).

## Kiến trúc

```
  TERMINAL SESSIONS (mỗi cái = file-like record):
  ┌─────────────────────────────────────────────────────┐
  │  terminal://1 (foreground, running)                  │
  │  { pid: 12345, cwd: "/repo",                          │
  │    lastCommand: "cargo test",                         │
  │    exit: null (still running),                        │
  │    output: "running 42 tests... [32/42]" }            │
  │                                                       │
  │  terminal://2 (background, done)                      │
  │  { pid: 12346, cwd: "/repo/src",                      │
  │    lastCommand: "npm run build",                      │
  │    exit: 0 (success),                                  │
  │    output: "✓ built in 12s" }                         │
  └───────────────────────┬─────────────────────────────┘
                          │ agent: "what's terminal://1 doing?"
                          ▼
  ┌─── READ terminal://N (like read file) ──────────────┐
  │  → state record: pid, cwd, lastCommand, exit, output │
  │  agent: "terminal 1 đang chạy cargo test (32/42),    │
  │          chưa xong" → chờ hoặc check lại              │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ bash tool — command execution (nền — RA = state record của nó)
// ✅ terminal session — shell tracking (nền — RA serialize state)
// ✅ read — file read (nền — RA tương tự cho terminal://)

// ❌ THIẾU: terminal state serializer (pid/cwd/lastCommand/exit/output record)
// ❌ THIẾU: terminal:// URI resolver (address per terminal)
// ❌ THIẾU: output ring-buffer (bounded, tránh phình)
// ❌ THIẾU: terminal-list tool (ls all terminals + status)
```

## Implementation

```typescript
// packages/agent/src/terminal-state.ts (MỚI)
interface TerminalState {
  id: string;
  pid?: number;
  cwd: string;
  lastCommand?: string;
  exitCode?: number | null;   // null = still running
  terminated: boolean;
  output: string;             // ring-buffered
}

class TerminalRegistry {
  private terminals = new Map<string, TerminalState>();
  private maxOutput = 10_000; // ring buffer

  spawn(id: string, cwd: string, pid: number, cmd: string): void {
    this.terminals.set(id, { id, pid, cwd, lastCommand: cmd, exitCode: null, terminated: false, output: '' });
  }

  appendOutput(id: string, chunk: string): void {
    const t = this.terminals.get(id);
    if (!t) return;
    t.output = (t.output + chunk).slice(-this.maxOutput); // ring buffer
  }

  finish(id: string, exit: number): void {
    const t = this.terminals.get(id);
    if (t) { t.exitCode = exit; t.terminated = true; }
  }

  read(uri: string): TerminalState | null {
    const id = uri.replace('terminal://', '');
    return this.terminals.get(id) ?? null;
  }

  list(): { id: string; status: string }[] {
    return [...this.terminals.values()].map(t => ({
      id: t.id,
      status: t.exitCode === null ? 'running' : t.terminated ? `exit:${t.exitCode}` : 'idle',
    }));
  }
}

// Usage:
// registry.spawn('terminal://3', '/repo', childPid, 'cargo test');
// registry.appendOutput('terminal://3', 'running 42 tests...');
// const state = registry.read('terminal://3');  // agent query
// → { pid:12345, cwd:'/repo', lastCommand:'cargo test', exitCode:null, output:'...' }
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent đọc terminal như file (state đầy đủ, không nhớ thủ công) | ❌ Output phình (cần ring-buffer bound) |
| ✅ Address URI (terminal://N rõ ràng) | ❌ Background pid race (pid reused sau exit) |
| ✅ History giữ (exit terminal vẫn xem output) | ❌ Multi-terminal (nhiều → agent quên id nào) |
| ✅ Nối bash tool (state từ execution) | ❌ Output binary không text-friendly |

## Khác các hướng gần

| | Log File | 099 Progressive-Disclosure | RA: Terminal-State-Files |
|---|---|---|---|
| Cái gì | Append-only log | Show on demand | **Structured terminal record** |
| Cấu trúc | Free text | UI gating | **pid/cwd/lastCommand/exit/output** |
| Address | Path | Trigger | **terminal://N URI** |

## Khi nào chọn

- Agent chạy nhiều terminal/background (cần track state)
- Muốn agent query terminal như file (địa chỉ URI)
- Cần history (exit terminal vẫn xem được output)
- Nối bash tool (spawn + output) + read (terminal:// URI); guard ring-buffer (output bound), pid-reuse race (mark terminated rõ), và terminal-list (agent biết có bao nhiêu terminal + status); RA = structured file abstraction cho terminal state
