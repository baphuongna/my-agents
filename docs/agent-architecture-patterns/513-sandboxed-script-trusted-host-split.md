# Hướng SS: Sandboxed-Script / Trusted-Host Split — workflow script sandbox riêng, factory/hook/transports trusted host

> **Nguồn gốc:** pi-extensible-workflows `execution.ts` / `host.ts` (`shellIdentityPath`, `agentIdentityPath`, `ShellIdentity`, `ShellOptions`); "workflow script execution isolated"; "factory/hook/transports run in trusted host"; "shell identity per boundary"; "trusted vs untrusted code split" | **Coupling:** 🟡 — tách 2 execution boundary: sandbox cho user/workflow script, trusted-host cho factory/hook/transports | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (shell exec + worktree sẵn — chưa có sandbox boundary + identity split) | **Effort:** 3-4 tuần

## Nguồn gốc

**pi-extensible-workflows** chia **2 execution boundary**: (1) **Trusted host** — factory (build agent), hook (lifecycle), transports (delivery) chạy trong host tin cậy (full quyền, identity riêng). (2) **Sandboxed script** — user-supplied workflow script / shell command chạy cô lập (worktree riêng, identity riêng `shellIdentityPath`, quyền hạn chế). Mỗi boundary có **shell identity** riêng (path, env, credentials khác nhau). Nguyên tắc: **không trộn code tin cậy với code không tin cậy** — script user cô lập, infra tin cậy full quyền. Khác **EC Agent-Sandbox** (cô lập toàn agent) — SS là **2-zone split trong workflow runtime**; khác worktree thuần — SS **identity + quyền theo zone**.

## Mô tả

mya sandboxed-script / trusted-host split: (1) **Trusted zone**: factory (spawn agent), hook (pre/post-run), transports (deliver result) — chạy host full quyền, identity `hostIdentity`. (2) **Sandbox zone**: workflow script (user JS/shell), agent-shell — worktree cô lập, identity `scriptIdentity` (giới hạn path/env/cred). (3) **Identity boundary**: mỗi zone có path-root + env + credentials riêng — script không thấy host cred. (4) **Bridge**: trusted-host gọi sandbox qua cổng kiểm soát (args sanitized, output censored). mya có `packages/agent` shell exec + worktree — SS thêm **2-zone runtime** + **identity split** + **controlled bridge**.

## Kiến trúc

```
  WORKFLOW RUN
        │
   ┌────┴──────────────────────────────────┐
   ▼                                        ▼
  ┌─── TRUSTED HOST ZONE ──────────┐  ┌─── SANDBOX ZONE ──────────────┐
  │  factory (spawn agent)          │  │  workflow script (user JS)    │
  │  hooks (pre/post-run lifecycle) │  │  agent shell command          │
  │  transports (deliver result)    │  │  → worktree cô lập            │
  │  identity: hostIdentity         │  │  identity: scriptIdentity     │
  │  quyền: FULL (cred, net, fs)    │  │  quyền: HẠN CHẾ (path-rooted)  │
  └────────────┬────────────────────┘  └──────────────┬───────────────┘
               │      controlled bridge (sanitized)    │
               └──────────────────────────────────────┘
            args sanitized → script runs → output censored → host
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/agent shell-exec — run command (nền — SS 2 zone dùng)
// ✅ worktree / agentWorktree — isolated dir (nền — SS sandbox zone)
// ✅ 292 lifecycle-hooks — hooks (nền — SS trusted zone hook)

// ❌ THIẾU: 2-zone runtime (trusted-host vs sandbox boundary)
// ❌ THIẾU: identity split (hostIdentity vs scriptIdentity: path/env/cred)
// ❌ THIẾU: controlled bridge (sanitized args in, censored output out)
// ❌ THIẾU: permission cap (sandbox zone: no host cred, path-rooted)
```

## Implementation

```typescript
// packages/agent/src/sandbox-split.ts (MỚI)
interface ShellIdentity { root: string; env: Record<string, string>; creds: string[] | null }

class SandboxSplit {
  // trusted zone: full host identity
  hostIdentity: ShellIdentity = { root: process.cwd(), env: process.env as Record<string, string>, creds: ['full'] };
  // sandbox zone: restricted
  scriptIdentity(cwd: string): ShellIdentity {
    return { root: cwd, env: { PATH: process.env.PATH!, HOME: cwd }, creds: null };
  }

  // run in trusted zone (factory/hook/transports) — full quyền
  async trusted<T>(fn: () => Promise<T>): Promise<T> { return fn(); }

  // run in sandbox zone (user script) — worktree + restricted identity
  async sandbox(
    script: string,
    worktree: string,
    exec: (cmd: string, ident: ShellIdentity) => Promise<string>,
  ): Promise<string> {
    const ident = this.scriptIdentity(worktree);
    return exec(script, ident); // path-rooted, no host cred
  }

  // controlled bridge: host → sandbox (sanitize args)
  bridgeIn(args: unknown): unknown {
    // strip cred/host-path from args before passing to sandbox
    return JSON.parse(JSON.stringify(args)); // deep clone, censor later
  }
  // sandbox → host (censor output)
  bridgeOut(output: string, ident: ShellIdentity): string {
    return output.replace(new RegExp(ident.root, 'g'), '<sandbox>'); // no path leak
  }
}

// Usage:
// await split.trusted(() => factory.spawnAgent(...));   // trusted zone
// const out = await split.sandbox(userScript, worktree, exec); // sandbox zone
// const safe = split.bridgeOut(out, ident);             // censor path
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Script user cô lập (không ăn host cred) | ❌ Identity overhead (2 env/path set) |
| ✅ Infra tin cậy full quyền (không bị hạn chế) | ❌ Bridge cost (sanitize/censor mỗi call) |
| ✅ Path-rooted (script không escape worktree) | ❌ Worktree sync (host/sandbox drift) |
| ✅ Clear threat model (2 zone rõ) | ❌ Complexity (2 runtime + identity + bridge) |

## Khác các hướng gần

| | EC Agent-Sandbox | Worktree thuần | SS: Sandbox/Host-Split |
|---|---|---|---|
| Cái gì | Cô lập toàn agent | Dir riêng | **2-zone split (trusted vs sandbox)** |
| Identity | 1 (agent) | 1 (dir) | **2 (host + script)** |
| Infra | ❌ (cùng sandbox) | ❌ | **✅ trusted full quyền** |

## Khi nào chọn

- Workflow có cả user-script (không tin cậy) và factory/hook/transports (tin cậy)
- Script user cần cô lập (không ăn host cred / path escape)
- Muốn infra full quyền nhưng script hạn chế
- Nối packages/agent shell-exec + worktree + 292 lifecycle-hooks; guard identity boundary (scriptIdentity no host cred, path-rooted), bridge quality (sanitize args in, censor output out), và worktree sync (host/sandbox consistent); SS = 2-zone split cho workflow runtime, kết hợp EC Agent-Sandbox
