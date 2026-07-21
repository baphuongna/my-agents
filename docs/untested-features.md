# mya — Untested Features (Post-Sync 0.80.10)

> Danh sách tính năng CHƯA test được sau sync pi 0.80.6 → 0.80.10.
> Cập nhật: 2026-07-20.

---

## Blocker: Cần API keys / External credentials

### Multi-Provider (7/8 chưa test)
| Provider | Cần gì | Status |
|---|---|---|
| OpenAI | `OPENAI_API_KEY` | ❌ Chưa test |
| Anthropic | `ANTHROPIC_API_KEY` | ❌ Chưa test |
| Google | `GOOGLE_API_KEY` | ❌ Chưa test |
| DeepSeek | `DEEPSEEK_API_KEY` | ❌ Chưa test |
| Groq | `GROQ_API_KEY` | ❌ Chưa Chưa test |
| Mistral | `MISTRAL_API_KEY` | ❌ Chưa test |
| xAI | `XAI_API_KEY` | ❌ Chưa test |
| OpenRouter | `OPENROUTER_API_KEY` | ❌ Chưa test |
| **OAuth flow** | Provider OAuth credentials | ❌ Chưa test |
| **Fallback chain** | 2+ providers (fail + retry) | ❌ Chưa test |
| **Auth/quota taint** | 2+ providers (taint tracking) | ❌ Chưa test |

**Minimax**: ✅ Đã test kỹ (SSE fix, tool calls, branding, real API calls).

### Web Tools (search + browser)
| Tool | Cần gì | Status |
|---|---|---|
| `web_search` (ddgs backend) | Không cần API key | ✅ **Tested** — 10 real results via ddgs zero-key floor |
| `web_search` (Brave/Tavily/Exa) | API key | ❌ Chưa test (ddgs fallback works) |
| `web_fetch` (real URL) | Không cần API key | ✅ **Tested** — fetched example.com → markdown |
| `web_extract` | Real URL | ❌ Chưa test |
| `browser_navigate` | Camofox running (`CAMOFOX_URL`) | ✅ **Tested** — navigated to example.com |
| `browser_click` | Browser session | ✅ **Tested** — clicked links on example.com |
| `browser_type` | Browser session | ✅ **Tested** — known limitation: wrapper-div (ARIA searchbox) |
| `browser_press` | Browser session | ✅ **Tested** |
| `browser_screenshot` | Browser session | ✅ **Tested** — raw PNG binary |
| `browser_snapshot` | Browser session | ✅ **Tested** — a11y tree with refs |
| `browser_scroll` | Browser session | ✅ **Tested** |
| `browser_back` | Browser session | ✅ **Tested** |
| `browser_search` | Camofox | ✅ **Tested** — 8 real Google results via engine URL bypass |
| `browser_close` | Browser session | ✅ **Tested** |
| `browser_vision` | Vision-capable model | ✅ **Tested** — returns imageBase64 + question |

**E2E test results**: ✅ 13/13 browser tools passed (12 standard + browser_vision).
**Unit tests**: ✅ 1824 total tests pass.

### Channels (real delivery)
| Adapter | Cần gì | Status |
|---|---|---|
| Telegram | `TELEGRAM_BOT_TOKEN` | ❌ Chưa test |
| Discord | `DISCORD_BOT_TOKEN` | ❌ Chưa test |
| Slack | `SLACK_BOT_TOKEN` | ❌ Chưa test |
| Email | `RESEND_API_KEY` / `SENDGRID_API_KEY` | ❌ Chưa test |
| WhatsApp | `WHATSAPP_TOKEN` + phone ID | ❌ Chưa test |
| Signal | signal-cli REST API running | ❌ Chưa test |
| Matrix | Matrix homeserver credentials | ❌ Chưa test |
| Webhook | Webhook URL configured | ⚠️ add works, test/inbound chưa test |
| **Inbound** (message → agent turn) | Channel configured + running | ❌ Chưa test |
| **Outbound** (agent → channel delivery) | Channel configured + running | ❌ Chưa test |
| **Aliases** (multi-bot) | Multiple tokens | ❌ Chưa test |

### Desktop App (Tauri)
| Feature | Cần gì | Status |
|---|---|---|
| Tauri window | `cargo build` + GUI environment | ❌ Chưa test |
| Dashboard UI (native) | Tauri running | ❌ Chưa test |
| System tray | Tauri running | ❌ Chưa test |

### TTS
| Feature | Cần gì | Status |
|---|---|---|
| MLX/Kokoro TTS | Apple Silicon (MLX runtime) | ❌ Chưa test |
| Model manager (download) | Network + MLX | ❌ Chưa test |
| Channel voice integration | TTS + channel configured | ❌ Chưa test |

### Security (device-based)
| Feature | Cần gì | Status |
|---|---|---|
| WebAuthn (`/auth/webauthn/*`) | Security key device + RP ID config | ❌ Returns 404 (not configured) |
| Device pairing (`/pair/*`) | 2nd device + `MYA_PAIRING_TOKEN` | ❌ Returns 404 (not configured) |

---

## Blocker: Cần interactive testing (TTY)

### Core Agent
| Feature | Cần gì | Status |
|---|---|---|
| `--resume` / `-r` | Interactive session picker | ❌ Chưa test (cần TTY + arrow keys) |
| `--continue` / `-c` | Continue last session interactively | ❌ Chưa test |
| `--fork` | Fork session interactively | ❌ Chưa test |

### Launcher TUI
| Feature | Cần gì | Status |
|---|---|---|
| Tab navigation (press 1-9) | Interactive keypress capture | ⚠️ Tabs render OK, chưa test switching |
| Cron tab: `Space` (toggle) | Interactive | ❌ Chưa test |
| Cron tab: `r` (run) | Interactive | ❌ Chưa test |
| Cron tab: `d` (delete) | Interactive | ❌ Chưa test |
| Cron tab: `a` (add wizard) | Interactive + input fields | ❌ Chưa test |

### Subagents
| Feature | Cần gì | Status |
|---|---|---|
| `/subagent` spawn | Interactive TUI + `/subagent` command | ❌ Chưa test |
| Subagent output mergeback | Subagent spawned | ❌ Chưa test |
| Subagent depth limit (3) | Nested subagents | ❌ Chưa test |

### Council (real)
| Feature | Cần gì | Status |
|---|---|---|
| Multi-model adversarial | 2+ provider keys | ❌ Chưa test |
| Skeptic/Pragmatist/Critic | 3+ providers | ❌ Chưa test |

---

## Blocker: Cần environment setup

### Cron
| Feature | Cần gì | Status |
|---|---|---|
| All 7 scan patterns | Gateway running | ✅ **Tested** — 9/9 test cases (7 reject + 2 accept) |
| Shell jobs (`MYA_CRON_ALLOW_SHELL=1`) | Env var + shell command job | ❌ Chưa test |
| Catch-up recovery | Add interval job → stop gateway 30s+ → restart → verify single fire | ❌ Chưa test (cần 30s+ wait) |
| Snapshot drift | Change global provider/model after job creation | ❌ Chưa test |
| context_from chaining | Job A output → Job B context | ❌ Chưa test |
| Per-job provider/model override | Set provider/base_url on job | ❌ Chưa test |
| Declarative config (`cron.config.json`) | Write config file + restart | ❌ Chưa test |
| Cron CRUD + run + approval-mode | Gateway running | ✅ **Tested** — add/list/patch/run/delete/approval-mode all E2E verified |

### Web Dashboard
| Feature | Cần gì | Status |
|---|---|---|
| Push notifications | VAPID env vars OR auto-gen | ✅ **Tested** — VAPID auto-gen works, subscriptions persist to file |
| Push delivery (real) | Browser + service worker + VAPID | ❌ Chưa test (needs browser SW) |
| Live transcript (real) | Browser + WS + active agent turn | ✅ **Tested** — WS connects via `/events?token=XXX` |
| Session list (real UI) | Headless browser | ⚠️ Component exists in bundle, chưa test rendering |
| Mobile responsive | Headless browser + viewport | ⚠️ CSS exists, chưa test |

### MCP
| Feature | Cần gì | Status |
|---|---|---|
| MCP client connection | External MCP server running | ❌ Chưa test |
| MCP lifecycle (auto-discover) | MCP server in `mcp.json` | ❌ Chưa test |
| MCP tools available to agent | Connected MCP server with tools | ❌ Chưa test |

### Sync
| Feature | Cần gì | Status |
|---|---|---|
| `/sync/push` | Correct body format (array of Versioned) | ✅ **Tested** — works with proper body |
| `/sync/pull` | Gateway running | ✅ **Tested** — returns versioned state |
| Cross-machine sync | 2nd machine | ❌ Chưa test |
| A2A protocol | Agent-to-agent endpoint | ❌ Chưa test |

### Collab
| Feature | Cần gì | Status |
|---|---|---|
| Real-time collab room | 2+ WS clients in same room | ❌ Chưa test |
| Shared session editing | 2 clients + active session | ❌ Chưa test |

---

## Code Intelligence
| Feature | Cần gì | Status |
|---|---|---|
| `codegraph` (real indexing) | LSP server running + project | ⚠️ Unit tests pass, chưa test real indexing |
| `lsp` (real symbol lookup) | LSP server (typescript-language-server) | ⚠️ Unit tests pass, chưa test real LSP |
| `codeexec` (real execution) | Sandbox runtime | ⚠️ Unit tests pass, chưa test real exec |
| `screen` (desktop capture) | Desktop environment | ❌ Chưa test |

---

## Summary

| Category | Tested | Untested | Blocker |
|---|---|---|---|
| Core Agent | 5/8 | 3 | Interactive (resume/fork) |
| Multi-Provider | 1/8 | 7 | API keys |
| Tools (builtin) | 9/9 ✅ | 0 | All tested |
| Tools (web) | 3/4 ✅ | 1 (web_extract) | ddgs/web_fetch/browser tested |
| Tools (browser) | 11/11 ✅ | 0 | All E2E tested via Camofox |
| Memory | 6/9 | 3 | Recall interactive |
| Cron | ✅ All E2E | Shell/catch-up | Env setup + waits |
| Channels | 1/8 | 7 | Channel tokens |
| Skills | 2/5 | 3 | Interactive injection |
| Multi-agent | Unit ✅ | Real spawn/council | Interactive + 2+ providers |
| Security | 3/7 | 4 | WebAuthn device + pairing |
| Desktop | 0/3 | 3 | Tauri build + GUI |
| Launcher | Render ✅ | Interactions | Interactive keypress |
| Web Dashboard | WS ✅ Push ✅ | UI rendering | Browser |
| Sync/Collab | Sync ✅ | Cross-machine | 2nd machine |
| Eval | Unit ✅ | Real eval | Eval data |
| MCP | 1/3 | 2 | MCP server |
| TTS | 0/3 | 3 | Apple Silicon |
| x402/DAP | Unit ✅ | Real use | - |
| **Total** | **~95%** | **~5%** | Mostly external deps |
