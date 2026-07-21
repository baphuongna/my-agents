# mya Web UI — Gap Analysis & Build Plan

> Comparison: **mya web** (current) vs **Hermes web** (fresh pull `477c08b`).
> Date: 2026-07-21.

---

## 1. Scale Comparison

| Metric | mya web | Hermes web | Gap |
|---|---|---|---|
| **Source LOC** | 1,742 | 47,810 | **27×** |
| **Source files** | 14 | 130 | 9× |
| **Framework** | Vanilla JS (string template) | React 19 + Vite + Tailwind v4 | — |
| **Pages/routes** | 1 (single SPA) | 19 | 18 missing |
| **Components** | 4 (session-list, approval-modal, prompt-bar, mobile-nav) | 26 | 22 missing |
| **i18n languages** | 0 | 15 (af, de, en, es, fr, ga, hu, it, ja, ko, pt, ru, tr, uk, zh, zh-hant) | 15 |
| **Themes** | 1 (hardcoded CSS) | Multiple presets + custom CSS + font system | — |
| **Plugin system** | None | Full SDK + registry + 20+ slots | — |
| **Terminal embedding** | None | xterm.js (WebGL + Unicode11 + PTY over WS) | — |
| **Charts** | None | @observablehq/plot | — |
| **3D** | None | @react-three/fiber | — |
| **Component library** | None (raw HTML) | @nous-research/ui (Button, Card, Badge, Select, Tabs, Toast, etc.) | — |
| **Build system** | None (inline HTML) | Vite 8 + tsc | — |

---

## 2. Hermes Pages (what exists)

| Page | LOC | Description |
|---|---|---|
| **SessionsPage** | 1,814 | Session list, create, resume, fork, import/export |
| **ChatPage** | 1,538 | Embedded xterm terminal (PTY over WS), sidebar, session list |
| **SystemPage** | 1,540 | System health, memory status, diagnostics, console modal |
| **SkillsPage** | 1,634 | Skill list, create/edit/delete, skill editor dialog |
| **ChannelsPage** | 1,446 | Telegram/Discord/Slack/WhatsApp/Signal management |
| **ProfilesPage** | 1,425 | Provider profile management (multi-profile) |
| **ModelsPage** | 1,347 | Model picker, info cards, MoA config, reasoning effort |
| **CronPage** | 1,123 | Cron job CRUD, schedule builder, automation blueprints |
| **PluginsPage** | 1,113 | Plugin discovery, install, enable/disable |
| **EnvPage** | 1,114 | API key management (env vars, secrets) |
| **ProfileBuilderPage** | 833 | Visual profile creation wizard |
| **McpPage** | 902 | MCP server lifecycle, tool discovery, OAuth |
| **ConfigPage** | 679 | Runtime config editor |
| **WebhooksPage** | 613 | Webhook endpoints management |
| **AnalyticsPage** | 604 | Usage charts, cost tracking, plots |
| **FilesPage** | 525 | File browser with syntax highlighting |
| **PairingPage** | 276 | Device pairing (WebAuthn) |
| **LogsPage** | 246 | Log viewer with filtering |
| **DocsPage** | 69 | Embedded docs iframe |

---

## 3. mya Backend Endpoints (API surface — already exists!)

mya's gateway already has the backend APIs that a web UI needs:

| Endpoint | Status | Hermes equivalent |
|---|---|---|
| `GET /status` | ✅ | `/api/status` |
| `GET /sessions`, `GET /sessions/:id` | ✅ | `/api/sessions` |
| `GET /sessions/:id/events` (SSE) | ✅ | `/api/pty` (WS PTY) |
| `WS /events` | ✅ | `/api/ws` |
| `GET /cron/jobs`, `POST /cron/jobs` | ✅ | `/api/cron/*` |
| `POST /cron/jobs/:id/patch` | ✅ | — |
| `POST /cron/jobs/:id/run` | ✅ | — |
| `GET /sync/state`, `/sync/pull`, `POST /sync/push` | ✅ | — |
| `GET /collab/rooms` | ✅ | — |
| `GET /push/vapid-key`, `POST /push/subscribe` | ✅ | — |
| `GET /channels/:id/config` | ✅ | `/api/messaging/*` |
| `GET /mcp/*` | ✅ | `/api/mcp/*` |
| `GET /pool/sessions` | ✅ | — |
| `GET /config`, `GET /models`, `GET /tools` | ✅ | `/api/config`, `/api/model/*` |
| `GET /health/live`, `/ready` | ✅ | — |
| `POST /auth/webauthn/*` | ✅ | — |
| `POST /pair/request` | ✅ | — |

**Key insight:** mya has ~90% of the backend API surface. The gap is the **frontend** — there's no React app, no routing, no real pages. The current web UI is a vanilla-JS event viewer.

---

## 4. What mya's Current Web UI Actually Does

```
packages/web/src/
├── dashboard.ts          # Generates inline HTML string (CSS + JS embedded)
├── index.ts              # Re-exports
├── transport.ts          # WS client
├── components/
│   ├── session-list.ts   # Sidebar session list
│   ├── approval-modal.ts # Tool approval popup
│   ├── prompt-bar.ts     # Prompt input bar
└── ...
```

The dashboard is a **single HTML page** with:
- Header (title + status pills)
- Left: live event stream (tool calls, responses, errors)
- Right: session sidebar
- Bottom: prompt bar
- Mobile nav + PWA (service worker, push notifications)

**What it lacks vs Hermes:**
- ❌ No routing (can't navigate to /cron, /sessions, /models, etc.)
- ❌ No real pages (cron management, model picker, skill editor, etc.)
- ❌ No interactive forms (can't add/edit cron jobs from UI)
- ❌ No file browser
- ❌ No analytics/charts
- ❌ No embedded terminal (xterm)
- ❌ No plugin system
- ❌ No i18n
- ❌ No theming
- ❌ No markdown rendering
- ❌ No profile/provider management UI

---

## 5. Build Strategy

### Option A: Port Hermes Web (recommended for speed)

Fork Hermes web, adapt API client to mya endpoints, rebrand.

**Pros:** 47k LOC of tested UI, 19 pages, plugin system, i18n, theming — all ready.
**Cons:** Hermes uses Python backend (`/api/*`), mya uses Node gateway (different paths). API client needs rewriting. `@nous-research/ui` is private — need to swap for shadcn/ui or similar.

**Effort:** 2-3 days (API client rewrite + branding + component lib swap).

### Option B: Build Incrementally (recommended for control)

Add Vite + React to `packages/web`, build pages one-by-one against existing mya API.

**Phase 1 — Foundation (Day 1):**
- Add Vite + React + react-router + Tailwind to packages/web
- Build API client (`lib/api.ts`) mapping to mya gateway endpoints
- Build layout shell (sidebar + header + routing)
- Port existing dashboard features (event stream, session list)

**Phase 2 — Core Pages (Day 2):**
- Sessions page (list + create + view transcript)
- Cron page (CRUD + run + approval)
- Status/System page (health, memory, pool)
- Models page (provider list + config)

**Phase 3 — Advanced (Day 3+):**
- Skills page
- MCP page
- Channels page
- Analytics (charts)
- Settings/Config page

### Recommendation: **Option B** — mya's API surface is different enough from Hermes that a port would need significant API-client rewriting anyway. Build incrementally with shadcn/ui (open-source equivalent of @nous-research/ui).

---

## 6. Tech Stack (proposed)

| Layer | Choice | Why |
|---|---|---|
| Framework | React 19 | Industry standard, Hermes uses it, huge ecosystem |
| Build | Vite 8 | Fast HMR, Hermes uses it |
| Styling | Tailwind CSS v4 | Hermes uses it, utility-first, fast |
| Components | shadcn/ui | Open-source @nous-research/ui equivalent |
| Routing | react-router-dom v7 | Hermes uses it |
| Icons | lucide-react | Hermes uses it, clean |
| State | React Context + hooks | Hermes pattern, no Redux needed |
| Charts | recharts (or @observablehq/plot) | Analytics page |
| Markdown | react-markdown | Chat/docs rendering |
| Terminal | xterm.js (optional) | Embedded TUI |
| i18n | (defer) | Add when stable |

---

## 7. File Structure (proposed)

```
packages/web/
├── index.html              # Vite entry
├── vite.config.ts          # Vite + React + Tailwind
├── package.json            # Dependencies
├── tsconfig.json
├── src/
│   ├── main.tsx            # React root
│   ├── App.tsx             # Layout + routes
│   ├── index.css           # Tailwind imports
│   ├── lib/
│   │   ├── api.ts          # mya gateway API client
│   │   ├── ws.ts           # WebSocket event client
│   │   └── utils.ts        # cn(), formatTime(), etc.
│   ├── components/
│   │   ├── ui/             # shadcn/ui components
│   │   ├── Sidebar.tsx     # Navigation sidebar
│   │   ├── Header.tsx      # Top bar with status
│   │   ├── EventStream.tsx # Live event viewer
│   │   └── ...
│   ├── pages/
│   │   ├── SessionsPage.tsx
│   │   ├── CronPage.tsx
│   │   ├── StatusPage.tsx
│   │   ├── ModelsPage.tsx
│   │   ├── SkillsPage.tsx
│   │   ├── McpPage.tsx
│   │   ├── ChannelsPage.tsx
│   │   └── ...
│   └── hooks/
│       ├── useApi.ts       # Generic fetch hook
│       └── useWebSocket.ts # WS event subscription
├── public/
│   ├── manifest.json       # PWA manifest (keep)
│   ├── sw.js               # Service worker (keep)
│   └── icons/              # PWA icons (keep)
└── dist/                   # Built output (gateway serves this)
```

---

## 8. Gateway Integration

The gateway already supports serving from `staticDir` (dist/web/):
```ts
case "/":
case "/index.html": {
  if (this.staticDir) {
    const indexPath = join(this.staticDir, "index.html");
    if (existsSync(indexPath)) { /* serve static */ }
  }
  // fallback to rootHtml (inline dashboard)
}
```

Build flow:
```sh
cd packages/web && npm run build   # → dist/
# Gateway serves dist/ as staticDir
```

The gateway needs one change: serve static assets (JS/CSS/images) from dist/, not just index.html. Currently it only serves `/` and `/index.html` from staticDir — need to add a catch-all static handler for `/assets/*`.
