# my-agent

Unified coding/autonomous agent — **TypeScript core + Rust napi engine** (hybrid).

> **Status: Tier 0 scaffold.** This is the minimal buildable foundation per the [SPEC](source/.learned/AGENT-SPEC.md). The loop is TS; the perf/safety natives (search, fs, ast, crypto) are Rust exposed via napi-rs.

## Toolchain

| Tool | Version | Notes |
|---|---|---|
| **TypeScript** | **7.x** | native Go compiler (~10× faster builds) |
| Node | ≥20 | ESM primary runtime |
| Rust | stable (1.95+) | `clippy --all-targets` clean |
| napi-rs | 3.x | prebuilt per {os,arch}; no cargo for end-users |

## Layout

```
packages/
  core/    # THE minimal core: types (§4 glossary SSOT), loop, FSM, budget, laneboard
  ai/      # provider abstraction + MockProvider (Tier 0 stub)
  print/   # print transport (--json | transcript)
  sdk/     # embedded lib (AsyncIterable<RuntimeEvent>)
crates/
  natives/ # napi: search/fs/ast/crypto (Tier 0 stub)
```

See [§3 Architecture](source/.learned/spec/00-OVERVIEW.md) and [§20 Tier 0](source/.learned/spec/11-invariants-roadmap.md) in the SPEC.

## Develop

```sh
npm install          # installs TS 7 + workspace packages
npm run build        # tsc -b (project references)
npm run typecheck    # tsc --noEmit
```

## Design

This project follows the [unified SPEC](source/.learned/AGENT-SPEC.md): minimal frozen core + maximal package edge (pi model), no sandbox (the §7 permission gate is the only control), npm-distributed. See [AGENTS.md](AGENTS.md) for conventions.
