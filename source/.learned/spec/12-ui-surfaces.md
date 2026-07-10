# 25. UI Surfaces — CLI / TUI / Web / Desktop

> Part of the Unified Agent SPEC — [← overview](00-OVERVIEW.md). §25.
> All UI surfaces are **consumers of the typed `RuntimeEvent` bus (§13)** — they never scrape stdout (invariant #11). The 4 transport modes (interactive/print/rpc/sdk) are how the *same* core reaches different UIs. UI is largely **phase-2 packages**; only the **UI↔Runtime event contract (§25.6)** is core.

## 25.1 TUI / CLI (interactive mode)
Terminal UI (Ink/React) rendering the agent loop — themes (51-token), namespaced keybindings, slash-commands/editor/autocomplete/navigation, UX primitives, OSC graphics+hyperlinks. *([pi](../../pi-coding-agent/src/modes/interactive/) · [oh-my-pi](../../oh-my-pi/packages/tui/) · [hermes](../../hermes-agent/hermes_cli/skin_engine.py))*

## 25.2 Web dashboard
Gateway-served SPA; routes (`/`, `/sessions/:id`, `/approvals`, `/settings`); auth = session cookie + CSRF double-submit; WS subscription to §13 RuntimeEvent bus w/ replay-from-cursor; approval modal binds `{kind:"approval";stage:"requested"|"decided"}`. *([oh-my-pi](../../oh-my-pi/packages/tui/) · [pi-coding-agent](../../pi-coding-agent/src/modes/))*

## 25.3 Desktop app
Native shell (Electron/Tauri) wrapping web UI + tray/overlay/notification; deep-link URI scheme `myagent://` validated; IPC over typed channel (no `nodeIntegration`); updater signing = sigstore + content-hash before apply; sidecar lifecycle gates on §13 boot readiness. *([MyAgents](../../MyAgents/src-tauri/) · [openhuman](../../openhuman/))*

## 25.4 Realtime collaboration
Shareable web room (deep-link `#<roomId>.<key>`), E2E-encrypted; authz matrix = owner RW / guest RO / guest write-via-approval; key rotation + revocation; CRDT/last-write-wins merge for shared session; audit retention per §13. *([oh-my-pi collab-web](../../oh-my-pi/packages/collab-web/) · [openhuman tinyplace Signal E2E](../../openhuman/src/openhuman/tinyplace/))*

## 25.5 Desktop companion
Always-on voice+screen+pointer assistant; FSM `Idle→Listening→Thinking→Speaking/Pointing→Idle`; capture lifetime + retention policy; screen/audio consent binds §7 permission gate; RuntimeEvent mapping drives tool-render; failure modes = provider handoff, capture-denied. *([openhuman desktop_companion](../../openhuman/src/openhuman/desktop_companion/))*

## 25.6 UI ↔ Runtime event contract (CORE)
Wire envelope: `{ version:1; sessionId; runId?; laneId?; seq; event:RuntimeEvent; ts }` (§13). Replay cursor `?since=seq`; backpressure = WS drops + SSE 16 MiB cap (§4 SSE_BUFFER_BYTES); reconnect = `since=last_seq`; dispatch by `event.kind` → modal (approval) / stream (turn) / footer (budget). **Only** core UI section.

## 25.7 Cross-cutting UI design constraints
Token-driven theming (CSS vars); i18n parity (`en`/`ja`/`zh`/`zh-hant`, build-gated); one primitive per concern (Button/ListRow/SearchField/Loader/ErrorState/modal); per-surface auth (signed-hello web / OAuth dialogs desktop / managed-credential Tauri); lazy + Suspense per route; per-tab/per-window state isolation; WCAG 2.1 AA baselines for web dashboard (§21). *([hermes DESIGN.md](../../hermes-agent/apps/desktop/DESIGN.md) · [openclaw i18n](../../openclaw/scripts/control-ui-i18n.ts))*

### Open questions (UI)
- **UQ-UI-1**: one web framework (Lit vs React) or both behind a package alias?
- **UQ-UI-2**: adopt oh-my-pi collab snapshot-chunk+progress-timer pattern as ref impl.
- **UQ-UI-3**: reuse MyAgents `cmd_fb_relay` for pet-overlay + companion + main triad.
- **UQ-UI-4**: encode session-id requirement as a `required_scope` field on RuntimeEvent.
