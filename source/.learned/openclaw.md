# openclaw — Learnings for mya

> Studied 2026-07-06. **Focused flagship pass** (openclaw is a ~17K-file TS monorepo; this pass covers architecture + core packages + extension model + notable techniques). Source: `/home/bom/source/my-agent/source/openclaw`.

## TL;DR
**OpenClaw** is a **TypeScript / Node.js (pnpm) monorepo** — a mature *personal AI assistant* you self-host. It is the **TypeScript cousin of mya**: same product vision (personal assistant, 20+ channels, gateway control-plane, live Canvas, voice on macOS/iOS/Android, ACP coding) but implemented in TS with a **dynamically-loadable extension model** vs mya's **compile-time macro-verified** model. High signal for mya on *features, architecture decomposition, and supply-chain hygiene* — not Rust code reuse.

## Architecture overview
Monorepo, pnpm workspaces (`pnpm-workspace.yaml`): root + `ui`, `packages/*` (23 core), `extensions/*` (147), `apps/*`, `examples/*`.

**Core packages (`packages/`, 23):**
| Package | Role |
|---|---|
| `agent-core` | Agent loop abstraction |
| `acp-core` | Agent Client Protocol (coding) — **first-class core** |
| `ai` | "Reusable model provider adapters and streaming runtime" |
| `llm-core` | LLM primitives |
| `model-catalog-core` | Model catalog/discovery |
| `gateway-protocol` / `gateway-client` | **Protocol separated from client** (JSON-RPC control plane) |
| `memory-host-sdk` | Memory host interface |
| `markdown-core` | Markdown pipeline |
| `media-core` / `media-generation-core` / `media-understanding-common` | **Media split: generation vs understanding** |
| `speech-core` | Voice runtime |
| `terminal-core` | Terminal/PTY |
| `tool-call-repair` | **Tool-call recovery pipeline** (see below) |
| `net-policy` | **Network egress policy as core** |
| `normalization-core` | Text/encoding normalization |
| `web-content-core` | Web fetch/extract |
| `plugin-sdk` / `plugin-package-contract` | Plugin authoring + manifest contract |
| `sdk` | Public SDK |

**Apps (`apps/`):** `android`, `ios`, `macos`, **`macos-mlx-tts`** (on-device Apple-Silicon MLX TTS), `swabble` (separate **Swift** companion app — `Package.swift`), `shared`.

**Extensions (`extensions/`, 147):** ~14 channels (discord, telegram, slack, whatsapp, signal, matrix, imessage, irc, teams, mattermost, nostr, zalo, …) + ~27 LLM providers (incl. `codex-supervisor`, `copilot-proxy`, `opencode-go`, `amazon-bedrock-mantle`, `anthropic-vertex`, `googlechat`, `google-meet`, `zai`, `moonshot`, `qwen`, `minimax`).

## Notable patterns & techniques

1. **`tool-call-repair` as a first-class pipeline.** Files: `grammar.ts`, `payload.ts`, `promote.ts`, `stream-normalizer.ts`. It (a) normalizes the token stream, (b) repairs malformed grammar/payload of LLM tool calls, (c) "promotes" partial→valid calls. → **mya has `mya-tool-call-parser` (parse 10+ formats) but no *repair/promote* stage.** A dedicated repair layer that fixes broken streamed tool calls before dispatch would improve robustness against model malformation.

2. **`gateway-protocol` separated from `gateway-client`.** The wire protocol is its own package, independent of any client. → **mya's gateway is one crate** (`mya-gateway`) with protocol + server coupled. Extracting a `mya-gateway-protocol` (types/messages) would let alternate clients/servers + formal schema reuse.

3. **`acp-core` elevated to core.** Agent Client Protocol (code-editing agent comms) is a top-level core package, not a bridge. → mya has `mya-acp-bridge`; promoting ACP types to a first-class core crate signals it's a peer surface to chat, not an adapter.

4. **`net-policy` as a core package.** Network egress policy (allow/deny domains, SSRF) lives in its own core crate consumed by many packages. → mya has `OutboundPolicy`/domain-matching *inside* `mya-runtime/src/security/`. A standalone `mya-net-policy` crate would make it reusable across gateway + tools + channels.

5. **Media split into generation vs understanding.** Separate `media-generation-core` and `media-understanding-common`. → mya has `image_gen` + `image_info` as two tools but no clean crate separation. Splitting media concerns aids independent evolution.

6. **Dynamic extension packages (147) vs compiled-in macros.** openclaw ships channels/providers/tools as independent npm packages loaded at runtime via `plugin-sdk` + `plugin-package-contract`. → **mya compiles channels/providers via `for_each_model_provider_slot!` / `CHANNEL_COMPILE_SPECS` macros** (compile-time verified, drift-guarded, faster, safer). Trade-off: openclaw gains install-time extensibility + smaller core; mya gains type safety + no dynamic-load attack surface. **WASM plugins (`mya-plugins`) is mya's answer to safe dynamic extension** — keep leaning there.

7. **Provider topology patterns:** `codex-supervisor` (a *supervision* model wrapping codex), `copilot-proxy` / `opencode-go` (proxy/wrapper providers), `amazon-bedrock-mantle` (a layer over Bedrock). → **mya could add "supervisor" and "proxy" provider archetypes** (compose/wrap other providers) — useful for routing, cost control, fallback chains. mya's `reliable` wrapper is adjacent but not a named provider archetype.

8. **On-device MLX TTS (`macos-mlx-tts`).** A dedicated native app for Apple-Silicon local TTS. → mya has Piper TTS in robot-kit + TTS providers, but no on-device Apple-Silicon path. Native macOS/ios/android apps are a **capability gap** for mya (Tauri desktop + TUI only).

9. **Channels mya lacks:** Zalo, Zalo Personal, Synology Chat, **Tlon**, Google Chat, Microsoft Teams, WebChat, Google Meet (voice/video conferencing as a channel). → concrete channel backlog if mya wants parity in the personal-assistant lane.

10. **`minimumReleaseAge: 2880` (2 days).** pnpm refuses any dependency published <2 days ago — supply-chain cooling-off. → **mya has `cargo audit`/`deny.toml` but no "release age" gate.** Adding a min-age check (e.g. via `cargo-deny` advisory/yank + a custom age gate) would block fresh/typosquat deps.

11. **Aggressive `overrides` + `patchedDependencies`.** openclaw pins/overrides dozens of transitive deps (axios, tar, qs, protobufjs, AWS SDK, …) and ships a local patch (`patches/@openclaw__fs-safe@0.4.1.patch`). → mya uses `cargo` overrides less aggressively. For known-bad transitive crates, a `[patch]`/`cargo-deny` policy mirror is worth adopting.

## Top ideas worth adopting (prioritized)
1. **Tool-call *repair* layer** (`stream-normalize → grammar/payload repair → promote`) ahead of dispatch — biggest robustness win vs mya's parse-only approach.
2. **Standalone `mya-net-policy` crate** (egress allow/deny + SSRF) shared by gateway/tools/channels.
3. **Extract `mya-gateway-protocol`** from `mya-gateway` (protocol ≠ server).
4. **"Supervisor"/"proxy" provider archetypes** for composition/routing/fallback.
5. **Supply-chain: min-release-age gate** + transitive `[patch]` policy (mirror openclaw's `overrides`/`minimumReleaseAge`).

## Differences vs mya (same product, different bets)
| Axis | openclaw (TS) | mya (Rust) |
|---|---|---|
| Extension model | Dynamic npm packages (147) | Compile-time macros + WASM plugins |
| Verification | Runtime | Compile-time + drift tests |
| Mobile/native | android/ios/macos + MLX TTS | Tauri desktop + TUI only |
| Protocol layer | `gateway-protocol` separate | gateway monolithic |
| ACP | core package | bridge crate |
| Memory | `memory-host-sdk` | 8 backends + pipeline in `mya-memory` |
| Performance/safety | GC, dynamic | native, `forbid(unsafe)` (except `aardvark-sys`) |

Both are legitimate; **mya trades dynamism for safety + performance** — keep that as the differentiator while borrowing the architectural-decomposition and supply-chain ideas above.

## Gotchas / anti-patterns to avoid
- 147 dynamic extensions = large dependency/supply-chain surface (hence their heavy overrides/age-gates). mya's compile-time model avoids this — don't regress toward dynamic loading outside WASM.
- `package.json` is **115 KB** and `CHANGELOG.md` is **2.8 MB** — monorepo metadata bloat. Keep mya's per-crate manifests lean.

## Key reference files
- `README.md` (87 KB), `AGENTS.md` (41 KB), `pnpm-workspace.yaml`
- `packages/tool-call-repair/src/{grammar,payload,promote,stream-normalizer}.ts`
- `packages/{gateway-protocol,gateway-client,acp-core,net-policy,agent-core}/`
- `extensions/{codex-supervisor,copilot-proxy,amazon-bedrock-mantle}/`
- `apps/{macos-mlx-tts,swabble}/`

## Scope note (skipped)
Did not deep-read individual package source (agent-core loop, gateway-protocol message set, plugin-sdk contract). A follow-up pass on `tool-call-repair` + `gateway-protocol` + `plugin-package-contract` would yield deeper, code-level patterns if mya adopts ideas #1/#3/#6 above.
