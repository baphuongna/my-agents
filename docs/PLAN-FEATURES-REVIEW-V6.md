# PLAN-FEATURES Deep Review v6 — Tools, Browser, Gateway Internals

> 3 more parallel explorers verified tools/web/browser, DAP/ACP/council, and gateway internals
> Date: 2026-07-21

---

## Executive summary

Round 6 verified the agent's **interaction layer** (tools, web, browser) and **gateway backbone**. Found the tools subsystem is the **most mature** in the codebase — production-grade browser automation, security gauntlet, output compression. But also found **4 issues**:

| # | Discovery | Impact |
|---|---|---|
| **R6-1** | Code execution bridge **implemented but NOT registered** | Feature exists, just needs 1 line wiring |
| **R6-2** | Push notification dispatch **gated on voiceCall** (logic bug) | Push disabled unless Twilio configured |
| **R6-3** | `sweepIdle` is **dead code** in 2 systems | Memory leak: channel sessions + handles never swept |
| **R6-4** | C1-C6 tools all **MISSING** but can build on `ToolImpl` pattern | Straightforward — no infrastructure needed |

---

## R6-1. Code execution bridge — implemented but NOT registered

**`packages/tools/src/codeexec.ts`** is a complete implementation:
- `makeCodeExecTool(toolExecutor, ctxSource)` factory
- Tool name: `code` (requiredMode: DangerFullAccess)
- Spawns `node --input-type=module` or `python3 -c` child process
- **Bidirectional JSON-RPC bridge** (newline-delimited)
- Child calls back into agent tools via `async tool(name, args)`
- Safety: MAX_TOOL_CALLS=50, 30s timeout, 10MiB stdout cap, DELEGATE_BLOCKED_TOOLS filter

**BUT**: exported via `packages/tools/src/index.ts:61` but **never called** in `packages/agent/src/` or `packages/print/src/`. The default `builtinTools` list does NOT include `code`.

**Impact**: The bidirectional code-exec bridge (spec §11.4) is **ready to use** — just needs `makeCodeExecTool()` called and registered. This is a ~5 LOC wiring fix, not new implementation.

---

## R6-2. Push notification dispatch — logic inversion bug

**`packages/gateway/src/index.ts:1635`**:
```ts
if (this.voiceCall) {
  void import("./push.js").then(m => m.notifyEvent({ kind, sessionId, summary }));
}
```

Push notifications only fire when `voiceCall` (Twilio) is configured. This is a **logic inversion** — push should fire regardless. Most installs have push subscribers but no Twilio.

**Impact**: Web push notifications are **effectively disabled** unless voice call is wired. Fix: remove the `if (this.voiceCall)` gate or make it `if (this.pushSubscriptions)`.

---

## R6-3. sweepIdle dead code — memory leak

Two sweep systems exist but are **never called from production**:

1. **`ChannelSessionRouter.sweepIdle()`** (`channel-session.ts:192`) — evicts idle channel sessions (default 3600s TTL). Grep confirms zero production callers. Channel sessions accumulate unbounded.

2. **`HandleLruCache.sweepIdle()`** (`control.ts:77`) — evicts idle runtime handles (128 max, 3600s TTL). Only called from `control.test.ts`. Handles retained up to LRU cap.

**Fix**: Wire both into the cron sweep timer (~10 LOC in gateway `start()`).

---

## R6-4. C1-C6 tools — all MISSING but infrastructure ready

All 6 planned tools are confirmed absent, but the **registration infrastructure is complete**:

```
ToolImpl = { meta: Tool; run(args, ctx): Promise<ToolResult> }
```

Just `toolRegistry.register(makeXxxTool())` and it works with:
- ✅ 7-step permission pipeline
- ✅ Mode satisfaction (`modeSatisfies`)
- ✅ Pre/post hooks
- ✅ Concurrent-approval serialization
- ✅ DegradedResult / failedCallIds
- ✅ Audit logging
- ✅ Tool search (BM25 deferred activation)

**Pattern to follow**: `web/search/provider.ts` backend interface with `isAvailable()` gate.

---

## Tools subsystem — FULLY FUNCTIONAL ✅

### 18 builtin tools
| Tool | Mode | Status |
|---|---|---|
| read, glob, grep, ls, find | ReadOnly | ✅ |
| write, edit, replace | WorkspaceWrite | ✅ |
| bash | DangerFullAccess | ✅ (SECRET_ENV filter, no sandbox) |
| screen_capture, screen_find | ReadOnly | ✅ (tesseract OCR) |
| browser_navigate/snapshot/click/type/scroll/back/press/screenshot/vision/close/search | Prompt | ✅ |
| web_search, web_extract | ReadOnly | ✅ (7 backends: tavily/exa/parallel/firecrawl/searxng/brave/ddgs) |
| web_fetch | ReadOnly | ✅ (universal HTTP→markdown floor) |
| hashline_edit | WorkspaceWrite | ✅ (4-char FNV anchors) |
| paid_fetch | WorkspaceWrite | ✅ (x402, when wallet configured) |

### Web security gauntlet — 6 layers
1. Secret-in-URL (prefix regex + sensitive param names)
2. SSRF metadata (unconditional: 169.254.169.254, metadata.google.internal)
3. SSRF private/internal (RFC1918, loopback, link-local, ULA)
4. Post-redirect re-check (per-hop)
5. Domain blocklist (fnmatch + ReDoS defense)
6. Bot detection (warning only)

### Browser engines — 5 backends
- **Camofox** (REST, anti-detect) — primary
- **Browserbase** (cloud)
- **browser-use** (cloud)
- **agent-browser** (local CLI)
- **web_fetch** (universal fallback floor)

Engine resolution: camofox → cloud → local, with hybrid routing (cloud + private URL → force local).

### Output compression — FULLY FUNCTIONAL
5-stage pipeline (stripAnsi → collapseBlankLines → filterProgress → deduplicate → truncate) + 4 tool reducers (git/tsc/npm/cargo). Never-worse guard. Wired in mya-bridge at 4096-token threshold.

---

## DAP / ACP / Council — ALL WIRED ✅

### DAP debugger
- `DapClient` (288 LOC) + `makeDebugTool` (122 LOC) + DAP server (204 LOC)
- Wired: imported in `agent/src/index.ts:57` and `mya-bridge.ts:49`
- Status: **FULLY FUNCTIONAL**

### ACP bridge
- `AcpBridge` + `AcpEventLedger` (bounded replay) + `relayPermission` (triple-gate)
- Wired: `shared-instances.ts:36` + `mya-bridge.ts:90`
- Status: **FULLY FUNCTIONAL**

### Council
- `CouncilProvider` (multi-model fan-out + voting) + `HindsightReviewer` + `adversarialReview`
- 8-provider detection (anthropic/openai/google/deepseek/groq/mistral/xai/openrouter)
- If ≥2 keys → multi-model council; else mock 1-member fallback
- Wired: `agent/src/index.ts:48` + `shared-instances.ts:40` + `mya-bridge.ts:64,94`
- Status: **FULLY FUNCTIONAL**

---

## Gateway internals — FULLY FUNCTIONAL ✅ (with quirks)

### Architecture
- **No router framework** — 50+ hand-rolled `if` blocks in `handleHttp()`
- **~33 optional callbacks** — adding features = add callback + route arm
- **Auth is strongest subsystem**: wsToken (crypto-random), HttpOnly cookie, CSRF Origin check, constant-time compare, cron-mutation gate, pairing-token gate
- **WS/SSE dual transport**: `/events` WS + `/sessions/:id/events` SSE, per-session retention (10k cap), cursor replay

### Adding new features (profiles/webhooks/PTY)
Each new feature needs:
1. Add callback(s) to `GatewayOptions` (e.g., `profilesList`, `profileSet`)
2. Add `if (url.pathname === "/...")` arm in `handleHttp()` default case
3. Auth inherited automatically (unless allowlisted)
4. Wire callback in `packages/print/src/main.ts`

---

## 6-round review — final summary

| Round | Focus | Explorers | Critical |
|---|---|---|---|
| v1 | Spec compliance | Manual | 15 issues |
| v2 | File paths + LOC | 3 agents | 6 wrong paths |
| v3 | Runtime code flow | 4 agents | 6 critical |
| v4 | Subsystem infra | 3 agents | 7 critical |
| v5 | Cognitive + security | 3 agents | 8 critical |
| v6 | Tools + browser + gateway | 3 agents | 4 issues |

**Total: 16 parallel explorers + manual analysis across 6 rounds.**

### Complete P0 prerequisite list (~425 LOC)

| # | Task | LOC | Source |
|---|---|---|---|
| 1 | Wire `scanInject` into channels | ~15 | v3 |
| 2 | Wire `deriveChild`/`releasePrecharge` in subagent | ~40 | v3 |
| 3 | Wire `DevicePairing`/`WebAuthn` in main.ts | ~10 | v3 |
| 4 | Channel polling loop | ~20 | v3 |
| 5 | Config loading mechanism | ~50 | v3 |
| 6 | Fix cross-device approval relay | ~200 | v4 |
| 7 | Wire `compressHistory` in createAgent | ~30 | v5 |
| 8 | Add skills to composeStableTier | ~20 | v5 |
| 9 | Fix backend registration | ~15 | v5 |
| 10 | Enable BrainStore persistence | ~10 | v5 |
| 11 | Fix push notification dispatch (remove voiceCall gate) | ~2 | v6 |
| 12 | Wire sweepIdle timers | ~10 | v6 |
| 13 | Register codeexec tool | ~5 | v6 |
| **Total** | | **~427** | |

---

## What's production-ready vs needs work

### ✅ Production-ready (can build on immediately)
- Agent loop (runTurn), permission (7-step), tool dispatch, tool registry
- Browser automation (8 tools, 5 engines, lifecycle, orphan reap)
- Web security gauntlet (6 layers, DNS resolution, encoding tricks)
- Output compression (5-stage + 4 reducers)
- Audit log (Merkle hash chain + verify + redactor)
- SecretStore (4 variants, redactor, rotation)
- x402 wallet (real ECDSA, 402-handling)
- Cron scheduler (at-most-once, claim/complete/sweep)
- Prompt assembly (3-tier, PromptMutex, cache-stable)
- Council (multi-model voting, hindsight, adversarial review)
- DAP debugger, ACP bridge
- Eval harness (3 tiers + egress guard)
- Skills (SkillStore, provenance, progressive disclosure)
- Roles (registry, filter, TUI /role)
- Gateway auth (strongest subsystem)
- Gateway WS/SSE broadcast + replay
- All 8 channel adapters (outbound + webhook inbound)
- Build/bundle/test pipeline

### ⚠️ Needs wiring before features can rely on them
- Code execution bridge (implemented, not registered)
- Compression (implemented, not wired in agent SDK)
- Skills in agent stable tier (only in mya-bridge)
- BrainStore persistence (not enabled by agent)
- DevicePairing/WebAuthn/VoiceCall (never instantiated)
- Channel inbound polling (dead code)
- scanInject on channels (not wired)
- scanInject scope differentiation (stub)
- Trust + Recovery FSM (not wired)
- Subagent budget isolation (deriveChild never called)
- Push notifications (gated on voiceCall bug)
- sweepIdle timers (dead code)
- Cross-device approval relay (broken)

### ❌ Missing / needs building from scratch
- Central config system (no config.toml)
- Profile system (stubs only)
- MCP OAuth (stdio only)
- PTY/terminal (no code)
- Sync auto-wiring (generic KV, nothing synced)
- Image/video gen, kanban, OSV, Tirith tools
- Desktop native shell (contract stub)
- Memory plane integration (3 disconnected systems)
