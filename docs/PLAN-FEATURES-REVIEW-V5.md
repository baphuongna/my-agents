# PLAN-FEATURES Deep Review v5 — Cognitive & Security Systems Verification

> 3 more parallel explorers verified security/audit/secrets, prompts/compression/skills, and memory internals
> Date: 2026-07-21
> Focus: What cognitive/security systems are REAL vs WIRED vs DEAD?

---

## Executive summary

Round 5 verified the deepest subsystems. Found **8 critical discoveries** that reshape plan assumptions:

| # | Discovery | Impact |
|---|---|---|
| **R5-1** | Memory has **3 disconnected planes** | D1 can't just "add a backend" — must reconcile systems |
| **R5-2** | **SQLite is NOT the agent's active memory** | "SQLite done" claim is misleading |
| **R5-3** | RetrievalEngine **vector arm DISABLED** (`vector: new Map()`) | Semantic search broken in indexed path |
| **R5-4** | **Compression hooks exported but NEVER CALLED** | `compressHistory` never wired in production |
| **R5-5** | **Skills NOT in agent's stable tier** — only in print/mya-bridge | Agent SDK path has no skills |
| **R5-6** | `scanInject` scope is **STUB** — same patterns for all scopes | Spec says "wire=strictest" — not implemented |
| **R5-7** | **Trust + Recovery FSM NOT WIRED** | Permission trust levels + crash recovery unused |
| **R5-8** | **SealedFile NOT encrypted** — 0600 perms only | Secrets-at-rest is filesystem-permission-based |

---

## R5-1. Memory has 3 disconnected planes

The memory system is the most complex subsystem and is fragmented across **three partially-connected systems**:

| Plane | Storage | What uses it | Active? |
|---|---|---|---|
| **MemoryManagerImpl** (role backends) | InMemoryBackend + FileBackend (markdown) | `session.memory.snapshot()` in prompt assembly | ✅ Active |
| **Brain + 13 domains** | In-memory Maps (Facts/Takes/Pages) | Dream cycle, domain recall | ✅ Active (in-memory only) |
| **SqliteMemoryManager** | SQLite FTS5 + embeddings BLOB | `/recall`, `/remember` slash commands only | ⚠️ Tool-surface only |

**The critical problem**: These planes are NOT connected:
- `MemoryManagerImpl.record()` writes to Brain + domains, NOT to role backends
- `MemoryManagerImpl.write()` writes to role backends, NOT to Brain
- `SqliteMemoryManager` is a completely separate class, NOT a `MemoryBackend`
- The dream cycle (`runDreamCycle()`) calls Brain directly, bypassing `MemoryManagerImpl` entirely
- Domain `onRecord()`/`onConsolidate()` hooks are skipped by the dream cycle path

**Impact on D1**: Can't "just add a mem0 backend" — must first decide:
- Which plane is authoritative?
- Does mem0 backend connect to MemoryManagerImpl role system, or to SqliteMemoryManager?
- Should SQLite replace Brain as the active memory?

---

## R5-2. SQLite is NOT the agent's active memory

Previous reviews (v2/v3) said "SQLite done". This is **misleading**:

- `SqliteMemoryManager` exists and is FULLY FUNCTIONAL (FTS5, embeddings, lifecycle, consolidation)
- BUT: `packages/agent/src/index.ts` creates `Brain` + `MemoryManagerImpl`, NOT `SqliteMemoryManager`
- SQLite is only accessed via mya-bridge slash commands (`/recall`, `/remember`)
- The agent's `runTurn` uses `memory.refresh()` → reads FileBackend markdown, NOT SQLite
- `SqliteMemoryManager` does NOT implement `MemoryBackend` interface — it's a separate `MemoryStore`

**Impact**: Plan D1 must clarify: SQLite is NOT "done" as a MemoryBackend. It's a parallel system that would need adapter work to become the active memory.

---

## R5-3. RetrievalEngine vector arm is DISABLED

**`packages/memory/src/retrieve.ts`**: The modern `RetrievalEngine` has 4 arms (BM25, substring, trigram, vector). BUT:

```ts
const indexed: IndexedDoc = {
  // ...
  vector: new Map(),  // ← ALWAYS EMPTY
};
```

The vector arm iterates `doc.vector` — which is always an empty Map. So **vector search produces zero hits** in the indexed path. The legacy `rrf.ts` `vectorArm()` does work (character 3-gram TF-IDF cosine) but `SearchDomain` uses that path, not `RetrievalEngine`.

**Additional retrieval bugs**:
- BM25 length normalization uses hardcoded `100` divisor (not corpus average)
- Index sync only checks document COUNT, not content → stale index on content edits
- Session diversity cap reads `sessionId` on MemoryHit — but retrieval arms don't set it → cap is inactive

---

## R5-4. Compression hooks exported but NEVER CALLED

**The spec-correct compression system exists**:
- 5 strategies: identity, window, summarize, nativeContent, overflowRecovery
- `rankedCompact()` — 5-block classifier with sophisticated scoring
- `DriftGrader` — replay golden trace, compute passRate + maxScoreDelta
- `markCompressed()` / `rebuildStableTier()` / `rebuildVolatile()` — PromptMutex-protected

**BUT**: `compressHistory` is a `runTurn` option that is **NEVER injected by `createAgent()`**. The loop calls it only on `finish:"length"` — but since no production caller wires it, compression NEVER runs in the agent SDK path.

The TUI path (`print/mya-bridge.ts`) uses `rankedCompact()` via pi's `session_before_compact` hook — that's pi's own compression, not the core loop's.

**Impact**: Features that assume "compression just works" in the agent SDK path are wrong. Compression only works via pi/TUI, not via `createAgent()`.

---

## R5-5. Skills NOT in agent's stable tier

**`packages/agent/src/index.ts:751`** `composeStableTier()`:
```ts
function composeStableTier(overlay: string, registry: ToolRegistry): string {
  return `${identity}\n${mandates}\n${tone}\n\n## Tools\n${renderToolsBlock(registry)}`;
}
```

No skills block. Skills are only injected in `print/mya-bridge.ts` via `before_agent_start` hook:
```ts
// print/mya-bridge.ts:667
const skillIndex = skillStore.index();
// inject as "## Skills" block
```

**Impact**: If a transport other than `print` is used (e.g., SDK, RPC), the agent NEVER sees skills. The `skillSetDirty` → `rebuildStableTier` chain is exported but **never called in production**.

---

## R5-6. scanInject scope is STUB

**`packages/prompts/src/inject.ts`**: The `scope` parameter (`"context" | "wire" | "direct"`) is declared but **NOT differentiated**:

```ts
export function scan(content: string, scope = "context"): ScanVerdict {
  for (const re of INJECTION_PATTERNS) {
    // SAME 7 patterns for ALL scopes
    if (m) return { allowed: false, reason: `injection pattern matched (${scope} scope)` };
  }
}
```

The file header says "Scope tunes which patterns apply (wire=strictest)" but the implementation applies the **same 7 patterns regardless of scope**. The scope only appears in the error message string.

**Impact**: The spec's tiered injection defense (different strictness per scope) doesn't exist. All scopes are equally strict (or equally lenient).

---

## R5-7. Trust + Recovery FSM NOT WIRED

Two important security systems are **implemented but have zero production callers**:

### ProjectTrust (`packages/audit/src/trust.ts`)
- `loadTrust(root)` reads `~/.mya-agent/trust/<hash>.json` (user-owned, 0600)
- `canAutoApprove(t)` → true only when `level === "privileged"`
- `safeContextOnly(t)` → true when `level === "untrusted"`
- **NOT WIRED**: Permission gate uses ad-hoc rules, not trust-driven gates. No production caller.

### RecoveryRecipe (`packages/audit/src/recovery.ts`)
- 6 typed failure scenarios: NetworkError, ToolTimeout, InvalidOutput, PermissionDenied, Provider5xx, ApprovalExpired
- `runRecovery(err, recipes)` — bounded retry with detect/classify/apply
- **NOT WIRED**: Only called in tests. No host-side `apply` implementation (retry/reauth/rephrase/rebuild-context/escalate).

**Impact**: Features assuming trust-based auto-approval or crash recovery FSM can't rely on them — they need wiring first.

---

## R5-8. SealedFile NOT encrypted

**`packages/secrets/src/index.ts:188-195`**: `writeSealedFile()` creates a 0600-mode file but **does NOT encrypt**:

```ts
export function writeSealedFile(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, { mode: 0o600 });
  chmodSync(path, 0o600);  // defensive
}
```

"Sealed" = filesystem permissions only. A root-level attacker or disk image read recovers the plaintext. No libsodium/age encryption.

**Impact**: Secret-at-rest security is filesystem-permission-based, not cryptographic. Adequate for local dev tool, inadequate for multi-user/cloud.

---

## Additional findings

### Audit system — FULLY FUNCTIONAL ✅
- Merkle hash chain: `hash_n = sha256(prevHash_{n-1} || canonical(record_n))`
- `verify(since)` recomputes from scratch — detects tampering
- Redactor runs BEFORE hash — secrets never in hashed bytes
- Wired into agent loop: tool calls, results, approval denials, turn boundaries
- `kind: "repair"` declared but never emitted (zero callers)

### SecretStore — FULLY FUNCTIONAL ✅
- 4 variants: env, file, exec, keyring (`@napi-rs/keyring`)
- `resolve()` with in-process cache, fail-closed
- `makeSecretRedactor()` — two-pass (by value + by field name regex)
- `rotate()` for file-based secrets, `revoke()` for all
- `fingerprint()` for audit-safe tags

### Security guard — FULLY FUNCTIONAL ✅
- 6 layers: secret-in-URL, SSRF metadata (unconditional), SSRF private/internal, post-redirect re-check, domain blocklist, bot detection
- `checkUrlAsync()` resolves DNS, fail-closed on error, blocks any private IP in resolution
- Handles single/double/triple encoding
- Per-redirect-hop re-check
- **Gap**: DNS-rebinding TOCTOU (public-at-check, private-at-connect) — needs connection-level IP pinning

### x402 wallet — FULLY FUNCTIONAL ✅
- Real ECDSA secp256k1 via `node:crypto`
- Wallet: balance/pay (fail-closed)/rotateKey/keyStatus
- X402Client: 402-handling with double-pay guard
- `paid_fetch` tool: WorkspaceWrite required
- Wired in shared-instances (1M USDC initial)
- **Note**: Settlement (on-chain) explicitly out-of-scope

### Signing — PARTIAL ⚠️
- `signTarball()`/`verifyTarball()` — fail-closed, sigstore optional dep
- Desktop `verifyUpdate` — only checks digest + manifest claim, does NOT verify actual sigstore signature
- npm provenance fetch — functional, best-effort

### Prompt assembly — FULLY FUNCTIONAL ✅
- 3-tier: stable (identity+tools), context (scanned ctxFiles), volatile (memory+USER.md+day)
- `PromptMutex` (WeakMap-keyed per session) — serializes tier rebuilds (inv #15)
- Day-precision cache invalidation (volatile tier misses ≤ once/day)
- All tiers + memory entries + goals individually injection-scanned

### Roles — PARTIAL ⚠️
- `loadRoles()` + `filterToolsForRole()` — functional
- `/role <name>` — works in TUI (mya-bridge) only
- `memoryScope` — **DEAD-WIRED** (zero consumers)
- `applyRole()` for pool/gateway — **MISSING** (documented gap)
- No native Anthropic adapter — only via pi-ai bridge

### Eval harness — FULLY FUNCTIONAL ✅
- 3 tiers: unit (deterministic), integration (MockProvider replay), credentialed (real provider, MYA_CREDENTIALED gate)
- `installEgressGuard()` — monkey-patches fetch to reject
- `checkGoldenAge()` — 30-day stale warn
- `/eval` slash command wired

---

## Consolidated cognitive/security status matrix

| System | Status | Key Detail |
|---|---|---|
| Audit log (Merkle) | ✅ Functional | Hash chain + verify + redactor, wired to agent loop |
| SecretStore | ✅ Functional | 4 variants, redactor, rotation |
| SealedFile encryption | ❌ **MISSING** | 0600 perms only, no crypto |
| Security guard (web) | ✅ Functional | 6 layers, DNS resolution, encoding tricks |
| x402 wallet | ✅ Functional | Real ECDSA, 402-handling |
| Signing | ⚠️ Partial | verifyUpdate doesn't verify sigstore signature |
| scanInject | ⚠️ Partial | Scope differentiation is stub |
| ProjectTrust | ⚠️ **NOT WIRED** | Implemented, zero production callers |
| Recovery FSM | ⚠️ **NOT WIRED** | Implemented, zero production callers |
| Prompt assembly | ✅ Functional | 3-tier, PromptMutex, cache-stable |
| Compression primitives | ✅ Functional | 5 strategies, DriftGrader, rankedCompact |
| Compression wiring | ❌ **NOT WIRED** | compressHistory never injected by createAgent |
| Skills (SkillStore) | ✅ Functional | Provenance, progressive disclosure, curator |
| Skills in agent prompt | ❌ **MISSING** | Not in composeStableTier, only in mya-bridge |
| skillSetDirty chain | ❌ **DEAD** | Exported, never called |
| Curator auto-run | ❌ **NOT WIRED** | curate() manual-only |
| Roles registry | ✅ Functional | Load + filter + collision detection |
| applyRole() for pool | ❌ **MISSING** | Only TUI /role works |
| memoryScope | ❌ **DEAD-WIRED** | Declared, zero consumers |
| Eval harness | ✅ Functional | 3 tiers + egress guard + freshness |
| Memory (Brain system) | ✅ Functional | 13 domains, dream cycle |
| Memory (SQLite) | ⚠️ Tool-surface only | NOT the agent's active memory |
| Memory (3 planes) | ⚠️ **DISCONNECTED** | Manager/Brain/SQLite not integrated |
| RetrievalEngine vector | ❌ **DISABLED** | vector: new Map() always empty |
| BrainStore persistence | ❌ **NOT ENABLED** | Agent doesn't pass persistenceDir |
| Backend registration | ❌ **BROKEN** | FileBackend fails silently (default already registered) |
| RAGFS skill/file | ❌ **MISSING** | Only knowledge:// + memory:// wired |

---

## 5-round review complete

| Round | Focus | Explorers | Critical findings |
|---|---|---|---|
| v1 | Spec compliance | Manual | 15 issues (3 critical) |
| v2 | File paths + LOC | 3 agents | 6 wrong paths, LOC re-baseline |
| v3 | Runtime code flow | 4 agents | 6 critical (budget sharing, dead code) |
| v4 | Subsystem infrastructure | 3 agents | 7 critical (MCP no OAuth, approval broken) |
| v5 | Cognitive + security systems | 3 agents | 8 critical (memory fragmented, compression unwired) |

**Total: 13 parallel explorers + manual analysis across 5 rounds.**

### All P0 prerequisites (consolidated, ~535 LOC)

| # | Task | LOC | Source |
|---|---|---|---|
| 1 | Wire `scanInject` into channels | ~15 | v3 |
| 2 | Wire `deriveChild`/`releasePrecharge` in subagent | ~40 | v3 |
| 3 | Wire `DevicePairing`/`WebAuthn` in main.ts | ~10 | v3 |
| 4 | Channel polling loop | ~20 | v3 |
| 5 | Config loading mechanism | ~50 | v3 |
| 6 | Fix cross-device approval relay | ~200 | v4 |
| 7 | Wire `compressHistory` in createAgent | ~30 | v5 |
| 8 | Add skills to agent composeStableTier | ~20 | v5 |
| 9 | Fix MemoryManagerImpl backend registration | ~15 | v5 |
| 10 | Enable BrainStore persistence (pass persistenceDir) | ~10 | v5 |
| **Total** | | **~410** | |

*(reduced from ~535 — some items overlap or are trivial)*
