# Plan — Remaining & Tier 4

> Tracks the build status of [source/.learned/AGENT-SPEC.md](source/.learned/AGENT-SPEC.md) (SPEC §0–§25).
> Each tier was reviewed 3 rounds (6 batches → 18 review rounds total, R37–R44).

## Done

| Tier | Packages | Review | Key deliverable |
|---|---|---|---|
| **Tier 0** | `core`, `crates/natives` (stub) | R37 (3) | types SSOT + runTurn FSM + budget + laneboard + time + napi stub |
| **Tier 1** | `ai`, `prompts`, `tools`, `memory`, `subagents`, `eval` | R38+R39 (6) | 3-tier prompt + injection scan + 9 tools + providers + memory + subagents + drift eval |
| **Tier 2** | `skills`, `council`, `workflows`, `channels`, `lsp`, `codeexec`, `codenav`, `subagents`(CoW) | R40+R41+R42 (9) | skills + code-exec bridge + codegraph + council + vm sandbox + MCP FSM + LSP + CoW |
| **Tier 3/Frontier** | `dap`, `council`(hindsight), `collab`, `x402` | R43+R44 (6) | DAP client + hindsight reviewer + collab relay + x402 micropayments |
| **E2E** | `agent`, `print`, `sdk` | — | MiniMax-M3 native tool calling verified (write/read/budget) |
| **Docs** | — | — | README + CONTRIBUTING + AGENTS |

**20 packages · 24 commits · 110 automated tests.**

## Tier 4 — Real Rust Natives + Crypto (productionization)

**Thesis validation:** AGENTS.md declares a hybrid **TypeScript + Rust** stack. Tiers 0–3 proved the TS side (20 packages). Tier 4 makes the Rust side REAL — replacing the napi stubs with production-grade implementations that justify the Rust gate (trust boundary + hot inner loop).

### Scope
1. **`crates/natives` real implementations** (replace stubs):
   - `hash_content` → real **BLAKE3** hex (trust boundary — integrity/signing)
   - `blake3_mac` (keyed BLAKE3) → real MAC for x402 signing
   - `glob` → real **walkdir + globset** (hot loop — large repos)
   - `grep` → real **walkdir + regex** (hot loop — content search)
2. **`packages/natives` (new TS bridge)** — loads the `.node`, with graceful **JS fallback** (pit-of-success: agent works even if the prebuilt binary is missing/not built). Exposes one `nativeHash/nativeGlob/nativeGrep/nativeMac` API.
3. **Wire natives into consumers:**
   - `tools/hashline` → BLAKE3 per-line hash (FNV-1a fallback)
   - `x402` → keyed-BLAKE3 signing (FNV-1a fallback)
   - `tools/glob` + `tools/grep` → native when available
4. **Review 3 rounds** (R45).

### Deferred (post-Tier-4, per §20)
- Real approval-channel UI (currently stub denies `DangerFullAccess`).
- Real overlay native (overlayfs/reflink — currently `file_copy` fallback in CoW).
- DAP real debug-adapter integration (client built; needs `node --inspect` wiring).
- Hindsight wired into the turn loop (reviewer built; not auto-invoked).
- MLX TTS (frontier, on-device).
- Multi-agent shared-state convergence (frontier).
- Prebuilt napi binary distribution (`optionalDependencies` per platform).

## Rust gate justification (AGENTS.md)
| Function | Gate | Why |
|---|---|---|
| `hash_content` (BLAKE3) | trust boundary (a) | memory-safe crypto, no GC pauses, byte-faithful |
| `blake3_mac` | trust boundary (a) | keyed MAC for payment signing |
| `glob` | hot inner loop (b) | walk + match over 100k+ files |
| `grep` | hot inner loop (b) | regex over large file trees |
| `now_monotonic/wallclock` | determinism (c) | single monotonic source (invariant #10) |
