# Deep-dive: Pit-of-success clippy wrappers → port to mya

> Source: MyAgents `src-tauri/src/{local_http,process_cmd,proxy_config,system_binary}.rs` + `specs/tech_docs/pit_of_success.md` + `src-tauri/clippy.toml`. Pattern: "the wrong call won't compile."

## Source design (MyAgents)
Each canonical helper is the **single legitimate caller** of a dangerous API; everywhere else the clippy lint denies it; the helper site carries `#[allow(clippy::disallowed_methods)]`.

| Helper | Problem | Surface | Bans |
|---|---|---|---|
| `local_http` | User system proxies (Clash/V2Ray) intercept 127.0.0.1 → silent 502 on localhost calls | `builder()`/`json_client()`/`sse_client()`/`blocking_builder()` — pre-applies `.no_proxy()` | `reqwest::Client::new/builder`, `ClientBuilder::new`, blocking variants |
| `process_cmd` | Windows Tauri apps pop black console per `Command::new` without `CREATE_NO_WINDOW (0x08000000)` | `new(program)` — Windows sets creation_flags | `std::process::Command::new` |
| `proxy_config` | Node 20+ fetch reads HTTP_PROXY; Tauri subprocesses inherit parent proxy → break localhost | `apply_to_subprocess(cmd)`, `build_client_with_proxy(builder)`, `LOCALHOST_NO_PROXY` | (manual `cmd.env("HTTP_PROXY",...)`) |
| `system_binary` | macOS Finder-launched apps have stripped PATH (no /opt/homebrew, ~/.nvm) | `find(name)` via `which_in` augmented PATH; `augmented_path()` | `which::which` |

**Enforcement recipe** (`src-tauri/clippy.toml`): every helper's construction line has `#[allow(clippy::disallowed_methods)]`; everything else denied at `cargo clippy`. `spawn_blocking` is NOT banned (safe outside async).

## mya today (`/home/bom/source/my-agent/`)
**Existing `clippy.toml`** (workspace root) already denies: macros `tracing::*`/`log::*`/`std::dbg`/`anyhow::anyhow` → `::mya_log::record!`; method `tokio::spawn` → `::mya_spawn::spawn!`. Explicitly does NOT yet ban `println`/`eprintln` (~430 violations, staged cleanup).

**AGENTS.md Anti-Patterns are prose-only** (no compile-time guard): "do not silently weaken security policy", "do not leave unwrap()/expect() in production", etc. §ABSOLUTE RULE (SSOT) enforced by `dev/ci.sh dry-check` for DRY; these anti-patterns have no guard.

**Census of dangerous callsites** (read-only scan):
| API | ~count | Representative sites |
|---|---|---|
| `reqwest::Client::new` | ~20 | `src/main.rs` (×10), `src/bin/mya-acp-bridge.rs:335`, `src/commands/self_test.rs:400`, `mya-channels/{wechat,line,voice_call,telegram,linq,notion,discord/interaction}.rs` |
| `reqwest::Client::builder` | ~5 | `src/commands/update.rs:114,403`, `mya-channels/{slack,matrix}.rs` |
| `std::process::Command::new` | ~10 | `src/tunnel/mod.rs`, `src/commands/update.rs`, `src/skills/mod.rs`, `src/main.rs` (open/xdg-open) |
| `which::which` | ~6 | `mya-tools/{content_search,google_workspace,claude_code}.rs`, `mya-runtime/src/service/mod.rs` |
| `SystemTime::now` | ~25 | `mya-channels/{line,gmail_push,slack,matrix,voice_wake,cli}.rs` |
| `Instant::now` | ~5 | `apps/tauri/screenshot.rs`, `mya-channels/{wechat,whatsapp_web}.rs` |
| `.unwrap()`/`.expect()` | dozens | `mya-runtime/src/daemon/mod.rs` (many), `mya-log/src/subscriber.rs:76` |

**Existing helper modules:** `mya-spawn/` (spawn! macro, carries `#[allow]` on inner tokio::spawn — the pattern to clone); `mya-infra/src/net_guard.rs` (is_private_or_local_host, no client builder); `mya-tools/src/proxy_config.rs` (user-facing proxy tool, NOT the subprocess injector). **No** `mya-infra/src/{http,process,binary,time}.rs`.

## Proposed design for mya

### A. DRAFT `clippy.toml` extension (additive — existing entries stay verbatim)
```toml
disallowed-methods = [
    # ── existing, kept verbatim ──
    { path = "tokio::spawn", reason = "use ::mya_spawn::spawn!(...) for attribution span" },
    # ── NEW: localhost/external HTTP clients ──
    { path = "reqwest::Client::new", reason = "use ::mya_infra::http::client() / local_client() — bare clients miss system proxy (external) or get intercepted (localhost)" },
    { path = "reqwest::Client::builder", reason = "use ::mya_infra::http::builder()" },
    { path = "reqwest::ClientBuilder::new", reason = "use ::mya_infra::http::builder()" },
    { path = "reqwest::blocking::Client::new", reason = "use ::mya_infra::http::blocking_client()" },
    { path = "reqwest::blocking::Client::builder", reason = "use ::mya_infra::http::blocking_builder()" },
    { path = "reqwest::blocking::ClientBuilder::new", reason = "use ::mya_infra::http::blocking_builder()" },
    # ── NEW: subprocess spawn (CREATE_NO_WINDOW on Windows) ──
    { path = "std::process::Command::new", reason = "use ::mya_infra::process::command() — single legitimate caller carries #[allow]" },
    # ── NEW: system binary lookup (stripped PATH on GUI launch) ──
    { path = "which::which", reason = "use ::mya_infra::binary::find() — augment PATH first (Homebrew/NVM/fnm/.bun)" },
    # ── NEW: wall-clock vs monotonic (typing, not single-site) ──
    { path = "std::time::SystemTime::now", reason = "use ::mya_infra::time::now_wallclock() — typed, test-seam-able" },
    { path = "std::time::Instant::now", reason = "use ::mya_infra::time::now_monotonic() — distinct from wall-clock" },
]
# disallowed-macros block stays as-is (tracing/log/dbg/anyhow already present)
```

### B. Helper modules in `crates/mya-infra/src/` (each: tiny surface, one `#[allow]` construction site)
- **`http.rs`**: `builder()` (default `.no_proxy()` for localhost), `external_builder()` (reads `mya_config::ProxyConfig`, applies `reqwest::Proxy` + `LOCALHOST_NO_PROXY`, logs chosen proxy), `local_client(t)`/`external_client(t)`/`blocking_local_builder()`, `pub const LOCALHOST_NO_PROXY: &str = "localhost,localhost.localdomain,127.0.0.1,127.0.0.0/8,::1,[::1]"`. **NO** `mya-log`/`mya-config` inside helper body except `external_builder` may read ProxyConfig.
- **`process.rs`**: `command(program)` (Windows `creation_flags(CREATE_NO_WINDOW)`), `apply_proxy_env(cmd)` (defer until first subprocess needs HTTP proxy — see Open Q4), `LOCALHOST_NO_PROXY`.
- **`binary.rs`**: `find(name)` via `which_in` on `augmented_path()` (process PATH + /opt/homebrew/bin + /usr/local/bin + ~/.nvm/versions/node/*/bin + ~/.local/bin + ~/.bun/bin; Windows: Volta/bun/npm/Git dirs).
- **`time.rs`**: `now_wallclock() -> SystemTime` + `now_monotonic() -> Instant` (return raw types first iteration — Open Q5; the lint is the enforcement, callers see the helper name = review-time signal). Newtype `WallClock`/`Monotonic` wrappers optional later.

### C. AGENTS.md Anti-Pattern → lint mapping
| Anti-Pattern | Lint | Helper |
|---|---|---|
| "Do not silently weaken security policy/access constraints" | reqwest::* | http |
| (prose: external CLI spawn via orchestrator audit) | Command::new | process |
| (implicit: tool-layer binary lookup) | which::which | binary |
| timing-channel / monotonic-vs-wallclock intent | SystemTime::now / Instant::now | time |
| "Do not leave unwrap()/expect() in production" | (no cheap clippy rule) | **helper push only**: `mya_infra::json::must_parse<T>(s) -> Result<T>` (Open Q2) |

## Integration points
- `clippy.toml` (workspace root) — read by `cargo clippy --workspace --all-targets`; rides existing `./dev/ci.sh` gate (`-D warnings`).
- `.cargo/config.toml` — build profiles only, no clippy config; no change.
- Helpers in `mya-infra` (Beta, listed in AGENTS.md Repo Map as shared infra) next to `net_guard.rs`.
- Each helper's construction site: `#[allow(clippy::disallowed_methods)] // this IS the wrapper` (clone of `mya-spawn/src/lib.rs` + MyAgents `local_http.rs:31`).
- Per-site exemptions (e.g. `src/commands/update.rs` external CDN): same `#[allow]` + inline rationale comment.
- **⚠️ Workspace scope (Open Q1)**: existing `tokio::spawn` lint — does it fire on `apps/myacode/` (~30 uses)? If apps/ are in `--workspace` scope, new rules will fire there too in PR C. **Resolve before PR C.**

## Migration / implementation steps (helpers FIRST, lint SECOND — else giant CI break)
1. **PR A** 🟢 — add `mya-infra/src/{http,process,binary,time}.rs` + lib.rs re-exports. No clippy change, no caller touched.
2. **PR B1-B7** 🟡/🟢 — migrate callers in batches by crate:
   - B1: `src/main.rs` (most reqwest)
   - B2: `mya-channels/` (wechat,line,matrix,telegram,linq,notion,discord,slack)
   - B3: `src/commands/{update,self_test}.rs`, `src/bin/mya-acp-bridge.rs`
   - B4: `src/tunnel/mod.rs`, `src/skills/mod.rs`
   - B5: `mya-tools/{content_search,google_workspace,claude_code}.rs` (which::which)
   - B6: `mya-runtime/src/service/mod.rs` (which::which)
   - B7: sweep SystemTime::now/Instant::now in mya-channels/ + apps/tauri/screenshot.rs
3. **PR C** — extend `clippy.toml` with the `disallowed-methods` block. **Stage warn→deny** (one CI run warn, count, then flip to deny under `-D warnings`).
4. **PR D** 🟢 — `docs/book/src/architecture/pit-of-success.md` (Problem/Surface/Invariants/Don't per helper, mirror MyAgents); update AGENTS.md Anti-Patterns to cross-reference (prose→lint).
5. **PR E** 🟢 — robot-kit/aardvark-sys audit (below mya-infra layer; aardvark is the only `unsafe` crate — new lints don't touch unsafe).

## Effort & risk — 🟢 Mostly low; one staging risk
- Helper code 🟢 trivial (MyAgents + mya-spawn templates).
- ~30 reqwest migration 🟡 mechanical, PR-batched.
- ~25 SystemTime migration 🟡 intrusive if newtype (recommend raw return first iteration — Open Q5).
- ~6 which + ~10 Command migration 🟢 drop-in.
- **🟠 apps/ scope**: if `tokio::spawn` already fires on apps/myacode, PR C breaks apps too → batch apps migration into PR C. Resolve Open Q1 first.
- **🟠 unwrap/expect**: clippy can't ban cheaply (thousands of test false-positives). Helper push only (`must_parse`) this iteration.
- **🟡 HTTP semantic change**: MyAgents `local_http` defaults `.no_proxy()` everywhere; mya currently uses system-proxy-aware clients for EXTERNAL (slack/matrix/wechat). Splitting `builder()`(no_proxy, localhost) vs `external_builder()`(system proxy) preserves both — **PR B must not regress external proxy behavior.**

## Open questions
1. **Workspace lint scope**: does existing `tokio::spawn` lint fire on `apps/myacode/` (~30 uses)? Resolve before PR C.
2. **unwrap/expect enforcement**: no cheap clippy rule → helper push `mya_infra::json::must_parse` (returns Result) this iteration; re-evaluate when nightly `disallowed_methods` supports patterns.
3. **Tauri vs server-first rationale**: MyAgents `local_http` is Tauri-Sidecar; mya is server-first. Same `.no_proxy()` default correct for both, but `http.rs` doc-comment should cite BOTH problems.
4. **`process::apply_proxy_env`**: defer — mya spawns few subprocesses (update/skills = npm/git/curl, don't need HTTP_PROXY). Ship `process::command` (CREATE_NO_WINDOW) first.
5. **WallClock/Monotonic newtype tax**: returning raw `SystemTime`/`Instant` from helpers (lint = only enforcement, no newtype migration cost) vs full newtypes (review-time signal + test seam). **Recommend raw-return first iteration.**
6. **CI staging**: `disallowed_methods` is a restriction lint; `-D warnings` downgrades to deny. Stage: feature-branch count → fix batches → flip.

## Note
Each PR is `size:S`/`XS`, preserves working tree at each step (lint only fires after helper exists), individually green-CI-able. No conflict with other in-flight work (no one else touches mya-infra helpers / clippy.toml / listed callers in this deep-dive).
