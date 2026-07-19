# Desktop App Reference Study — openhuman vs openpi

> Goal: compare the two reference desktop apps' UI/UX + architecture, decide
> which has the best UI, and recommend concrete patterns for mya's desktop app
> (currently a plain self-contained `index.html` served by a Tauri v2 shell).

Sources read: `source/openhuman/` (Tauri + React), `source/openpi/` (Electron + SolidJS).

---

## 1. openhuman — Tauri + React (voice-first AI *companion*)

**Identity:** Not a coding tool. A macOS-native voice-first desktop **companion**
("Clicky-style": hotkey → mic → screen context → LLM → speech → pointing).

### Architecture
- **Shell:** `app/src-tauri/` — Tauri v2. macOS-private-API enabled, `titleBarStyle:
  "Overlay"` + `hiddenTitle` (frameless feel), `macOSPrivateApi: true`. Multiple
  windows: `main` + a native `NSPanel` notch window (`notch_window.rs`) + an
  `overlay` window. Packaging: macOS sidecar (`entitlements.sidecar.plist`) + NSIS
  Windows installer (`nsis-hooks.nsh`).
- **Frontend:** `app/src/` — React (App.tsx, AppRoutes.tsx, **AppRoutesIOS.tsx**
  — also ships an iOS layout). Heavy i18n (`lib/i18n/I18nContext`).
- **Core bridge:** standalone React roots (Notch/Overlay) connect to the Rust core
  over **Socket.IO** (`services/coreSocket`), NOT Tauri IPC — because the notch
  NSPanel WKWebView has no Tauri bridge. URL injected via `evaluateJavaScript`.

### Distinctive UI (the differentiators)
| Surface | File | What it does |
|---|---|---|
| **Mascot** | `mascot/MascotWindowApp.tsx` | Animated character in its own always-on-top window |
| **Notch** | `notch/NotchApp.tsx` | macOS Dynamic-Island-style voice pill: `ready → listening → transcribing → thinking → speaking → attention`. Never fully hides (always shows status). |
| **Overlay** | `overlay/OverlayApp.tsx` + `CompanionPointer.tsx` | STT dictation bubble + attention messages. Event-driven (no demo loop). Rotating-tetrahedron spinner. |
| **Companion engine** | `src/openhuman/desktop_companion/*.rs` | Rust state machine `Idle→Listening→Thinking→Speaking/Pointing`. Parses `[POINT:x,y:label:screenN]` tags → absolute multi-monitor coords. Provider handoff (Slack/Discord/email). |

### Supporting React surface
`components/`: ConnectionBadge, ConnectionIndicator, DictationHotkeyManager,
**PttHotkeyManager** (push-to-talk), LottieAnimation, MeshGradient, SecurityBanner,
AppUpdatePrompt, LocalAIDownloadSnackbar, RotatingTetrahedronCanvas.
`hooks/`: useDaemonHealth, useDaemonLifecycle, useIntelligenceSocket,
useNotchBootSync, **useCostDashboard**, **useMemoryIngestionStatus**, useDeveloperMode.

### Verdict on openhuman UI
**Best-in-class for a voice companion + macOS-native polish.** The
notch/mascot/overlay + PTT + pointing is a genuinely novel interaction model. The
dashboards (daemon health, cost, memory ingestion) are excellent reference for any
agent's status surfaces. But it is **not a coding UI** — no editor, no diff, no
conversation thread with tool calls.

---

## 2. openpi — Electron + SolidJS (coding-agent *IDE*)

**Identity:** A full coding-agent desktop **workbench** (composer + conversation +
code editor + git + terminal). The closest reference to what mya *is*.

### Architecture
- **Shell:** `electron/` — Electron + `electron-vite` + `electron-builder` +
  `electron-updater` + `electron-window-state`. Heavy IPC surface.
- **Frontend:** `src/` — **SolidJS** (signals, `createSignal`/`createMemo`/`Show`).
  `lucide-solid` icons. `App.tsx` = root shell.

### Workbench layout (`App.tsx`)
`TopBar` + `ConversationWorkspace` + `GitSidePanel` + `RightPanel` +
`TerminalPanel` + `ResizeHandle` + `ToolShimmerPane` + `Homescreen` + `Welcome` +
`AppOverlays`. A genuine resizable multi-pane IDE shell.

### The Composer (the standout UX) — `components/Composer.tsx`
A rich input with **6 inline pickers** + chips + badges:
| Picker | File | Role |
|---|---|---|
| ModelPicker | `composer/ModelPicker.tsx` | Switch model inline |
| ContextPicker | `composer/ContextPicker.tsx` | Attach context |
| MentionPicker | `composer/MentionPicker.tsx` | @-mention |
| SkillPicker / SlashCommandPicker | `composer/CommandPicker.tsx` | `/`-commands + skills |
| ThinkingPicker | `composer/ThinkingPicker.tsx` | Reasoning level |
| DeliveryMode | `composer/DeliveryMode.tsx` | Output mode |

Plus: `Chips` (AgentChip, FileChip, LineCommentChip, SkillChip), `Badges`
(ContextUsageButton, **TpsBadge**), `QueueList`, `ShellBanner`, `usePromptHistory`,
separate keyboard hooks (`useComposerKeybindings`, `useComposerTextareaKeyboard`).

### Conversation rendering — `components/conversation/`
Per-tool-type rows (not generic tiles): `EditToolRow`, `FileToolRow`,
`ShellToolRow`, `TaskToolRow`, `GenericToolRow`, `ExtensionResponseCard`,
`ToolCardView`, `MarkdownContent`, `MessageActions`, `usage.tsx`,
`SessionProgressDot`.

### Other surfaces
`CodeMirrorEditor` (in-app code editing), `CommandPalette` (cmd+k),
`CustomizationsModal` (AppearanceSection, BooleanPreferenceSection),
`ChangelogModal`, `ConfirmDialog`.

### Electron IPC surface (the depth signal)
`electron/git/*` (worktree, history, diff, file-tree, mutations, host, lock,
search — full git) + `electron/ipc/*` (agentReview, customizations, diagnostics,
files, preferences, **pty**, register, resources, search, settings, sound, themes,
update, workbench, workspaces).

### Design language (`DESIGN.md`)
Editorial/austere: black-ink-on-paper, five-tier grey ladder, single slate-blue
accent, hairline dividers, one proprietary sans with tight negative tracking.
(Note: this is largely the marketing-site language; the app itself is a dark IDE.)

### Verdict on openpi UI
**Best-in-class for a coding-agent desktop UI.** The Composer's inline pickers +
per-tool-row conversation + workbench panes (git/terminal/code) are exactly the
patterns a coding agent needs. SolidJS keeps the bundle lean and reactivity fine-grained.

---

## 3. Comparison

| Criterion | openhuman (Tauri+React) | openpi (Electron+SolidJS) |
|---|---|---|
| **Purpose** | Voice companion | Coding-agent IDE |
| **Shell** | Tauri v2 (Rust) | Electron (Node) |
| **UI lib** | React | SolidJS |
| **Bundle/security** | Smaller, Rust core, strict CSP | Larger (Chromium), IPC-heavy |
| **Standout feature** | Notch/Mascot/Overlay + PTT + pointing | Composer pickers + per-tool conversation + git/terminal/code panes |
| **Status dashboards** | daemon health, cost, memory ingestion ✓ | usage/tps badges, agent-review ✓ |
| **Native polish** | macOS-private-api, NSPanel notch, frameless | electron-window-state, updater |
| **Coding relevance to mya** | Low (no editor/diff/thread) | **High** (direct match) |

### Which has the best UI?
**It depends on category — but for mya the answer is openpi:**

- **openpi wins "best coding-agent UI"** (uncontested — it's the only one that is one).
  The Composer + per-tool-row conversation + workbench is the model to copy.
- **openhuman wins "best companion/polish UI"** — the notch/mascot/overlay voice
  model + macOS-native frameless polish are best-in-class, but they serve a
  *different product* (voice companion, not coding).

For mya — a coding/autonomous agent whose primary surface is the TUI — the desktop
app should **clone openpi's workbench patterns** and **borrow openhuman's status
dashboards + tray polish**.

---

## 4. Recommendations for mya (prioritized)

mya's current desktop app: Tauri v2 shell (`crates/desktop-shell`) + plain vanilla
`index.html` (`crates/desktop-ui`). It works (cargo check ✓, 12 TS tests ✓, runtime
endpoints verified) but is minimal — generic event tiles, no composer pickers, no
per-tool rendering, no panes.

| # | Recommendation | Source | Effort | Value |
|---|---|---|---|---|
| **1** | **Per-tool-row conversation rendering** — replace generic event tiles with typed rows (edit/file/shell/search/web) like openpi's `conversation/*ToolRow.tsx`. mya already emits typed turn events (Streaming/ToolCalls/ToolExec). | openpi | Med | High |
| **2** | **Composer with inline pickers** — ModelPicker (mya has multi-provider), SkillPicker (`/`-commands, mya has skills), ContextPicker, MentionPicker. mya's TUI already has slash-commands + autocomplete — port to web. | openpi | Med-High | High |
| **3** | **Command palette (cmd+k)** — openpi's `CommandPalette.tsx`. Cheap, high polish. | openpi | Low-Med | Med |
| **4** | **Status dashboards** — openhuman's useDaemonHealth/useCostDashboard/useMemoryIngestionStatus as sidebar widgets. mya already exposes `/status`, budget, memory. | openhuman | Med | Med |
| **5** | **Frontend build step** — move vanilla `index.html` → SolidJS (matches openpi, fine-grained reactivity, lean) OR React (matches openhuman). Add vite. Keep Tauri shell as-is (it's already good). | openpi | High | Med (unlocks 1-3) |
| **6** | **Git side panel + terminal pane** — only if desktop becomes a primary surface (currently TUI is primary). openpi's `GitSidePanel` + `TerminalPanel`. | openpi | High | Low (TUI covers it) |
| **7** | **macOS-native polish** — openhuman's `titleBarStyle: Overlay` + frameless + tray refinement. mya already has tray; add frameless title bar on macOS. | openhuman | Low | Low-Med |
| **8** | **Voice companion (future)** — openhuman's notch/overlay + PTT. mya already has TTS channels + voice_call. Only if voice mode is wanted. | openhuman | Very High | TBD |

### The pragmatic path
- **Now (low effort, high value):** #1 (per-tool rows) + #3 (command palette) +
  #4 (dashboards) — all doable in the existing vanilla `index.html` without a build step.
- **Next (the real upgrade):** #5 (build step → SolidJS) unlocks #2 (composer
  pickers). This is the single biggest leap toward openpi-quality.
- **Later:** #6/#7/#8 only if the desktop surface is promoted above the TUI.

---

## 5. Implementation status & gotchas (dashboard built — option A)

**Decision taken:** option **(A) monitor/dashboard** — the desktop app complements
the TUI rather than duplicating it as a second IDE. Implemented in
`crates/desktop-ui/index.html` (vanilla JS, no build step) + a gateway change.

### What was built
- **Sidebar widgets** (from `/status` + `/memory/stats`): model + configured
  providers, channels, memory stats (facts/tomb/dream/total), subagents active/total.
- **Header cost pill**: running spend, color-graded.
- **Per-tool conversation rows** (openpi pattern): typed icon/color per category
  (edit/shell/search/web/read/write) with live status pending→ok/err.
- **Streaming assistant text**: aggregated into one response block per turn.
- **Gateway CORS + WS localhost-origin**: enables browser/remote dashboard access.

### Gotchas (don't repeat — each cost a debug cycle)

1. **Gateway broadcasts pi's RAW streaming protocol, not `{kind}`.** The dashboard
   was first written assuming events like `{kind:"turn"|"budget"|"tool"}` (copied
   from the old minimal dashboard). The gateway actually broadcasts pi's protocol
   keyed by `type`: `agent_start/end`, `turn_start/end`, `message_start/end`,
   `message_update` (with `assistantMessageEvent.type`: `text_delta`/`toolcall_*`/
   `thinking_*`), `tool_execution_start/update/end`. **Symptom:** all events
   dumped as one JSON text blob. **Fix:** renderEvent discriminates on `e.type`;
   streaming text from `message_update`/`text_delta`; tool rows from
   `toolcall_end` + `tool_execution_*` matched by `toolCallId`; cost from
   `message_end.message.usage.cost.total`.

2. **Cost is NOT a separate event.** There is no `budget`/`kind:"budget"` event.
   Cost lives in `message_end.message.usage.cost = {input,output,cacheRead,
   cacheWrite,total}`. Accumulate `.total` across `message_end` events for the
   running spend. (Pre-existing `kind:"budget"` handling is dead code for this
   gateway — keep only if a different broadcaster emits it.)

3. **wsToken is required + random per start.** `mya serve` generates a token
   (`cryptoRandomToken()` → `randomBytes(16).hex`) and the WS upgrade 403s without
   it. In **production (Tauri)** the dashboard gets it via IPC `gateway_info`
   (`{port, ws_token}`). In **browser dev-mode** there's no IPC → must pass
   `?token=<hex>` in the dashboard URL. Extract the token from the gateway's own
   root HTML (`GET /` → `wsPath=/events?token=<hex>` is embedded).

4. **WS Origin allowlist (HIGH-1) is same-port only.** The cross-site WS
   hijacking defense allows only `http://127.0.0.1:${port}` etc. A browser
   dashboard served on a *different* loopback port (e.g. a dev `http.server` on
   8087) sends Origin `http://127.0.0.1:8087` → 403. **Fix:** also allow any
   localhost origin (regex `http://(localhost|127.0.0.1|[::1])(:\d+)?`),
   consistent with the HTTP CORS policy. Arbitrary internet origins stay blocked.

5. **bundle imports `@my-agent/gateway` from compiled `dist`, not source.**
   `npm run bundle` (esbuild) resolves `@my-agent/gateway` →
   `packages/gateway/dist/index.js` (compiled output), NOT `src/index.ts`. So
   editing gateway **source** then running only `npm run bundle` ships STALE code.
   **Fix:** `npx tsc -b packages/gateway --force` (recompile dist) → THEN
   `npm run bundle`. Same applies to any package whose source you edit.

### How to verify the dashboard (no Tauri/X display needed)
The dashboard has a **browser dev fallback** (no Tauri IPC required). Recipe:
1. `mya serve --port 3949` (gateway with CORS + WS localhost-origin).
2. Serve the dashboard statically: `python3 -m http.server 8087 --directory crates/desktop-ui`.
3. Extract the wsToken: `curl -s http://127.0.0.1:3949/ | grep -oE 'token=[a-f0-9]+'`.
4. Open in a real browser (plain Chromium hangs on the open WS; **Camofox** at
   `localhost:9377` renders reliably): navigate to
   `http://127.0.0.1:8087/index.html?port=3949&token=<hex>`.
5. Trigger an agent turn: a node `ws` client sends `{text:"..."}` to
   `ws://127.0.0.1:3949/events?session=default&token=<hex>` (Origin
   `http://127.0.0.1:3949`) → `onWsMessage` → `runOnSession` → events broadcast.
6. Camofox `GET /tabs/<id>/snapshot?userId=..&listItemId=..` → aria tree shows
   the rendered dashboard (widgets + tool rows + streaming text + cost pill).

**Verified:** widgets populate from real `/status`+`/memory/stats`; per-tool rows
(`▶ bash ls -la ok`, `📄 read README.md ok`) + streaming text render from pi's
actual protocol; cost pill accumulates live (`$0.0012 → $0.0018` across turns).

---

**Bottom line:** openpi is the UI reference to chase for a coding agent; openhuman
is the reference for native polish + companion/voice + status dashboards. mya's
desktop app chose **option A (monitor/dashboard)** — built + verified end-to-end
through a real browser. The remaining richness gap (composer pickers, code
editor, git panel) is deferred unless the desktop surface is promoted above the TUI.
