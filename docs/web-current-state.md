# mya Web Dashboard — Current State

> Last updated: 2026-07-21 (commit `34f813f`)

## Overview

mya web dashboard is a React 19 + Vite 8 + Tailwind CSS 3 SPA built in-house (NOT a Hermes clone — that attempt was reverted in `db6c274`). It serves from `packages/web/dist/web/` and is delivered by the Node gateway at `localhost:3999`.

- **59 source files**, **7,972 LOC**
- **Bundle**: 410KB JS (124KB gzip) + 38KB CSS (7KB gzip)
- **Tests**: 1,824/1,825 pass (1 pre-existing firecrawl flake)

## Architecture

### Stack
- **React 19** + **react-router-dom 7** (SPA routing)
- **Vite 8** (build tool, ESM, code-splitting)
- **Tailwind CSS 3.4** (RGB space-channel colors for `<alpha-value>` support)
- **lucide-react** (icons)
- **clsx** + **tailwind-merge** (className utilities)
- No external state library (React Context + hooks)
- No CSS framework besides Tailwind + custom CSS in `index.css`

### Project Structure

```
packages/web/
├── index.html              # Entry HTML with FOUC-prevention script
├── vite.config.ts          # Build config (outDir=dist/web, proxy to :3999)
├── tailwind.config.js      # RGB color tokens, animations
├── postcss.config.js       # tailwindcss + autoprefixer
├── tsconfig.json           # JSX, paths (@/* → ./src/*)
├── src/
│   ├── main.tsx            # React root, providers stack
│   ├── App.tsx             # Routes, mobile sidebar state
│   ├── index.css           # Design system v3 (~200 lines)
│   ├── lib/
│   │   ├── api.ts          # Typed gateway API client
│   │   ├── format.ts       # timeAgo, formatDuration, cron helpers
│   │   ├── i18n.tsx        # EN/VI translations (40+ keys)
│   │   ├── modal.tsx        # Modal + ConfirmDialog + useModalBehavior
│   │   ├── theme.tsx       # 5 themes, CSS variable injection
│   │   ├── toast.tsx        # Toast context + hook
│   │   ├── utils.ts         # cn() helper
│   │   └── ws.ts            # EventClient (WebSocket)
│   ├── hooks/
│   │   ├── useAsync.ts      # Generic data fetch with reload
│   │   └── useHealth.ts     # Gateway health polling
│   ├── components/
│   │   ├── Sidebar.tsx     # Collapsible nav (224px/56px)
│   │   ├── Header.tsx       # Global top bar
│   │   ├── StatusStrip.tsx  # Gateway status in sidebar
│   │   ├── ThemeSwitcher.tsx # 5-theme picker
│   │   ├── LangToggle.tsx   # EN/VI switch
│   │   ├── CommandPalette.tsx # Cmd+K navigation
│   │   ├── ErrorBoundary.tsx # Error fallback
│   │   ├── PageBits.tsx     # PageHeader, LoadingSpinner, ErrorBox, EmptyState
│   │   ├── Markdown.tsx     # Chat markdown renderer
│   │   ├── Charts.tsx       # Sparkline, ProgressBar, RadialGauge
│   │   ├── ScheduleBuilder.tsx # Visual cron editor
│   │   ├── ModelPickerDialog.tsx # Model selector modal
│   │   ├── AutomationBlueprints.tsx # 6 cron templates
│   │   ├── prompt-bar.ts    # Legacy chat input
│   │   ├── session-list.ts  # Legacy session list
│   │   ├── approval-modal.ts # Legacy approval dialog
│   │   └── ui/              # Card, Button, Badge primitives
│   └── pages/             # 18 pages (see below)
└── public/                # PWA manifest, icons
```

## Pages (18 total)

| Path | Component | Purpose |
|---|---|---|
| `/dashboard` | DashboardPage | Overview with metrics, providers, roles, models |
| `/chat` | ChatPage | Agent chat with streaming WS + pool API |
| `/sessions` | SessionsPage | Session list + detail with transcript |
| `/events` | EventsPage | Live WebSocket event stream |
| `/cron` | CronPage | Cron job CRUD + schedule builder |
| `/models` | ModelsPage | Model registry grouped by provider |
| `/tools` | ToolsPage | Tool list grouped by permission mode |
| `/files` | FilesPage | Read-only file browser (stub) |
| `/analytics` | AnalyticsPage | Metric cards with sparklines |
| `/logs` | LogsPage | Live log viewer from WS |
| `/config` | ConfigPage | Runtime config key-value viewer |
| `/skills` | SkillsPage | Static skill registry (stub) |
| `/status` | StatusPage | System metrics with RadialGauges |
| `/channels` | RichInfoPage | API discovery for channels |
| `/mcp` | RichInfoPage | API discovery for MCP |
| `/sync` | SyncPage | Sync state viewer |
| `/push` | PushPage | Web Push subscribe/unsubscribe |
| `/collab` | CollabPage | Collab rooms viewer |
| `/env` | EnvPage | API key management |

## Design System

### Color Tokens (CSS Variables)
All colors use **RGB space-channel format** (e.g. `88 166 255`) for Tailwind `<alpha-value>` support.

| Token | Default (dark) |
|---|---|
| `--bg` | `#0b0d10` (GitHub dark) |
| `--bg-surface` | `#161b22` |
| `--bg-elevated` | `#1c2330` |
| `--bg-input` | `#0d1117` |
| `--border` | `#30363d` |
| `--fg` | `#e6edf3` |
| `--fg-muted` | `#8b949e` |
| `--fg-subtle` | `#6e7681` |
| `--accent` | `#58a6ff` |
| `--success` | `#3fb950` (WCAG AA compliant) |
| `--warning` | `#e3b341` |
| `--danger` | `#f85149` |
| `--purple` | `#a371f7` |
| `--orange` | `#f0883e` |

### Themes (5)
1. **dark** (default) — GitHub-inspired
2. **midnight** — Deep blue-violet
3. **teal** — Classic teal glow (Hermes-inspired)
4. **ember** — Warm dark amber
5. **mono** — Minimal monochrome

Themes are applied via `data-theme` attribute on `<html>`, with CSS variables injected via JS. **FOUC prevention** is handled by an inline blocking script in `index.html` that reads `localStorage` and sets CSS vars before first paint.

### i18n
- English (en) + Vietnamese (vi)
- 40+ translation keys in `lib/i18n.tsx`
- Toggle in sidebar footer via `LangToggle` component

### Key CSS Utilities (index.css)
- `.card` — `bg-bg-surface` + 1px border + box-shadow
- `.card-hover` — adds accent border + lift on hover
- `.glass` — `bg-bg-surface/80` + `backdrop-blur-md`
- `.gradient-text` — linear-gradient clipped to text
- `.btn-primary` — gradient bg + glow shadow
- `.shimmer` — loading skeleton
- `.animate-fade-in-up` — stagger entrance animation
- `@media (pointer: coarse)` — 44px touch targets
- `@media (prefers-reduced-motion: reduce)` — disable animations
- `@media (pointer: fine)` — 8px scrollbar for mouse

## Responsive Breakpoints

Tailwind defaults: `sm=640px`, `md=768px`, `lg=1024px`, `xl=1280px`, `2xl=1536px`.

| Viewport | Layout |
|---|---|
| **320-414px** (mobile) | 1-column stacks, sidebar as drawer, hamburger menu |
| **414-767px** (large mobile) | 2-column grids activate, sidebar still drawer |
| **768-1023px** (tablet) | 3-4 column grids, sidebar still drawer (hidden on lg+) |
| **1024-1279px** (desktop) | Sidebar visible (224px expanded / 56px collapsed), main content fills |
| **1280-1535px** (large desktop) | Same as above, wider content cards |
| **1536px+** (2xl) | More columns, larger content |

## API Client (`lib/api.ts`)

Typed wrappers around the mya Node gateway endpoints (port 3999):

| Endpoint | Helper |
|---|---|
| `GET /status` | `api.status()` |
| `GET /sessions` | `api.sessions()` |
| `GET /cron/jobs` | `api.cronJobs()` |
| `POST /cron/jobs` | `api.cronAdd(job)` |
| `POST /cron/jobs/:id/run` | `api.cronRun(id)` |
| `GET /models` | `api.models()` |
| `GET /tools` | `api.tools()` |
| `GET /health/live` | `api.health()` |
| `WS /events` | `eventClient` singleton |
| `POST /pool/acquire` | Used in ChatPage |
| `POST /pool/prompt/:id` | Used in ChatPage |
| `GET /push/vapid-key` | Used in PushPage |
| `GET /sync/state` | Used in SyncPage |
| `GET /collab/rooms` | Used in CollabPage |
| `POST /dashboard/theme` | Used in ThemeSwitcher |

All calls use `credentials: "include"` for cookie auth, have a **15s AbortController timeout**, and check `res.ok`.

## WebSocket Client (`lib/ws.ts`)

- Connects to `ws://localhost:3999/events?session=*` (or specific session)
- **Cookie-based auth** (HttpOnly mya_ws cookie)
- **Exponential backoff reconnect**: 1s → 2s → 4s → 8s → 16s → 30s max
- **Intentional close guard** prevents reconnect race
- Event format: `{ sessionId, seq, event: { type, ... } }` envelope
- **Wildcard session (`*`)** receives ALL events (used by EventsPage, LogsPage)

## Recent Major Changes (last 15 commits)

| Commit | Change |
|---|---|
| `34f813f` | 20-round deep responsive audit fixes (25 issues) |
| `d6d01c7` | Mobile touch targets + adaptive grids |
| `09174bf` | build.test.ts uses temp dir (never deletes real dist) |
| `ec8f1bb` | FOUC prevention + format guards (NaN, empty input) |
| `1a1d63b` | Modal focus trap + markdown link regex |
| `e36689c` | ScheduleBuilder accessibility (44px targets, a11y labels) |
| `6714a91` | ModelPickerDialog error handling + key collision |
| `cb1c7bb` | API 15s timeout + toast cleanup + modal polish |
| `d60fe41` | WS reconnect, Markdown fix, Charts NaN guards |
| `fcaf6d5` | Card style prop, broken animation classes, StatusPage uptime |
| `2c4f58f` | CSS v3, theme tokens, ErrorBoundary, accessibility |
| `b73387b` | 20-round review, 6 pages upgraded |
| `53a4921` | **RGB space-channel colors** — opacity modifiers work |
| `e622cee` | Dashboard overview + SVG charts |
| `fe157ac` | Visual design system (gradients, glass, animations) |

## Key Fixes This Session

### Critical Bugs Fixed
1. **RGB color tokens** — Tailwind opacity modifiers (`bg-accent/10`, `text-fg-subtle/70`) now work
2. **Card style prop** — was silently dropping `style`, animations now propagate
3. **StatusPage StatCards duplicate grid** — was stacking 6 cards vertically on mobile
4. **theme() runtime bug** — was literal string, replaced with `rgb(var())` inline
5. **WS disconnect race** — added `intentionalClose` flag
6. **WS no backoff** — exponential 1s→30s
7. **API no timeout** — 15s AbortController
8. **Modal no focus trap** — Tab cycling
9. **Theme FOUC** — inline script applies CSS vars before first paint
10. **Test cleanup** — `build.test.ts` was deleting real dist, now uses temp dir

### Accessibility
- WCAG AA contrast for badges, placeholders
- 44×44 touch targets on coarse pointers
- `role="alert"`, `role="dialog"`, `role="status"`, `aria-live`
- Focus-visible rings on all interactive elements
- `prefers-reduced-motion` respected
- `prefers-color-scheme` (could be added, not yet)

## Gateway Integration

The mya Node gateway serves the SPA from `packages/web/dist/web/`:

- `/` and `/index.html` → SPA HTML with theme FOUC script
- `/assets/*` → Vite-built JS/CSS bundles (allowlisted)
- `/icons/*` → PWA icons (allowlisted)
- API endpoints (`/status`, `/sessions`, `/cron/*`, etc.) → real handlers
- WS at `/events` → event streaming
- CSP: `style-src 'self' 'unsafe-inline'`, `connect-src 'self'`

The gateway generates a token on startup (`~/.mya/agent/gw.token`), sets an HttpOnly `mya_ws` cookie on GET /, and uses the cookie for subsequent requests.

## Build & Run

```bash
cd packages/web
npx vite build          # → dist/web/
cd ../..
npm run bundle          # → dist/mya.js (bundles gateway + web)
node dist/mya.js serve --port 3999  # Start gateway
```

## Test Suite

- **1,824/1,825 tests pass** (1 pre-existing firecrawl flake, not related to web)
- Test config: `vitest.config.ts` with `pool: forks`
- Build test uses **temp dir** (never deletes real dist)
- Coverage: lib, components, pages, hooks

## Known Limitations / Stubs

1. **FilesPage** — stub data only (no real `/files/list` endpoint)
2. **SkillsPage** — static array (no API fetch)
3. **RichInfoPage** — placeholder for Channels/MCP
4. **ChatPage sessions** — require pool API backend
5. **PushPage** — requires VAPID keys for full functionality
6. **No automated visual regression testing** — manual viewport checks only
7. **No E2E tests** for the SPA (only unit tests)
8. **2xl desktop experience** — content max-w-7xl (1280px) leaves empty space on 1920px; no 2-column shell yet
9. **No xterm terminal embedding** (Hermes had it, mya dropped it)
10. **No chart library** — uses inline SVG for Sparkline/RadialGauge only

## Future Improvements (not implemented)

- Chart library (e.g. recharts) for richer analytics
- Real `/files/list` endpoint to replace FilesPage stub
- Real `/api/skills` endpoint to replace SkillsPage stub
- 2-column shell for `2xl:` viewports (1280px+) to use desktop space better
- Visual regression tests (Playwright)
- E2E tests for critical flows
- Breadcrumbs in PageHeader
- More themes (light mode, custom user themes)
- xterm terminal for PTY-based agent interaction
- Plugin system (was in Hermes, not in mya)
- Real-time collaboration (cursor presence, etc.)
