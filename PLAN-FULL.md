# PLAN-FULL.md — Kế hoạch hoàn thiện mya

> Trạng thái: 2026-07-12
> Approach: A (pi làm core, mya packages làm plugins)
> Build: ✅ 0 errors | Tests: ✅ 223 passed | Bundle: ✅ 13.4MB

## Tóm tắt gap analysis

### Chỗ đứt lớn nhất: "Wiring Chasm"

```
main.ts (CLI entry)
    ↓ createAgent({...})     ← KHÔNG truyền gì cả (chỉ providers + memoryDir)
    ↓ Gateway({...})          ← KHÔNG truyền cron/sync/collab/hooks
    ↓ onWsMessage            ← chỉ handle {text}, không handle {kind:"cron-fire"}
```

29 packages đã wire vào `createAgent`/`Gateway` **ở tầng interface**, nhưng **main.ts không gọi** với config thực tế → toàn bộ subsystems tồn tại nhưng không hoạt động.

---

## Phase 1: Wire main.ts → createAgent + Gateway (P0 — Critical)

> Không có phase này, 15 packages wired = "code có nhưng không chạy"

### 1.1 main.ts — truyền config đầy đủ cho createAgent

**File:** `packages/print/src/main.ts`

```typescript
// HIỆN TẠI (Lỗi):
const agent = createAgent({ providers, memoryDir, model });

// MỚI:
const secretStore = new SecretStore();
const auditLog = new AuditLog(makeSecretRedactor(secretStore));
const hooks = new HookRegistry();
const skillStore = new SkillStore();
skillStore.discover();  // ← THIẾU: load ~/.mya/skills/ + project/.mya/skills/

const agent = createAgent({
  providers, memoryDir, model,
  auditLog,        // Phase 1
  secretStore,     // Phase 1
  hooks,           // Phase 2
  wallet: new Wallet({ initial: { USD: 100 } }),  // Phase 3 (optional)
  tts: process.env.MYA_TTS === "1",               // Phase 6
  extensionHost: new PackageHost(),               // Phase 5
});
```

**Effort:** S (2h)
**Tasks:**
- [ ] Import SecretStore, AuditLog, makeSecretRedactor, HookRegistry, SkillStore, Wallet, PackageHost
- [ ] Instantiate + pass to createAgent
- [ ] Call `skillStore.discover()` after creation
- [ ] Thread `--model` CLI flag properly into createAgent

### 1.2 main.ts — truyền config cho Gateway

**File:** `packages/print/src/main.ts` → `runWebServer()`

```typescript
// HIỆN TẠI (Lỗi):
const gw = new Gateway({ port, onWsMessage });

// MỚI:
const cron = new CronScheduler();
const sync = new SyncServer();
const collab = new CollabRelay();

const gw = new Gateway({
  port, onWsMessage,
  cron,    // Phase 3
  sync,    // Phase 6
  collab,  // Phase 6
  hooks,   // Phase 2 (shared với agent)
  control: { /* ControlPlane config */ },
});
```

**Effort:** S (1h)
**Tasks:**
- [ ] Import CronScheduler, SyncServer, CollabRelay
- [ ] Instantiate + pass to Gateway

### 1.3 main.ts — sửa onWsMessage handle cron-fire

**File:** `packages/print/src/main.ts`

```typescript
// HIỆN TẠI (Lỗi — cron prompts bị drop):
onWsMessage: (session, data) => {
  const msg = data as { text?: string };
  if (msg.text) { void agent.run(msg.text, ...); }
},

// MỚI:
onWsMessage: (session, data) => {
  const msg = data as { text?: string; kind?: string; prompt?: string };
  if (msg.kind === "cron-fire" && msg.prompt) {
    void agent.run(msg.prompt, (e) => gw.broadcast(session, e));
  } else if (msg.text) {
    void agent.run(msg.text, (e) => gw.broadcast(session, e));
  }
},
```

**Effort:** S (30 min)

### 1.4 main.ts — RPC cancel thực sự

**File:** `packages/print/src/main.ts` L99

```typescript
// HIỆN TẠI: cancel: () => { /* abort handled per-session */ },
// MỚI: cancel: () => controller.abort(),
```

**Effort:** S (15 min)

---

## Phase 2: Cron Expression Parser (P1 — Important)

> Cron "cron" trigger type hiện là no-op

**File:** `packages/cron/src/index.ts`

**Effort:** M (half day)
**Tasks:**
- [ ] Implement cron expression parser (`*/5 * * * *`, `0 9 * * MON`, etc.)
- [ ] Update `due()` method to actually evaluate cron expressions
- [ ] Add tests: 10+ cron patterns
- [ ] Register sample cron jobs for demo

```typescript
// HIỆN TẠI (Lỗi):
// cron: best-effort skip (full cron-expr parser is Tier-2+)

// MỚI:
due(now = time.now()): CronJob[] {
  return this.jobs.filter(j => {
    if (!j.enabled) return false;
    if (j.trigger === "cron") return matchesCronExpr(j.schedule, now);
    if (j.trigger === "on-interval") { /* existing */ }
    if (j.trigger === "once") { /* existing */ }
    return false;
  });
}
```

---

## Phase 3: Sync + Collab HTTP/WS Binding (P1)

> SyncServer và CollabRelay tồn tại nhưng không có network transport

### 3.1 Sync HTTP endpoints

**File:** `packages/gateway/src/index.ts`

**Effort:** M (half day)
**Tasks:**
- [ ] Add routes: `POST /sync/pull`, `POST /sync/push`, `GET /sync/state`
- [ ] Wire to `SyncServer.pull()` / `.push()`
- [ ] Add tests: sync convergence between 2 replicas

### 3.2 Collab WS binding

**File:** `packages/gateway/src/index.ts`

**Effort:** M (half day)
**Tasks:**
- [ ] WS message: `{kind:"collab-join", room, role}` → `relay.join()`
- [ ] WS message: `{kind:"collab-publish", room, event}` → `relay.publish()`
- [ ] Broadcast published events to room members
- [ ] Add CollabRelay ring buffer for `snapshot()`

---

## Phase 4: DAP Fixes + Debug Tool Wiring (P1)

### 4.1 Fix DAP TCP socket leak bug

**File:** `packages/dap/src/client.ts`

**Effort:** S (30 min)
**Tasks:**
- [ ] Store socket reference on instance: `this.socket = net.connect(...)`
- [ ] In `disconnect()`: `this.socket?.end()` + null check

```typescript
// HIỆN TẠI (Bug):
async disconnect() {
  if (!this.proc) return;  // ← TCP mode proc=null → never disconnects!
  ...
}

// MỚI:
async disconnect() {
  if (this.proc) { this.proc.kill(); this.proc = null; }
  if (this.socket) { this.socket.end(); this.socket = null; }
}
```

### 4.2 Wire DAP debug tool into CLI

**File:** `packages/print/src/main.ts`

**Effort:** S (30 min)
**Tasks:**
- [ ] Add `dapConnect` config to createAgent when `--debug` flag passed
- [ ] Register `debug` tool (DangerFullAccess)

---

## Phase 5: Desktop App (P2 — Feature)

> TS contracts + Tauri shell OK, thiếu UI + bridge

### 5.1 Desktop frontend — web dashboard wrapper

**File:** `crates/desktop-ui/index.html` → full web app

**Effort:** L (1+ day)
**Tasks:**
- [ ] Copy/adapt `packages/web/src/index.ts` dashboard HTML
- [ ] Add Tauri IPC bridge (`window.__TAURI__`)
- [ ] Connect to local gateway WS (127.0.0.1:port)
- [ ] Add tray icon + notification permission

### 5.2 Tauri sidecar lifecycle

**File:** `crates/desktop-shell/src/main.rs`

**Effort:** L (1 day)
**Tasks:**
- [ ] Spawn `mya serve` as sidecar child process
- [ ] Gate window on `SidecarLifecycle.waitForReady()`
- [ ] Wire deep-link handler → `validateDeepLink()` → IPC to frontend
- [ ] Wire updater: `verifyUpdate()` before apply
- [ ] Add tray menu: Open / Quit / Settings

### 5.3 Build script

**Effort:** M (half day)
**Tasks:**
- [ ] `npm run desktop:build` → `cargo tauri build`
- [ ] `npm run desktop:dev` → `cargo tauri dev`
- [ ] CI: add desktop-shell to build matrix

---

## Phase 6: x402 Real Crypto (P3 — Frontier)

> Wallet hiện là in-memory stub, không có blockchain signing

**Effort:** L (1+ day)
**Tasks:**
- [ ] Replace `signDeterministic()` with real ECDSA/secp256k1
- [ ] Add key management (HD wallet from seed phrase)
- [ ] Real payment protocol (x402 spec compliance)
- [ ] Integration test with mock 402 server

---

## Phase 7: Eval Integration + Credentialed Tiers (P2)

> Eval hiện chỉ chạy "unit" tier

**File:** `packages/eval/src/harness.ts`

**Effort:** M (half day)
**Tasks:**
- [ ] Add integration tier runner (local mock services)
- [ ] Add credentialed tier runner (real API key, gated by `MYA_CREDENTIALED=1`)
- [ ] Golden fixture freshness gate (MAX_GOLDEN_AGE_DAYS=30)
- [ ] CI: run eval on every PR (unit tier only)

---

## Phase 8: Codebase Hygiene (P0 — Quick wins)

### 8.1 Declare esbuild as devDependency

**Effort:** S (5 min)
```bash
npm install -D esbuild@0.21.5
```

### 8.2 Fix README accuracy

**Effort:** S (1h)
**Tasks:**
- [ ] Test count: actual `npx vitest run` output
- [ ] Package count: 29 (not 40)
- [ ] Remove claims about features not yet wired in CLI
- [ ] Update test instructions (remove /tmp/*.mjs references)

### 8.3 Add `lint:rust` script

**Effort:** S (5 min)
```json
"lint:rust": "cargo clippy --workspace --all-targets -- -D warnings"
```

### 8.4 Add `prepublishOnly` hook

**Effort:** S (5 min)
```json
"prepublishOnly": "npm run build && npm test && npm run bundle"
```

---

## Phase 9: CI/CD Improvements (P2)

**File:** `.github/workflows/ci.yml`

**Effort:** M (half day)
**Tasks:**
- [ ] Matrix testing: ubuntu-latest + macos-latest + windows-latest
- [ ] Build desktop-shell in CI (`cargo build --workspace`)
- [ ] Run eval (unit tier) in CI
- [ ] Add integration test job (gated by secret)

---

## Ưu tiên thực thi

| Phase | Priority | Effort | Blocker? |
|---|---|---|---|
| **1. Wire main.ts** | P0 Critical | S (4h) | KHÔNG — làm ngay |
| **8. Hygiene** | P0 Quick wins | S (1h) | KHÔNG |
| **4. DAP fix** | P1 | S (1h) | KHÔNG |
| **2. Cron parser** | P1 | M (half day) | KHÔNG |
| **3. Sync/Collab binding** | P1 | M (1 day) | KHÔNG |
| **7. Eval tiers** | P2 | M (half day) | KHÔNG |
| **9. CI matrix** | P2 | M (half day) | KHÔNG |
| **5. Desktop app** | P2 Feature | L (2+ days) | Cần Tauri CLI |
| **6. x402 crypto** | P3 Frontier | L (1+ day) | Cần crypto research |

### Total effort: ~5-7 ngày làm việc

### Thứ tự đề xuất:
```
Phase 1 (wire)  →  Phase 8 (hygiene)  →  Phase 4 (DAP)
→  Phase 2 (cron)  →  Phase 3 (sync/collab)
→  Phase 7 (eval)  →  Phase 9 (CI)
→  Phase 5 (desktop)  →  Phase 6 (x402)
```

## Verification gates

Sau mỗi phase:
- [ ] `npm run build` — 0 errors
- [ ] `npx vitest run` — all pass
- [ ] `node scripts/bundle.mjs` — bundle works
- [ ] `mya "hello"` — MiniMax responds
- [ ] Git commit với message rõ ràng
