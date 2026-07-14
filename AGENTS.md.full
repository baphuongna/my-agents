# AGENTS.md — project conventions for my-agent

> This file is the project-truth source for any agent (human or AI) working in this repo.
> Authoritative design: [source/.learned/AGENT-SPEC.md](source/.learned/AGENT-SPEC.md) (index → spec/00-12).

## Stack

- **TypeScript 7** (native Go compiler) for the loop, types, providers, tools, UI, packages.
- **Rust (stable)** for perf/safety natives via **napi-rs** — search, fs, ast, edit-hash, crypto. No shell/sandbox (pi model).
- **Node ≥20** ESM primary; Bun-compatible. **No cargo for end-users** — natives ship prebuilt.

## Rust gate (only put code in Rust if ≥1 applies)

1. **trust boundary** (crypto, audit, Merkle) — memory safety, no GC
2. **hot inner loop** (search over 100k+ files, AST parse, compression)
3. **determinism** (byte-faithful JSON, signing)
4. **platform parity** (vendored+frozen POSIX coreutils for Windows)

Everything else stays TS. Moving code to Rust "for speed" without a gate adds a napi tax + a compile bottleneck.

## Hard rules (spec §18 invariants — enforced)

- **Minimal core:** adding code to `packages/core/` requires a "why-not-a-package" justification in the PR.
- **No sandbox:** the agent runs in the user's environment (pi model). `/bin/bash`/`$SHELL` directly. The §7 permission gate is the only control.
- **Single time helper:** never call `Date.now()`/`SystemTime::now()` outside `core.time` (TS) / `natives.time` (Rust). Injectable for tests.
- **No process exit in natives:** napi functions never `abort!`/`process::exit` — return `NativeResult<T>` (panic → `{Panic:{backtrace}}`, never kills process).
- **Transports depend on `core` only;** cross-transport imports are forbidden (madge-enforced).
- **Byte-faithful JSON** for signing/audit (deterministic key order).
- **Never stub-then-replace:** interfaces ship real (even if no-op) from Tier 0.

## Style

- TS: strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, ESM, discriminated unions over prose.
- Rust: `clippy --all-targets` clean, `#![deny(clippy::exit)]`, `NativeResult<T>` on every napi entry.
- One concern per PR. Verify after each batch. No speculative abstraction.

## Structure (§3)

`packages/{core,agent,ai,memory,prompts,skills,tools,council,natives,print,rpc,gateway,web,tui}` + standalone `{audit,signing,secrets,pkg,dap,dap-server,eval,workflows,cron,acp,collab,sync,tts,desktop,x402}` + `vendored/{pi,pi-ai,pi-agent-core}` (cloned pi-coding-agent). Transports (`tui/cli/sdk/rpc`) depend on `core`, never reverse. `core` has no upward imports.
