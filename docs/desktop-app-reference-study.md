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

**Bottom line:** openpi is the UI reference to chase for a coding agent; openhuman
is the reference for native polish + companion/voice + status dashboards. mya's
desktop app is a solid foundation (Tauri shell + working runtime) — the gap is
frontend richness, and openpi shows exactly what "rich" looks like for this product class.
