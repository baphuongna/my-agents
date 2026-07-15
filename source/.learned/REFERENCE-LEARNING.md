# REFERENCE LEARNING — 11 Repos Deep-Read + Applied Patterns

> Complete study of 11 open-source pi ecosystem repos.
> Each repo was deep-read, patterns extracted, and applied to mya.

---

## 📊 Study Summary

| # | Repo | Category | Key Pattern | Applied to mya |
|---|------|----------|-------------|----------------|
| 1 | **openpi** | Desktop app | Sidecar process isolation, reconcile streaming | ✅ Dashboard session mgmt, WS session param |
| 2 | **pi-session-manager** | Web UI | Transport interface, event bus, delta merging | ✅ Dashboard session list/create/select/kill |
| 3 | **pi-mobile** | Mobile gateway | SSE streaming, session takeover, WebAuthn | ✅ SSE endpoint, /models, /repos, takeover |
| 4 | **pi-themes** | TUI themes | 25 JSON theme palettes | ✅ Ported to ~/.mya/themes/ |
| 5 | **pi-computer-use** | Browser automation | CDP action model, outline extraction | 📐 UiAction union, OutlineNode pattern |
| 6 | **pi-dynamic-workflows** | Workflows | Per-stage model routing, adversarial review | ✅ Model routing module |
| 7 | **pi-vcc** | Compaction | Ranked block selection, structured sections | 📐 Compaction scoring system |
| 8 | **hypa** | Output compression | 5-stage pipeline, tool-specific reducers | ✅ output-compress.ts module |
| 9 | **pi-lens** | LSP diagnostics | Impact cascade, touchFile(), diagnostic tiers | 📐 LSP cascade blueprint |
| 10 | **pi-soly** | Key rotation | Multi-key per provider, two-tier cooldown | ✅ key-rotation.ts module |
| 11 | **pi-hashline-edit-pro** | Edit tool | Hash-anchored edits, stable hash mapping | ✅ hashline-edit.ts module |

✅ = Implemented · 📐 = Design ready (blueprint documented)

---

## 🏗️ Architecture Patterns Learned

### 1. Sidecar Process Isolation (openpi)
```
Main Process (lean, ≤100MB)
  └── utilityProcess.fork(sidecar.ts)
       └── Pi SDK (sessions, models, auth)
       └── JSON IPC with requestId correlation
       └── Auto-restart (3 max, exponential backoff)
```
**mya application**: Gateway already uses this model (AgentPool = process-level sessions)

### 2. Polymorphic Transport (pi-session-manager)
```typescript
interface Transport {
  invoke<T>(cmd: string, payload?: unknown): Promise<T>
  onEvent<T>(event: string, cb: (payload: T) => void): Promise<() => void>
}
// WebSocketTransport | HttpTransport | TauriTransport
```
**mya application**: Dashboard uses raw WS — could adopt Transport interface for HTTP fallback

### 3. SSE + Session Takeover (pi-mobile)
```
Client A (controller) ──┐
Client B (viewer)    ──┼──► Session ──► Agent
Client C (viewer)    ──┘
  • Only controller can send commands
  • POST /sessions/:id/takeover → swap controller
  • abort is controller-free (any client can stop)
```
**mya application**: ✅ Implemented SSE + takeover endpoints

### 4. Deterministic Output Compression (hypa)
```
Command output → ANSI strip → blank collapse → progress filter → dedup → truncate
                                                                    ↓
                                              ImportantLineClassifier rescues:
                                              • error/failed/exception
                                              • file.ts:12: diagnostics
                                              • HTTP 4xx/5xx
                                              • Compiler IDs (TS1234, CS0123)
```
**mya application**: ✅ output-compress.ts module

### 5. Two-Tier Key Cooldown (pi-soly)
```
Error 429 (rate limit)  → markBad(key) → cooldownUntil = now + 60s (key-specific)
Error 529 (overloaded)  → markOverloaded(ALL keys) → overloadedUntil = now + 30s (provider-wide)
Error 401 (unauthorized)→ markBad(key) → rotate to next

pickNextKey:
  1. Preferred key if available
  2. Next available in rotation
  3. Soonest available (all on cooldown)
```
**mya application**: ✅ key-rotation.ts module

### 6. Hash-Anchored Edits (pi-hashline-edit-pro)
```
Read file → compute hash per line (sha256 → 4 char base64url)
Edit: { hashRange: ["aB3x", "xK9p"], replacement: "new content" }
  → Resolve hashes to line numbers
  → E_STALE_ANCHOR if hash not found (file changed since read)
  → E_AMBIGUOUS if hash matches multiple lines
  → Apply spans right-to-left
  → mapStableHashes: unchanged lines keep their hash
```
**mya application**: ✅ hashline-edit.ts module

### 7. Per-Stage Model Routing (pi-dynamic-workflows)
```
Workflow phases: [Investigate, Refute, Consensus]
  → resolveModelForPhase("Investigate", config) → "minimax/MiniMax-M3"
  → resolveModelForPhase("Refute", config) → "anthropic/claude-haiku" (small tier)
  → resolveModelForPhase("Consensus", config) → "openai/gpt-4o" (big tier)

Tiers: small (mini/flash/haiku) → medium → big (opus/pro/ultra)
Precedence: explicit > tier > phase > default
```
**mya application**: ✅ model-routing.ts module

### 8. Adversarial Review (pi-dynamic-workflows)
```
1. Investigate → agent produces findings[]
2. Refute → parallel(findings.map(f => N reviewers vote {real, reason}))
           Default: real=false when uncertain
           Finding survives iff realCount/total >= threshold
3. Consensus → agent writes report from surviving findings only
```
**mya application**: 📐 Ready for Council integration

### 9. Ranked Compaction (pi-vcc)
```
Block scoring:
  edit tool call:     +34 (highest)
  test command:       +26
  nonzero exit:       +24
  workflow command:   +14
  assistant context:  +10
  read tool:           +6
  tool result:         +1
  trivial bash:      -16 (penalty)

Selection: greedy by score under token budget, always keep recent N
```
**mya application**: 📐 Ready for prompts/compressors.ts enhancement

### 10. LSP Impact Cascade (pi-lens)
```
Edit foo.ts →
  1. Build review graph (imports/calls/references)
  2. Compute one-hop impact (who imports foo.ts?)
  3. Symbol-level: LSP references for changed symbols
  4. Transitive depth-2 expansion
  5. Parallel touchFile() on all affected files
  6. Collect diagnostics from cascade

touchFile: unified LSP primitive (open/change/wait in one call)
Per-server DiagnosticStrategy: different debounce/wait for TS vs Rust vs Python
```
**mya application**: 📐 Blueprint for LSP integration

### 11. CDP Action Model (pi-computer-use)
```
UiAction = press | click | doubleClick | setText | typeText | keypress | scroll | drag | moveMouse | wait

prepareAction(raw) → PreparedAction (validated, target resolved)
  Target: { ref: "@e3" } (semantic) | { x, y } (coordinate)

Outline extraction: CDP accessibility tree → OutlineNode tree with @eN refs
State staleness: epoch-based write lock (invalidates base state before dispatch)
```
**mya application**: 📐 Blueprint for browser.ts enhancement

---

## 📈 Impact on mya

### Implemented (this session)
| Feature | Source | Files | Tests |
|---------|--------|-------|-------|
| Gateway /ready fix | (internal bug) | gateway/index.ts | — |
| Web dashboard rewrite | openpi + session-mgr | web/dashboard.ts | — |
| SSE endpoint | pi-mobile | gateway/index.ts | +2 |
| Model listing | pi-mobile | gateway/index.ts | +1 |
| Repo management | pi-mobile | gateway/index.ts | +2 |
| Session takeover | pi-mobile | gateway/index.ts | +2 |
| 25 themes | pi-themes | ~/.mya/themes/ | — |
| Output compression | hypa | tools/output-compress.ts | +8 |
| API key rotation | pi-soly | ai/key-rotation.ts | +10 |
| Hash-anchored edits | pi-hashline | tools/hashline-edit.ts | +8 |
| Model routing | pi-dynamic-workflows | ai/model-routing.ts | +6 |

### Design Ready (blueprints)
| Feature | Source | Effort |
|---------|--------|--------|
| LSP cascade | pi-lens | 2-3 days |
| Adversarial review | pi-dynamic-workflows | 1 day |
| Ranked compaction | pi-vcc | 1 day |
| CDP action model | pi-computer-use | 2 days |
| Transport interface | pi-session-manager | 1 day |
| WebAuthn FaceID | pi-mobile | 1 day |

### Test Growth
```
Baseline:     477 tests
+ Phase A-G:   90 tests (gap implementation)
+ Audit fixes:  0 (bug fixes)
+ Mobile:      +7 (SSE/repos/takeover)
+ Tier-2:      +61 (deep designs)
+ Reference:  +32 (4 new modules)
────────────────────────
Total:       ~667 tests
```
