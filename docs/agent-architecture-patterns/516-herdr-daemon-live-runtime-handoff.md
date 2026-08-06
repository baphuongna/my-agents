# Hướng SV: Herdr Daemon Live-Runtime Handoff — daemon upgrade/rollback chuyển giao runtime sống (PTY/process)

> **Nguồn gốc:** herdr `server/handoff.rs` (`HandoffManifest`, `ReceivedHandoff`, `MAX_FDS_PER_HANDOFF`, `MAX_REPLAY_BYTES_PER_PANE`, `handoff_socket_path`, `READY_TIMEOUT`, `OWNED_ACK_TIMEOUT`, `COMMIT_TIMEOUT`, `HandoffRuntimeState`); "FD passing via Unix socket"; "session snapshot + pane replay"; "live handoff between daemon versions"; "zero-downtime upgrade" | **Coupling:** 🟡 — thêm handoff protocol vào daemon (chuyển PTY FD + session snapshot giữa 2 process) | **Agent-agnostic:** ✅ | **Code sẵn:** ❌ (chưa có FD-passing handoff + runtime-state serialize) | **Effort:** 5-6 tuần

## Nguồn gốc

**herdr** (Rust terminal daemon) thực hiện **live runtime handoff**: khi daemon **upgrade/rollback** (đổi version), nó không giết PTY đang chạy — thay vào đó **chuyển giao runtime sống** sang process mới qua **Unix socket + FD passing**. Daemon cũ gói `HandoffManifest` (version, session snapshot, pane runtime state) + **pass PTY file-descriptors** (raw FD, tối đa 64/handoff) qua socket → daemon mới nhận FD, **attach lại** PTY (process con tiếp tục chạy, không đứt) + replay pane scrollback (tối đa 8KB/pane). Có **timeout** (`READY_TIMEOUT` 30s chờ new sẵn, `OWNED_ACK_TIMEOUT` 500ms ack đã nhận FD, `COMMIT_TIMEOUT`). Nguyên tắc: **upgrade không giết session** — chuyển FD sống, replay state, ack commit. Khác restart-thường (giết + spawn lại) — SV **zero-downtime live handoff**.

## Mô tả

mya daemon live-runtime handoff: (1) **Upgrade trigger**: daemon nhận lệnh upgrade/rollback. (2) **Spawn new**: boot daemon mới (version mới), sẵn sàng nhận. (3) **Manifest**: daemon cũ serialize `HandoffManifest` (session snapshot + pane state). (4) **FD pass**: pass PTY FD (raw, qua `SCM_RIGHTS`) + manifest qua Unix socket → daemon mới. (5) **Attach + replay**: new attach FD (PTY sống tiếp), replay scrollback. (6) **Ack + commit**: new ack `owned` (nhận FD xong) → old commit (exit sạch). (7) **Timeout guard**: chờ ready/ack/commit có timeout → fail-safe. mya daemon (natives) cần handoff — SV thêm **FD-passing protocol** + **runtime-state serialize** + **commit handshake**.

## Kiến trúc

```
  DAEMON OLD (v1) đang chạy PTY (vim, agent, shell sống)
        │ (upgrade trigger)
        ▼
  ┌─── SPAWN NEW (v2) ───────────────────────────────────┐
  │  boot daemon v2 → sẵn sàng nhận (READY_TIMEOUT 30s)   │
  └───────────────────────┬─────────────────────────────┘
                          │
  ┌─── HANDOFF (old → new qua Unix socket) ──────────────┐
  │  HandoffManifest { version, sessionSnapshot,         │
  │    panes: [HandoffRuntimeState...] }                  │
  │  + pass PTY FD (SCM_RIGHTS, max 64/handoff)           │
  │  + pane replay bytes (max 8KB/pane)                   │
  └───────────────────────┬─────────────────────────────┘
                          │ (new nhận)
                          ▼
  ┌─── ATTACH + REPLAY + ACK ────────────────────────────┐
  │  new: attach PTY FD (vim/agent TIẾP TỤC sống, không đứt)│
  │       replay scrollback (8KB/pane)                     │
  │       ACK owned (OWNED_ACK_TIMEOUT 500ms)              │
  │       COMMIT (COMMIT_TIMEOUT) → old exit sạch          │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ natives (Rust) — daemon core (nền — SV handoff protocol ở đây)
// ✅ PTY management — terminal spawn (nền — SV pass FD của PTY)
// ✅ session persist/restore — snapshot (nền — SV HandoffManifest)

// ❌ THIẾU: FD-passing protocol (SCM_RIGHTS qua Unix socket)
// ❌ THIẾU: runtime-state serialize (HandoffRuntimeState per pane)
// ❌ THIẾU: commit handshake (ready/owned-ack/commit timeout)
// ❌ THIẾU: pane replay (scrollback bytes, max cap)
```

## Implementation

```rust
// crates/natives/src/handoff.rs (MỚI — Rust)
use std::os::fd::RawFd;
use std::os::unix::net::UnixStream;
use serde::{Deserialize, Serialize};

const MAX_FDS_PER_HANDOFF: usize = 64;
const MAX_REPLAY_BYTES_PER_PANE: usize = 8 * 1024;
const READY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
const OWNED_ACK_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(500);

#[derive(Serialize, Deserialize)]
pub struct HandoffManifest {
    pub version: u32,
    pub source_version: String,
    pub snapshot: SessionSnapshot,
    pub panes: Vec<HandoffRuntimeState>,
}

pub struct ReceivedHandoff {
    pub manifest: HandoffManifest,
    pub fds: Vec<RawFd>,
    pub stream: UnixStream,
}

// OLD daemon: serialize manifest + pass PTY fds to NEW
pub fn send_handoff(socket: &UnixStream, manifest: &HandoffManifest, pty_fds: &[RawFd]) -> std::io::Result<()> {
    let bytes = serde_json::to_vec(manifest)?;
    // write manifest length + bytes, then SCM_RIGHTS sendmsg for fds (≤ MAX_FDS_PER_HANDOFF)
    send_fds(socket, &bytes, pty_fds)?;
    // wait for NEW ack "owned" (timeout OWNED_ACK_TIMEOUT) → safe to exit
    wait_ack(socket, OWNED_ACK_TIMEOUT)?;
    Ok(())
}

// NEW daemon: receive manifest + fds, attach PTY, replay, ack
pub fn recv_handoff(socket: &UnixStream) -> std::io::Result<ReceivedHandoff> {
    let (bytes, fds) = recv_fds(socket, MAX_FDS_PER_HANDOFF)?;
    let manifest: HandoffManifest = serde_json::from_slice(&bytes)?;
    // attach each pty fd → terminal keeps running (no kill)
    // replay scrollback (≤ MAX_REPLAY_BYTES_PER_PANE)
    send_ack(socket, "owned")?; // tell OLD: I own the fds now
    Ok(ReceivedHandoff { manifest, fds, stream: UnixStream::pair()?.0 })
}

// Usage (Rust via napi): daemon upgrade path
// let manifest = build_manifest(&session, &panes);
// send_handoff(&socket, &manifest, &pty_fds)?; // old → new
// new: recv → attach → replay → ack → old exits clean
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Zero-downtime upgrade (PTY không đứt) | ❌ FD-passing complexity (SCM_RIGHTS platform-specific) |
| ✅ Rollback an toàn (revert version giữ session) | ❌ Replay cap (scrollback > 8KB truncate) |
| ✅ Commit handshake (old exit sạch sau ack) | ❌ Timeout tuning (ready/ack/commit dễ race) |
| ✅ User không mất work (vim/agent sống tiếp) | ❌ Version skew (manifest schema khác version) |

## Khác các hướng gần

| | Restart thường | EI Cross-Device | SV: Live-Handoff |
|---|---|---|---|
| Cái gì | Giết + spawn lại | Sync session跨 máy | **Chuyển FD sống cùng daemon** |
| PTY | ❌ (giết) | N/A | **✅ tiếp tục sống** |
| Downtime | Có | N/A | **Zero (handoff)** |

## Khi nào chọn

- Daemon cần upgrade/rollback mà không giết session đang chạy
- PTY có process quan trọng (vim, agent, long-run) — không được đứt
- Muốn zero-downtime (user không thấy gián đoạn)
- Nối natives (Rust daemon) + PTY management + session persist; guard FD-passing correctness (SCM_RIGHTS, ≤64 fds), replay cap (scrollback truncate gracefully), commit timeout (old không exit trước ack → leak fd), và manifest version-skew (schema check); SV = live runtime handoff, cần Rust (napi-rs) cho FD-passing + determinism
