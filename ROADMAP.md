# ROADMAP.md — Kế hoạch hoàn thiện mya

> Cập nhật: 2026-07-13 (sau audit toàn diện round 3)
> Trạng thái: Build ✅ | Tests 337 ✅ | Bundle ✅ 15MB | 29 packages
> Thay thế: PLAN-FULL.md (đợt 1 ✅), PLAN-V2.md (đợt 2 ⚠️), PLAN-REMAINING.md

## Tổng quan

```
Hoàn thành:  ~80%  (core production-grade)
Goal:        → 95% (production-ready)
Effort:      ~5 ngày (P0+P1) + ~5 ngày (P2) + Frontier (P3)
```

---

## P0 — Critical Wiring (15 min – 2h each)

> Các package đã code đầy đủ nhưng main.ts không wire → functionally dead

### Slice P0-1: Wire hooks/council/extensionHost vào createAgent (15 min)

**Vấn đề:** `createAgent()` ở print mode (main.ts:156) và RPC mode (main.ts:200)
không truyền `hooks`, `extensionHost`. Council chưa có trong AgentConfig.

**Impact:** Permission pipeline step 3 (hook override) dead trong 2/3 transports.
Extensions không load. Council advisor lane không chạy.

**Files:**
- `packages/print/src/main.ts` — thêm `hooks`, `extensionHost` vào 2 createAgent calls
- `packages/agent/src/index.ts` — thêm `council?: CouncilProvider` vào AgentConfig + wire vào runTurn

**Verification:**
- [ ] `mya "hello"` — hooks fire (audit log shows pre/post-tool entries)
- [ ] `mya --rpc` — extensionHost loads `~/.mya/extensions/`
- [ ] Council advisor emits after turn completion

---

### Slice P0-2: Port pi ls/find tools vào mya tools (2h)

**Vấn đề:** mya `tools/` chỉ có 9 builtins (read/write/edit/bash/grep/glob + 3).
Pi có ls, find, regex_search với rich formatting. Hiện TUI mode dùng pi tools,
nhưng print/rpc mode thiếu.

**Files:**
- `packages/tools/src/builtin.ts` — thêm `ls`, `find` implementations
- Port từ `packages/coding-agent/src/tools/` (pi source we own)

**Verification:**
- [ ] `mya "list files in current dir"` — agent uses ls tool
- [ ] `npx vitest run packages/tools` — all pass

---

## P1 — Functional Gaps (0.5 – 1 day each)

### Slice P1-1: Wrap pi-ai providers vào ProviderProfile (0.5 day) ⭐ HIGH IMPACT

**Vấn đề:** mya chỉ có OpenAIAdapter + MockProvider. Pi-ai có **37 providers**
(Anthropic, Google, Bedrock, Mistral, DeepSeek, Groq, Together, xAI, etc.)
nhưng chưa bridge vào ProviderProfile interface.

**Impact:** Mở khóa 30+ providers. Hiện chỉ MiniMax + OpenAI.

**Approach:** Adapter pattern — wrap pi-ai Provider → ProviderProfile

**Files:**
- `packages/ai/src/pi-ai-bridge.ts` — PiAiProvider implements ProviderProfile
  - `stream()` → delegate to pi-ai provider, map StreamEvent
  - `health()` → delegate to pi-ai health check
- `packages/agent/src/index.ts` — auto-detect pi-ai providers from env:
  - `ANTHROPIC_API_KEY` → Anthropic provider
  - `GOOGLE_API_KEY` → Google provider
  - `AWS_BEDROCK_*` → Bedrock provider
  - etc.
- `packages/ai/src/index.test.ts` — test bridge with mock pi-ai provider

**Verification:**
- [ ] `ANTHROPIC_API_KEY=xxx mya "hello"` — Claude responds
- [ ] `GOOGLE_API_KEY=xxx mya "hello"` — Gemini responds
- [ ] Tests pass for bridge adapter

---

### Slice P1-2: Test gaps — 5 packages 0 tests (1 day)

| Package | Test cần | Effort |
|---------|----------|--------|
| `council` | CouncilProvider mock + HindsightReviewer | 2h |
| `tts` | Platform detection + say/espeak fallback | 1h |
| `web` | SPA mount + WS event handling | 2h |
| `desktop` | TS contracts + Tauri IPC bridge | 1h |
| `dap-server` | Canned DAP response protocol | 1h |

**Verification:**
- [ ] `npx vitest run` — 342+ tests (337 + 5 new)
- [ ] No package has 0 test files

---

### Slice P1-3: Eval integration + credentialed tiers (0.5 day)

**Vấn đề:** Eval chỉ có unit tier. Thiếu integration tier (mock services)
và credentialed tier (real API). Không có CI quality gate.

**Files:**
- `packages/eval/src/harness.ts` — thêm IntegrationTier, CredentialedTier
- `packages/eval/src/index.ts` — gate credentialed by `MYA_CREDENTIALED=1`
- `.github/workflows/ci.yml` — run eval unit tier on every PR

**Verification:**
- [ ] `MYA_EVAL=unit npx vitest run packages/eval` — passes
- [ ] `MYA_CREDENTIALED=1 MYA_EVAL=integration` — uses mock services
- [ ] CI runs eval on PR

---

### Slice P1-4: Sync multi-replica convergence test (0.5 day)

**Vấn đề:** Sync (HLC + LWW + push/pull) chưa có convergence test.
CRDT correctness chưa validate.

**Files:**
- `packages/sync/src/convergence.test.ts` — 2-replica simulation:
  - Concurrent edits → converge
  - Partition → heal → converge
  - Clock skew → HLC ordering correct

**Verification:**
- [ ] Test passes: 2 replicas with concurrent edits converge to same state

---

## P2 — Feature Completion (1 – 2+ days each)

### Slice P2-1: Desktop frontend UI (2+ days)

**Vấn đề:** Tauri shell (400+ lines Rust) + TS contracts OK. Thiếu functional UI.

**Tasks:**
- [ ] Adapt `packages/web/src/index.ts` dashboard → Tauri webview
- [ ] Tauri IPC bridge (`window.__TAURI__`)
- [ ] Connect to local gateway WS (127.0.0.1:port)
- [ ] Tray icon + notification permission
- [ ] Sidecar lifecycle: spawn `mya serve` as child process
- [ ] Build script: `npm run desktop:build` → `cargo tauri build`

---

### Slice P2-2: ACP real external-agent transport (1+ day)

**Vấn đề:** AcpBridge hiện là interface-only (lineage + permission relay types).
Không có real external-agent spawn.

**Tasks:**
- [ ] Implement ACP protocol client (JSON-RPC over stdio)
- [ ] Spawn external agent process → ACP handshake
- [ ] Wire vào `packages/subagents/src/acp-runner.ts` (exists, untested)
- [ ] Test: spawn external agent → delegate task → get result

---

### Slice P2-3: Web dashboard build pipeline (1 day)

**Vấn đề:** `packages/web/` là vanilla JS SPA, không có build pipeline.

**Tasks:**
- [ ] Vite + React setup (or keep vanilla + esbuild)
- [ ] Component library: session list, approval modal, prompt bar
- [ ] Production build → `dist/web/`
- [ ] Gateway serves static files from `dist/web/`

---

### Slice P2-4: Invariant enforcement CI gates (0.5 day)

**Vấn đề:** §18 có 20 invariants. 6 enforced, 13 partial, 1 missing (#20 core-size gate).

**Tasks:**
- [ ] Invariant #20: core-size gate (PR template + CI check)
- [ ] madge CI gate: cross-transport imports forbidden
- [ ] clippy CI gate: `#![deny(clippy::exit)]` enforced

---

## P3 — Frontier (1+ day each, optional)

| Slice | Task | Effort | Notes |
|-------|------|--------|-------|
| P3-1 | x402 real ECDSA/secp256k1 | 1+ day | Replace HMAC, HD wallet |
| P3-2 | TTS MLX on-device backend | 1+ day | macOS only |
| P3-3 | More channels (WhatsApp/Signal/Matrix/Line) | 1+ day each | Adapter pattern exists |
| P3-4 | LLM-driven dream cycle | 1+ day | Offline skill consolidation |
| P3-5 | Council multi-model members | 1 day | Replace mock 1-member |

---

## Dependency Graph

```
P0-1 (hooks wiring) ──→ everything benefits
P0-2 (ls/find tools) ──→ P1-1 benefits (testing)
         │
P1-1 (pi-ai providers) ──→ P3-5 (council multi-model)
         │
P1-2 (tests) ──┐
P1-3 (eval) ───┼── independent, parallel
P1-4 (sync) ───┘
         │
P2-1 (desktop UI) ──→ P2-3 (web build) shares components
P2-2 (ACP transport) ──→ P3-4 (dream cycle) uses subagents
P2-4 (invariant CI) ── independent
```

---

## Thứ tự thực thi đề xuất

### Sprint 1: P0 (1 day)
```
P0-1 (hooks wiring, 15 min)
→ P0-2 (ls/find tools, 2h)
→ Verify: build + test + real LLM
```

### Sprint 2: P1 (3 days, parallel)
```
P1-1 (pi-ai providers, 0.5 day)  ⭐ highest impact
| P1-2 (test gaps, 1 day)
| P1-3 (eval tiers, 0.5 day)
| P1-4 (sync convergence, 0.5 day)
→ Verify: 342+ tests, multi-provider works
```

### Sprint 3: P2 (4 days)
```
P2-1 (desktop UI, 2 days)
| P2-2 (ACP transport, 1 day)
| P2-3 (web build, 1 day)
| P2-4 (invariant CI, 0.5 day)
```

### Sprint 4: P3 (frontier, optional)
```
Pick based on need: x402 / TTS / channels / dream cycle / council
```

---

## Verification Gates

Sau mỗi slice:
- [ ] `npm run build` — 0 errors
- [ ] `npx vitest run` — all pass (no regressions)
- [ ] `node scripts/bundle.mjs` — bundle works
- [ ] `mya "hello"` — real LLM responds
- [ ] Git commit với message rõ ràng (reference slice ID)

---

## Đã hoàn thành (kể từ PLAN-FULL đợt 1)

- [x] Phase 1: Wire main.ts → createAgent + Gateway
- [x] Phase 2: Cron expression parser (5-field, names, steps, ranges)
- [x] Phase 3: Sync/Collab HTTP/WS binding
- [x] Phase 4: DAP socket leak fix + debug tool
- [x] Phase 8: Codebase hygiene
- [x] Subagent system (3-layer: mya basic + pi core + TUI)
- [x] Gateway stability (50 concurrent webhooks stable)
- [x] Multi-bot channels (Telegram/Discord/Slack/Email/Webhook)
- [x] Launcher 4-tab TUI (Sessions/Channels/Cron/Status)
- [x] Dead code cleanup (~1350 LOC removed)
- [x] AgentPool consolidation (PiSessionPool → AgentPool)
- [x] Review rounds 1+2 fixes (21 findings, 18 fixed)
