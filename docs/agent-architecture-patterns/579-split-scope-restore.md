# Hướng VG: Split-Scope Restore — khôi phục chia 3 kiểu: code+conversation, chỉ conversation, chỉ code

> **Nguồn gốc:** oh-my-pi (split-scope restore); "restore code+conversation"; "restore conversation only"; "restore code only"; "granular checkpoint rollback scope" | **Coupling:** 🟢 — thêm scope selector vào restore API (dựa trên VF checkpoint engine) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (git-checkpoint + session restore sẵn — chưa có scope-split) | **Effort:** 2-3 tuần

## Nguồn gốc

**oh-my-pi** cho rằng rollback không phải **all-or-nothing** — người dùng có thể muốn **chỉ hoàn code** (file state) nhưng **giữ cuộc hội thoại** (để tiếp tục nói về code cũ), hoặc ngược lại **chỉ hoàn conversation** (undo lời nói) nhưng **giữ code** (đừng mất sửa đổi). Do đó restore chia **3 scope**: (1) **code + conversation** (full rollback), (2) **chỉ conversation** (undo chat, giữ file), (3) **chỉ code** (rollback file, giữ chat). Nguyên tắc: **code và conversation tách rời** — checkpoint hai luồng riêng, restore chọn scope. Khác **VF checkpoint thuần** (rollback hết) — VG **split scope**; khác undo monolithic — VG **fine-grained**.

## Mô tả

mya split-scope restore: checkpoint engine (VF) lưu **2 luồng** riêng — **code stream** (bare git commits) và **conversation stream** (session message log, cũng checkpoint theo turn). Restore API nhận `scope: 'full' | 'conversation' | 'code'`: full → restore cả hai; conversation → chỉ replay message log tới turn; code → chỉ checkout git tree tới turn. mya có VF checkpoint + session restore — VG thêm **dual-stream checkpoint** + **scope dispatcher**.

## Kiến trúc

```
  CHECKPOINT STORE (2 stream tách rời):
    code stream:         commit_aaa → commit_bbb → commit_ccc
    conversation stream: msg[1..3]  → msg[1..5]  → msg[1..7]
                          (turn 1)     (turn 2)     (turn 3)
        │
        │  RESTORE turn #2, scope = ?
        ▼
  ┌─── SCOPE DISPATCHER ──────────────────────────────────┐
  │                                                         │
  │  scope='full':          code → checkout bbb             │
  │                         convo → replay msg[1..5]        │
  │                         (rollback cả code lẫn chat)     │
  │                                                         │
  │  scope='conversation':  code → KEEP (commit ccc)        │
  │                         convo → replay msg[1..5]        │
  │                         (undo lời nói, giữ sửa code)    │
  │                                                         │
  │  scope='code':          code → checkout bbb             │
  │                         convo → KEEP (msg[1..7])        │
  │                         (rollback code, giữ chat tiếp)  │
  └───────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 578 git-bare-checkpoint (VF) — code checkpoint (nền — VG = code stream)
// ✅ session message log — conversation (nền — VG = convo stream)
// ✅ session restore — restore thuần (relate — VG = split scope)

// ❌ THIẾU: conversation stream checkpoint (per-turn msg snapshot)
// ❌ THIẾU: scope selector ('full' | 'conversation' | 'code')
// ❌ THIẾU: scope dispatcher (restore đúng stream theo scope)
```

## Implementation

```typescript
// packages/agent/src/split-scope-restore.ts (MỚI)
import { execSync } from 'node:child_process';

type RestoreScope = 'full' | 'conversation' | 'code';
interface TurnSnapshot { turnId: string; codeCommit: string; convo: string[] }

class SplitScopeRestore {
  private turns: TurnSnapshot[] = [];
  constructor(
    private bare: string,
    private workdir: string,
    private setConversation: (msgs: string[]) => void,
  ) {}

  // checkpoint cả 2 stream mỗi turn
  snapshot(turnId: string, codeCommit: string, convo: string[]): void {
    this.turns.push({ turnId, codeCommit, convo: [...convo] });
  }

  private find(turnId: string): TurnSnapshot | undefined {
    return this.turns.find(t => t.turnId === turnId);
  }

  restore(turnId: string, scope: RestoreScope): void {
    const snap = this.find(turnId);
    if (!snap) throw new Error(`no checkpoint for turn ${turnId}`);
    if (scope === 'full' || scope === 'code') {
      execSync(`git --git-dir="${this.bare}" --work-tree="${this.workdir}" checkout ${snap.codeCommit} -- .`);
    }
    if (scope === 'full' || scope === 'conversation') {
      this.setConversation([...snap.convo]); // replay message log tới turn
    }
  }
}

// Usage:
// restore.snapshot('turn-2', 'bbb', currentMsgs);
// restore.restore('turn-2', 'conversation'); // undo chat, giữ code
// restore.restore('turn-2', 'code');          // rollback code, giữ chat
// restore.restore('turn-2', 'full');          // rollback cả hai
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Fine-grained rollback (chọn scope) | ❌ Dual-stream storage (code + convo checkpoint) |
| ✅ Giữ phần cần (không mất sửa/chat) | ❌ Desync risk (code+convo không khớp khi split) |
| ✅ Linh hoạt (3 chế độ cho 3 nhu cầu) | ❌ Convo replay complexity (reconstruct state) |
| ✅ Undo chat mà giữ code (và ngược lại) | ❌ Snapshot overhead (mỗi turn 2 stream) |

## Khác các hướng gần

| | VF checkpoint thuần | Undo monolithic | VG: Split-Scope |
|---|---|---|---|
| Scope | Full (hết) | Full | **full / conversation / code** |
| Stream | 1 (gộp) | 1 | **2 (code + convo tách)** |
| Fine-grained | ❌ | ❌ | **✅ chọn scope** |

## Khi nào chọn

- User muốn rollback code nhưng giữ chat (tiếp tục nói về code cũ)
- Hoặc undo lời nói nhưng giữ sửa code (đừng mất công)
- Cần fine-grained restore (không all-or-nothing)
- Nối 578 git-bare-checkpoint (VF, code stream) + session message log (convo stream) + session restore; guard desync (warn khi split tạo state không khớp), convo-replay correctness (reconstruct đúng), và snapshot cost (prune turn cũ); VG = split-scope restore, kết hợp 578 VF (engine) + 580 nested-repo-boundary (code stream loại trừ repo lồng)
