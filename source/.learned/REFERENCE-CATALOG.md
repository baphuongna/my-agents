# REFERENCE REPOS — 11 Source Projects Surveyed

> Cloned to `source/refs/` for architecture reference.
> Each repo solves a specific problem mya can learn from.

---

## 📊 Catalog

### 🖥️ App / UI

| Repo | Stack | What it does | mya can learn |
|------|-------|-------------|---------------|
| **openpi** | Electron + React + TS | Full desktop workbench: conversation view, composer, CodeMirror editor, command palette, changelog modal | Electron app architecture, React component patterns for agent UI |
| **pi-session-manager** | Vite + React + TS | Web dashboard with i18n (15 langs), router, runtime-data contexts, session browser, demo mode | Complete web UI: i18n, session management UX, real-time data display |

### 📱 Mobile

| Repo | Stack | What it does | mya can learn |
|------|-------|-------------|---------------|
| **pi-mobile** | Bun + TS | Mobile gateway: FaceID auth, session runtime, SSE streaming, session takeover, repo management, model listing | Mobile-first API design, FaceID integration, session takeover protocol |

### 🎨 TUI Theme

| Repo | Stack | What it does | mya can learn |
|------|-------|-------------|---------------|
| **pi-themes** | JSON | 25 themes: catppuccin, dracula, gruvbox, nord, tokyo-dark, monokai-pro, everforest, solarized, vesper, e-ink | Theme JSON format (same as mya's pi-theme-ansi), color palette reference |

### 🖱️ Control / Automation

| Repo | Stack | What it does | mya can learn |
|------|-------|-------------|---------------|
| **pi-computer-use** | TS + CDP | Browser automation: mouse/keyboard actions, UI action paths, outline extraction, view state, permissions | CDP action model, UI element targeting (ref vs coordinates), outline-based interaction |

### ⚡ Features / Extensions

| Repo | Stack | What it does | mya can learn |
|------|-------|-------------|---------------|
| **pi-dynamic-workflows** | TS | Dynamic workflow system: per-stage model routing, adversarial review, deep research, web tools, worktree isolation, task panel, structured output | Model routing config format, workflow-editor UX, adversarial review pattern |
| **pi-vcc** | TS | Git version control center: recall, sections, details, extract, hooks, tools | Git-integrated workflow, commit recall, structured diff view |
| **hypa** | C# (.NET) | Local context runtime: command output compression, token savings estimation, reducers for git/dotnet/kubectl/docker | Output compression strategies, deterministic token reduction (not LLM summarization) |
| **pi-lens** | TS + LSP | LSP diagnostics for AI agents: language-aware feedback, impact cascade diagnostics, navigation | LSP integration pattern, cascade impact analysis (edit file → diagnose dependents) |
| **pi-soly** | TS (monorepo) | API key rotation (pi-keyrouter) + solution framework | Multi-provider key rotation, rate-limit-aware routing |

### 🔧 Tool

| Repo | Stack | What it does | mya can learn |
|------|-------|-------------|---------------|
| **pi-hashline-edit-pro** | TS | Hash-anchored edit tool: content hash per line, precise replacement, undo store, stale anchor detection | Content-hash edit verification, stale-anchor detection, undo/snapshot store |

---

## 🎯 Top 5 Features mya Should Adopt

### 1. 🎨 Theme System (from pi-themes)
**25 ready-made themes** in JSON format. mya already has `pi-theme-ansi.ts` — just port the color palettes.

```
catppuccin.json → mya theme
dracula.json    → mya theme
gruvbox.json    → mya theme
... (22 more)
```

### 2. 🔑 API Key Rotation (from pi-soly/pi-keyrouter)
**Multi-key rotation** across providers. When one key hits rate-limit, auto-switch to next.

```ts
// pi-keyrouter pattern
keys: [KEY1, KEY2, KEY3]
→ rotate on 429/500
→ track usage per key
→ blacklist exhausted keys
```

### 3. 🧠 LSP Diagnostics (from pi-lens)
**Impact cascade**: edit a file → automatically diagnose all files that import it. mya has codegraph but no LSP cascade.

```
edit foo.ts → pi-lens runs diagnostics on:
  → foo.ts (direct)
  → bar.ts (imports foo)
  → baz.ts (imports bar)
```

### 4. 📉 Output Compression (from hypa)
**Deterministic token reduction** for command output. Not LLM summarization — pattern-based reducers.

```
git log --oneline -100 →
  hypa extracts: 3 merge commits, 2 reverts, errors, file paths
  → 100 lines → 8 lines (87% token savings)
```

### 5. ✏️ Hash-Anchored Edits (from pi-hashline-edit-pro)
**Content hash per line** prevents stale edits. mya's edit tool uses exact text match — hash-anchoring is more robust.

```
# Old: edit(path, oldText, newText)  ← fails if whitespace drifts
# New: edit(path, lineHash, newText) ← hash is stable, catches staleness
```

---

## 📁 Directory Structure

```
source/refs/
├── openpi/              # Electron desktop app (React)
├── pi-session-manager/  # Web session manager (React + i18n)
├── pi-mobile/           # Mobile gateway (Bun)
├── pi-themes/           # 25 theme JSONs
├── pi-computer-use/     # CDP browser automation
├── pi-dynamic-workflows/# Workflow system + model routing
├── pi-vcc/              # Git version control center
├── hypa/                # C# output compression runtime
├── pi-lens/             # LSP diagnostics + cascade
├── pi-soly/             # Key rotation + solution framework
└── pi-hashline-edit-pro/# Hash-anchored edit tool
```

---

## 🔍 Detailed Feature Matrix

| Feature | openpi | session-mgr | mobile | themes | comp-use | workflows | vcc | hypa | lens | soly | hashline |
|---------|--------|-------------|--------|--------|----------|-----------|-----|------|------|------|----------|
| Desktop UI | ✅★★ | — | — | — | — | — | — | — | — | — | — |
| Web UI | — | ✅★★ | — | — | — | — | — | — | — | — | — |
| Mobile | — | — | ✅★★ | — | — | — | — | — | — | — | — |
| Themes | — | — | — | ✅★★ | — | — | — | — | — | — | — |
| Browser automation | — | — | — | — | ✅★★ | — | — | — | — | — | — |
| Model routing | — | — | — | — | — | ✅★★ | — | — | — | ✅ | — |
| Git workflow | — | — | — | — | — | — | ✅★★ | — | — | — | — |
| Output compression | — | — | — | — | — | — | — | ✅★★ | — | — | — |
| LSP diagnostics | — | — | — | — | — | — | — | — | ✅★★ | — | — |
| Key rotation | — | — | — | — | — | — | — | — | — | ✅★★ | — |
| Edit precision | — | — | — | — | — | — | — | — | — | — | ✅★★ |
| i18n | — | ✅ | — | — | — | — | — | — | — | — | — |
| Session mgmt | ✅ | ✅★★ | ✅ | — | — | ✅ | — | — | — | — | — |
| SSE/streaming | — | ✅ | ✅★★ | — | — | — | — | — | — | — | — |
| Worktree isolation | — | — | — | — | — | ✅★ | — | — | — | — | — |
