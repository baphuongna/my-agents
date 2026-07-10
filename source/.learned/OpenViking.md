# OpenViking — Learnings for mya

> Studied 2026-07-06. Focused pass on a Rust+C++ context-database workspace. Source: `/home/bom/source/my-agent/source/OpenViking`.

## TL;DR
**OpenViking** (volcengine / ByteDance, **AGPLv3**) is **"The Context Database for AI Agents"** — a unified context/RAG store that solves *fragmented context* (memories in code, resources in vector DBs, skills scattered) by exposing everything through one abstraction. Rust workspace + **C++ performance backend** + Python bindings. Core crate **`ragfs`** treats retrieval as a *filesystem*. Pluggable cache backends (Redis, Mooncake, Yuanrong). Benchmark-driven (User Memory / Agent Memory / KB-QA scenarios). Relevant to mya as a **memory/context backend architecture reference** — *not* vendorable (AGPL).

## Architecture overview
Cargo workspace (`resolver 2`), Rust + C++ hybrid (`src/*.cpp` + CMake; `abi3` Python engine):
| Crate | Role |
|---|---|
| `ragfs` | **Core: RAG-as-a-filesystem** — unified retrieval over heterogeneous context |
| `ragfs-cache-redis` / `ragfs-cache-mooncake` / `ragfs-cache-yuanrong` | **Pluggable cache tiers** (Mooncake = ByteDance KV-cache store) |
| `ragfs-python` / `ragfs-python-native` | Python bindings |
| `ov_cli` | CLI |

Top-level also: `web-studio/` (Studio UI), `bot/`, `sdk/`, `openviking/`, `openviking_cli/`, `benchmark/`, `build_support/`, `third_party/`. `src/{common,index,store}` = the C++ engine (index + store layers).

## Notable patterns & techniques

1. **`ragfs` — retrieval as a filesystem.** Unifies memories + vector resources + skills behind FS-like semantics (paths, reads, mounts) so agents access all context one way. → **mya has 8 separate memory backends + a knowledge graph, each with its own API.** A **unified FS-style abstraction over all context sources** (mount memory/vector/skill sources into one namespace) would simplify the agent's retrieval story and make tooling (browse, ls, grep over memory) uniform. Compelling architectural idea.

2. **Pluggable cache tiers (hot/warm/cold backends).** Redis (hot), Mooncake (KV-cache), Yuanrong — swap per deployment. → mya has memory *backends* but not a **tiered cache abstraction** (hot in-memory → warm Redis → cold vector/SQLite). A cache-tier model would let mya tune latency/cost per environment without changing the retrieval API.

3. **Memory-specific benchmarks (User Memory / Agent Memory / KB-QA).** OpenViking publishes eval results across *memory scenarios*. → **mya has `mya-eval` for deterministic agent replay** but no **memory-quality benchmarks** (recall precision, temporal decay, conflict resolution). Adding a memory-eval suite would let mya measure regressions in its memory pipeline objectively.

4. **Rust + C++ hybrid for hot paths.** The index/store engine is C++ (CMake-built), wrapped by Rust; Python via `abi3`. → mya is Rust-pure (only `aardvark-sys` FFI). If mya ever needs a perf-critical index (e.g. a custom vector index or codegraph), OpenViking's Rust-orchestrator/C++-engine split is a proven model — though mya's "Rust-first, `forbid(unsafe)`" ethos argues for keeping it in Rust where feasible.

5. **Mooncake (KV-cache) as a cache backend.** ByteDance's KV-cache store for LLM prefix caching. → If mya adds **LLM prefix/KV caching** to cut cost/latency (relevant to mya's cost tracking + headroom's compression theme), Mooncake-style external KV-cache is the scale-out pattern.

## Top ideas worth adopting (prioritized)
1. **Unified FS-style context abstraction** (ragfs) over mya's memory/vector/skill sources — single namespace, uniform tooling.
2. **Tiered cache backends** (hot in-mem → Redis → cold store) as an optional memory deployment model.
3. **Memory-quality eval suite** in `mya-eval` (recall/decay/conflict metrics) — measure, don't guess.
4. **External KV-cache** integration path for LLM prefix caching (cost reduction).

## Differences vs mya
| Axis | OpenViking | mya |
|---|---|---|
| Role | context/RAG database (infrastructure) | full agent runtime (product) |
| Context model | unified FS over heterogeneous stores | 8 backends + pipeline, separate APIs |
| Language | Rust + C++ | Rust-pure (+aardvark FFI) |
| Cache tiers | pluggable (Redis/Mooncake/Yuanrong) | single backend per agent |
| License | **AGPLv3** (copyleft) | (mya's license) |

OpenViking is **infrastructure mya could learn from (and optionally interoperate with via its SDK/API)**, not code to vendor.

## Gotchas / anti-patterns to avoid
- ⚠️ **AGPLv3**: cannot vendor/link OpenViking code into mya without open-sourcing mya under a compatible license. **Study the architecture; do not copy code.** Interoperate only via clean-boundary network/API if ever.
- C++ in the engine adds build complexity (CMake, cross-platform toolchains) — mya's pure-Rust build is simpler and safer; only add C++ for a proven-critical hot path.
- "Context database" is a different layer than an agent — don't confuse the two; mya is the agent *consumer* of such a layer.

## Key reference files
- `README.md` (overview, evaluation highlights), `Cargo.toml` (workspace + `profile.release` LTO/strip)
- `crates/ragfs/` (the FS abstraction), `crates/ragfs-cache-{redis,mooncake,yuanrong}/` (cache tiers)
- `crates/ov_cli/`, `src/{common,index,store}` + `src/*.cpp` (C++ engine)
- `benchmark/` (memory eval scenarios), `web-studio/` (Studio UI)

## Scope note (skipped)
Did not read `ragfs` internal API (mount/read semantics) or the C++ index/store engine. A follow-up on `ragfs`'s FS interface design would give concrete API patterns if mya adopts idea #1.
