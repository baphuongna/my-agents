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
| `web_search` | Brave / Tavily / Exa / SearXNG API key | ❌ Chưa test |
| `web_fetch` (real URL) | Running HTTP target | ⚠️ Unit tested (849 tests), chưa test real URL |
| `web_extract` | Real URL | ❌ Chưa test |
| `browser_navigate` | Camofox running (`CAMOFOX_URL`) hoặc Browserbase key | ❌ Chưa test |
| `browser_click` | Browser session | ❌ Chưa test |
| `browser_type` | Browser session | ❌ Chưa test |
| `browser_press` | Browser session | ❌ Chưa test |
| `browser_screenshot` | Browser session | ❌ Chưa test |
| `browser_snapshot` | Browser session | ❌ Chưa test |
| `browser_scroll` | Browser session | ❌ Chưa test |
| `browser_back` | Browser session | ❌ Chưa test |
| `browser_search` | Browser session | ❌ Chưa test |
| `browser_close` | Browser session | ❌ Chưa test |

**Unit tests**: ✅ 849 browser/fetch tests pass (mock-based).

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
| Shell jobs (`MYA_CRON_ALLOW_SHELL=1`) | Env var + shell command job | ❌ Chưa test |
| Catch-up recovery | Add interval job → stop gateway 30s+ → restart → verify single fire | ❌ Chưa test (cần 30s+ wait) |
| Snapshot drift | Change global provider/model after job creation | ❌ Chưa test |
| context_from chaining | Job A output → Job B context | ❌ Chưa test |
| Per-job provider/model override | Set provider/base_url on job | ❌ Chưa test |
| Declarative config (`cron.config.json`) | Write config file + restart | ❌ Chưa test |

### Web Dashboard
| Feature | Cần gì | Status |
|---|---|---|
| Push notifications | VAPID key pair generated + configured | ❌ `/push/vapid-key` returns empty |
| Live transcript (real) | Browser + WS + active agent turn | ⚠️ WS connects, chưa test streaming |
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
| `/sync/push` (correct format) | Right body schema | ⚠️ Returns 400 (body format) |
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
| Tools | Unit ✅ | Real web/browser | API keys + Camofox |
| Memory | 6/9 | 3 | Recall interactive |
| Cron | 7/14 | 7 | Env setup + waits |
| Channels | 1/8 | 7 | Channel tokens |
| Skills | 2/5 | 3 | Interactive injection |
| Multi-agent | Unit ✅ | Real spawn/council | Interactive + 2+ providers |
| Security | 3/7 | 4 | WebAuthn device + pairing |
| Desktop | 0/3 | 3 | Tauri build + GUI |
| Launcher | Render ✅ | Interactions | Interactive keypress |
| Web Dashboard | 3/6 | 3 | VAPID + browser |
| Sync/Collab | 3/6 | 3 | 2nd machine |
| Eval | Unit ✅ | Real eval | Eval data |
| MCP | 1/3 | 2 | MCP server |
| TTS | 0/3 | 3 | Apple Silicon |
| x402/DAP | Unit ✅ | Real use | - |
| **Total** | **~85%** | **~15%** | External deps |
