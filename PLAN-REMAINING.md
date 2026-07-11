# PLAN-REMAINING — Phase 18+ (Complete Pi-Quality TUI)

> Goal: full TUI feature parity with pi, claw-code, oh-my-pi, hermes-agent reference.
> Phase 18 shipped the Ink skeleton (slash commands, history, status bar). This plan
> finishes the rest in 6 sub-phases.

## Confirmed scope (user, 2026-07-11)
- **Slash commands**: core ~25 + 3 selectors (model/skill/tool tree-picker)
- **Editor**: fuzzy autocomplete on `/` + Tab (pi-style suggest overlay)
- **Theme**: 3 built-in (dark/light/dim) + `/theme` command

## Phase 19: Slash commands (25)
**Files**: `packages/tui/src/ink-commands.ts` (new) + `ink.tsx` (import + mount)

| Category | Commands |
|---|---|
| **Session** | `/help /quit /clear /clear --confirm /status /cost /resume /fork` |
| **Model** | `/model <name>` (show/switch), `/model-selector` (tree picker) |
| **Tools** | `/tools` (list), `/skill-selector` (fuzzy), `/tool-selector` (multi-select) |
| **Permissions** | `/permissions <read-only\|workspace-write\|danger-full-access\|prompt>` |
| **Memory** | `/memory` (count), `/memory-search <query>`, `/memory-clear` |
| **Config** | `/config <key> <value>`, `/config env`, `/config show` |
| **Compaction** | `/compact` (truncate old), `/compact <last-N>` |
| **Export/Import** | `/export <file>` (transcript → markdown), `/import <file>` (replay) |
| **MCP** | `/mcp list`, `/mcp show <name>`, `/mcp reload` |
| **Skills** | `/skills list`, `/skills show <name>`, `/skills reload` |
| **Tree/Pickers** | `/tree <dir>` (interactive file tree) |

**Test**: `packages/tui/src/ink-commands.test.tsx` — 8 tests via ink-testing-library.

## Phase 20: Fuzzy autocomplete overlay
**Files**: `packages/tui/src/autocomplete.ts` (new) + `ink-text-input` upgrade to use `useInput` raw mode

- **Trigger**: type `/` → overlay appears with fuzzy-matched commands
- **Navigation**: `↑/↓` walks, `Tab`/`Enter` accepts, `Esc` dismisses
- **Filter**: case-insensitive substring + minimal fuzzy (e.g. `/mdl` matches `/model`)
- **Visual**: 2-line popup above the input; shows `[name]` `[description]` `[kbd-hint]`
- **Skills integration**: when typing `/skill <name>`, also show matching skills
- **Files integration**: when typing `@<path>`, also show matching files (lazy — only on `@`)

**Test**: `autocomplete.test.ts` — fuzzy match + navigation + accept/dismiss.

## Phase 21: 3 themes + `/theme` command
**Files**: `packages/tui/src/themes.ts` (new) + `ink.tsx` (read active theme from state)

| Theme | Foreground | Background | Border | Muted | Accent |
|---|---|---|---|---|---|
| **dark** (default) | white | black | gray | gray | cyan |
| **light** | black | white | gray | gray | blue |
| **dim** | gray | black | darkgray | dimgray | gray |

- **`/theme [name]`** — show current / switch
- **`/theme-list`** — show all
- **Persistence**: `~/.my-agent/theme.toml` (single line: `theme = "light"`) — survives sessions
- **Hot reload**: theme change re-renders the entire session

**Test**: `themes.test.ts` — 4 tests (color map per theme + persistence + hot reload).

## Phase 22: Selectors (interactive tree-pickers)
**Files**: `packages/tui/src/selectors.ts` (new)

Three modal components (R26-R28-style nested UI):
- **`<ModelSelector>`** — list of models from `provider.list()`, grouped by provider, `↑/↓` + Enter
- **`<SkillSelector>`** — fuzzy filter, shows all skills from `SkillStore.index()`, Enter to invoke
- **`<ToolSelector>`** — multi-select checkbox list of registered tools, Enter to confirm + run selected ones

Each replaces the right-pane temporarily (modal overlay); on selection, returns value to parent.

**Test**: `selectors.test.tsx` — 6 tests (each selector renders + selects + cancels).

## Phase 23: Advanced editor features
**Files**: `packages/tui/src/editor.ts` (replace `ink-text-input` wrapper)

| Feature | Keystroke | Behavior |
|---|---|---|
| **Multi-line enter** | `Enter` | Newline (preserves indentation) |
| **Submit** | `Esc` then `Enter` OR `Ctrl+D` empty | Submit current draft |
| **Kill word back** | `Ctrl+W` | Delete last word |
| **Kill to BOL** | `Ctrl+U` | Delete to start of line |
| **Kill to EOL** | `Ctrl+K` | Delete to end of line |
| **Yank** | `Ctrl+Y` | Paste last killed text |
| **Cursor left/right** | `←/→` | Move cursor (preserves draft) |
| **Cursor home/end** | `Home/End` | Jump to start/end |

(Keeps `↑/↓` for history navigation, kept from Phase 18.)

**Test**: `editor.test.tsx` — 8 tests for each editor command.

## Phase 24: Transcript polish + scrollback
**Files**: `packages/tui/src/transcript.tsx` (extract from `ink.tsx`)

- **Auto-scroll** to bottom on new line unless user scrolled up
- **Manual scrollback**: `Shift+↑/↓` walks older lines; `g` jumps to top, `G` to bottom
- **Selection highlight**: `Ctrl+L` selects the word at cursor; Ctrl+C copies
- **Token-count badge** in the transcript header: `12,847 tokens · $0.1234`
- **Markdown rendering**: assistant lines pass through a minimal markdown -> ANSI renderer (headers bold, `code` highlighted, lists indented)

**Test**: `transcript.test.tsx` — 5 tests (auto-scroll, scrollback, markdown).

## Phase 25: Wire it all into a second 3-round review + test cycle

After all 6 sub-phases:
1. Run full suite — target 300+ tests
2. 3 review rounds with reviewer + security-reviewer + cold-verifier
3. Fix all CRITICAL/HIGH findings
4. Bundle + global install verify
5. Final demo: launch `mya` in real tmux, exercise slash commands end-to-end

## File layout after Phase 19+

```
packages/tui/src/
├── index.ts          # existing readline TuiRepl (non-TTY fallback)
├── ink.tsx           # existing InkSession — orchestrates everything
├── ink-commands.ts   # Phase 19: 25 slash commands + helpers
├── autocomplete.ts   # Phase 20: fuzzy /command overlay
├── themes.ts         # Phase 21: dark/light/dim + persistence
├── selectors.ts      # Phase 22: ModelSelector / SkillSelector / ToolSelector
├── editor.ts         # Phase 23: kill/yank/word-nav wrapper around ink-text-input
├── transcript.tsx    # Phase 24: scrollback + markdown rendering
├── ink.test.tsx      # existing 8 tests
├── ink-commands.test.tsx
├── autocomplete.test.ts
├── themes.test.ts
├── selectors.test.tsx
├── editor.test.tsx
└── transcript.test.tsx
```

## Total LOC estimate (additive to current ~700 LOC)
- `ink-commands.ts`: ~400 LOC (25 commands + 3 selector wires)
- `autocomplete.ts`: ~150 LOC (fuzzy match + overlay)
- `themes.ts`: ~100 LOC (3 themes + persistence)
- `selectors.ts`: ~350 LOC (3 components)
- `editor.ts`: ~200 LOC (kill-ring + yank + 6 keybindings)
- `transcript.tsx`: ~250 LOC (markdown + scrollback + token badge)
- Test files: ~400 LOC (~25 tests total)
- **Total: ~1,850 LOC new** (TS + JSX + tests)

## Risk notes
- **Ink re-render storm**: every event re-renders the whole transcript (managed by React). For long sessions (>500 lines) consider virtualization. Phase 24 will cap at MAX_HISTORY_LINES=500 (already in Phase 18).
- **Bundles weight**: 796K now → estimate 1.0MB after all 6 phases (~+200K from new components).
- **Backwards compat**: the readline TuiRepl (non-TTY path) stays untouched — Phase 15 user base unaffected.
- **No new runtime deps**: only `fzf`-style scoring (in-house, ~30 LOC) + `marked` for markdown (~10K, optional — can omit if size is a concern).

## Build order (sequenced, dependency-safe)
1. **Phase 19** first — slash commands are the surface everything else hangs off
2. **Phase 21** second — themes affect every other phase's visuals
3. **Phase 20** third — autocomplete uses the slash commands from 19
4. **Phase 22** fourth — selectors depend on commands + themes
5. **Phase 23** fifth — editor polish (independent of the others)
6. **Phase 24** last — transcript polish + markdown (visual final layer)
7. **Phase 25** wraps — 3 review rounds + global install verification

## After Phase 25: still open (deferred)
- §3 OSC 8 hyperlinks (terminal-feature-gated)
- §3 Kitty graphics / inline image (terminal-feature-gated)
- §25.3 desktop companion (Tauri)
- §25.4 collab room (requires CRDT + E2E encryption)
- §25.5 voice/desktop mode
- §25.7 i18n (`en`/`ja`/`zh`/`zh-hant`)
