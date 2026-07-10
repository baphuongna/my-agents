# pi-coding-agent — Study for unified agent SPEC

> Studied 2026-07-10. **Source:** `/home/bom/source/my-agent/source/pi-coding-agent` (`packages/coding-agent` of `earendil-works/pi`, ~69K⭐ monorepo, MIT, v0.80.3). Author: Mario Zechner (badlogicgames). pi.dev.
> **TL;DR:** The **minimal-extensible** terminal coding harness THIS assistant runs in. Its philosophy is the *deliberate opposite* of oh-my-pi: ship a tiny, stable core and push EVERY capability out to composable TS **Extensions / Skills / Prompt Templates / Themes** distributed as npm/git "Pi Packages". The clearest example of **composition-over-features** + multi-mode (interactive/print/JSON/RPC/SDK) in the set.

## Stack & Architecture

```
pi-coding-agent/  (TypeScript, Bun/Node, lean: 18 deps)
├── src/
│   ├── core/            # the narrow agent core (loop, session, providers, tools)
│   ├── cli/, cli.ts     # interactive mode
│   ├── modes/           # interactive · print/JSON · RPC · SDK (4 integration modes)
│   ├── bun/             # Bun-specific runtime glue
│   ├── utils/
│   ├── config.ts, main.ts, index.ts, migrations.ts, rpc-entry.ts, package-manager-cli.ts
├── docs/                # compaction, containerization, custom-provider, extensions,
│                        # prompt-templates, rpc, sdk, security, session-format, sessions, ...
├── examples/  test/  vitest.config.ts
```

**4 modes (one core, many surfaces):** interactive (TUI) · print/JSON (one-shot, scriptable) · RPC (process integration, JSON over stdio) · SDK (embed in your own app). Same core, different front-ends — the SPEC's "one core, many transports" principle.

## Key Patterns (Pattern → Why → Spec rec)

1. **Minimal core + composable packages.** "Adapt pi to your workflows, not the other way around." Capabilities are TS packages installable via npm/git, not compiled in. → **SPEC: a tiny stable core + everything else (subagents, plan mode, memory, channels) as versioned, installable packages.** Enables a la carte adoption + no fork-to-extend.
2. **Deliberately omits subagents & plan mode.** "Pi skips features like sub agents and plan mode. Instead, you can ask pi to build what you want or install a third-party pi package." → Strong signal: **these belong in packages, not core.** The SPEC's core must be small enough that subagents/plan-mode are optional add-ons.
3. **Four integration modes from one core.** interactive / print+JSON / RPC / SDK. → **SPEC: design the core to be mode-agnostic; transport (TUI/stdio-RPC/embed-SDK) is a thin adapter.**
4. **Skills (progressive disclosure) + Prompt Templates + Themes + Extensions** as first-class extension kinds. → **SPEC: enumerate the extension kinds explicitly (tools, skills, prompt-templates, themes, modes) — each a package type.**
5. **Session format + sessions + compaction as documented, stable contracts** (docs/session-format.md, sessions.md, compaction.md). → **SPEC: the session/resume/compaction format is a public, versioned contract, not an internal detail.**
6. **OpenOSS session sharing to HuggingFace** (`pi-share-hf`) for model/prompt/tool eval data. → **SPEC: opt-in session export for evaluation data flywheel.**
7. **Lean dependency surface (18 deps).** → Minimal core = minimal supply-chain attack surface + fast install.
8. **Containerization + custom-provider docs as first-class.** → Deployment + provider-extensibility are documented commitments, not afterthoughts.

## Notable / Novel
- **The philosophy contrast with oh-my-pi is the lesson:** pi = "small core, big ecosystem of packages"; oh-my-pi = "big integrated binary with Rust core". The **SPEC synthesizes both**: pi's minimal package-driven core + oh-my-pi's Rust perf layer underneath the same packages.
- **"Maintainers review auto-closed issues daily"** — governance pattern for a heavily-extended harness (the SPEC should plan for a package ecosystem + contribution policy).

## ★★ TOP 5 PORT-WORTHY PATTERNS
1. **Tiny stable core + every capability as an installable package** (npm/git) — composition over compilation.
2. **Four integration modes (interactive/print+JSON/RPC/SDK) from one core** — transport-agnostic core.
3. **Explicit extension kinds:** tools, skills, prompt-templates, themes, modes.
4. **Session/compaction as a versioned public contract** (resumable, inspectable).
5. **Deliberate feature omission** (subagents/plan-mode are packages, not core) — keeps the core small & stable.

## Verdict
pi-coding-agent uniquely contributes the **minimal-core + package-ecosystem philosophy** and the **multi-mode (TUI/stdio-RPC/SDK) transport model** — the architectural discipline that keeps a heavily-extended agent harness maintainable. Pair it with oh-my-pi's Rust perf layer for the optimal hybrid.

## Key reference files
| Path | Teaches |
|---|---|
| `README.md` | minimal-core philosophy; 4 modes; extension kinds |
| `docs/extensions.md`, `docs/prompt-templates.md`, `docs/packages.md` | package/extension model |
| `docs/rpc.md`, `docs/sdk.md`, `docs/json.md` | multi-mode transport contracts |
| `docs/session-format.md`, `docs/sessions.md`, `docs/compaction.md` | stable session/resume/compaction contract |
| `docs/security.md`, `docs/containerization.md`, `docs/custom-provider.md` | ops + extensibility commitments |
| `src/modes/`, `src/core/` | mode-agnostic core structure |

## Scope note
Did not read `src/core/*` internals (loop, provider, tool dispatch) in depth. A deeper pass on the core loop + the RPC protocol would yield the concrete transport contract when implementing the SPEC's multi-mode core.
