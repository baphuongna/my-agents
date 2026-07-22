---
name: pi-fork-sync
description: Sync mya fork với upstream pi-coding-agent mới. Quy trình đầy đủ: clone monorepo, sync source, re-apply patches, deep audit. Dùng khi pi có bản mới cần sync.
triggers:
  - sync pi
  - fork pi
  - upstream sync
  - pi version
  - đồng bộ pi
  - cập nhật pi
---

# pi-fork-sync

Sync mya fork với pi-coding-agent upstream. Pi là monorepo tại `github.com/earendil-works/pi.git`.

## Khi nào dùng

- Pi có bản mới (npm: `npm view @earendil-works/pi-agent-core version`)
- User yêu cầu sync/update pi
- Sau sync cần deep audit để verify không regression

## Kiến trúc fork

```
source/pi/                    ← GitHub monorepo (clone shallow)
packages/coding-agent/src/    ← Pi source + 15 mya patches (markers: "mya fork")
packages/pi-agent-src/src/    ← Pi agent-core (0 patches)
packages/pi-ai-src/src/       ← Pi AI (0 patches, +providers/data/*.json from npm)
packages/tui/src/             ← Pi TUI (0 patches)
dist/mya.js                   ← esbuild bundle (zero @earendil runtime refs)
```

## Phase 0: Chuẩn bị

```bash
# 1. Lưu patches hiện tại (SOURCE OF TRUTH)
grep -rn "mya fork" packages/coding-agent/src/ --include="*.ts" | grep -v "\.js:" > /tmp/existing-patches.txt
echo "Patches: $(wc -l < /tmp/existing-patches.txt)"

# 2. Clone/update monorepo
cd source/pi && git pull --rebase && cd ../..
# Hoặc: git clone --depth 1 https://github.com/earendil-works/pi.git source/pi

# 3. Extract generated data files (monorepo THIẦU — phải lấy từ npm)
NEW_VER=$(node -e "const p=require('./source/pi/packages/ai/package.json');console.log(p.version)")
npm pack @earendil-works/pi-ai@$NEW_VER
mkdir -p /tmp/pidata && tar xzf earendil-works-pi-ai-*.tgz -C /tmp/pidata
mkdir -p packages/pi-ai-src/src/providers/data
cp /tmp/pidata/package/dist/providers/data/*.json packages/pi-ai-src/src/providers/data/
echo "Data files: $(ls packages/pi-ai-src/src/providers/data/*.json | wc -l)"
```

> **CRITICAL (L9)**: Monorepo source không chứa `providers/data/*.json` (codegen output). Phải extract từ npm package. Không có → bundle fail `Could not resolve "./data/openai.json"`.

## Phase 1: Sync low-risk (tui, pi-agent-src, pi-ai-src)

```bash
# Map: source/pi/packages/{tui,agent,ai}/src/ → packages/{tui,pi-agent-src,pi-ai-src}/src/
for pair in "tui:tui" "agent:pi-agent-src" "ai:pi-ai-src"; do
  SRC="${pair%%:*}"; DST="${pair##*:}"
  rm -rf packages/$DST/src
  cp -r source/pi/packages/$SRC/src/ packages/$DST/src/
done

# Rename imports
find packages/tui/src packages/pi-agent-src/src packages/pi-ai-src/src -name "*.ts" -exec sed -i \
  's/@earendil-works\/coding-agent/@my-agent\/coding-agent/g;
   s/@earendil-works\/pi-agent-core/@my-agent\/pi-agent-core/g;
   s/@earendil-works\/pi-ai/@my-agent\/pi-ai/g;
   s/@earendil-works\/pi-tui/@my-agent\/tui/g' {} +

# Clean compiled artifacts
find packages/tui/src packages/pi-agent-src/src packages/pi-ai-src/src \
  \( -name "*.js" -o -name "*.d.ts" -o -name "*.map" \) -delete

# VERIFY: 0 @earendil (ngoài legitimate refs)
grep -r "@earendil" packages/{tui,pi-agent-src,pi-ai-src}/src/ --include="*.ts" | wc -l
# → MUST be 0
```

## Phase 2: Sync coding-agent (CẨN THẬN)

```bash
# Backup mya-only file
cp packages/coding-agent/src/core/subagent.ts /tmp/subagent.ts.bak

# Overwrite
rm -rf packages/coding-agent/src
cp -r source/pi/packages/coding-agent/src/ packages/coding-agent/src/

# Restore mya-only
cp /tmp/subagent.ts.bak packages/coding-agent/src/core/subagent.ts

# Rename + clean
find packages/coding-agent/src -name "*.ts" -exec sed -i \
  's/@earendil-works\/coding-agent/@my-agent\/coding-agent/g;
   s/@earendil-works\/pi-agent-core/@my-agent\/pi-agent-core/g;
   s/@earendil-works\/pi-ai/@my-agent\/pi-ai/g;
   s/@earendil-works\/pi-tui/@my-agent\/tui/g' {} +
find packages/coding-agent/src \( -name "*.js" -o -name "*.d.ts" -o -name "*.map" \) -delete
```

> **Legitimate @earendil refs (KHÔNG rename)**: ~9 refs giữ nguyên trong coding-agent:
> PACKAGE_NAME, extension loader keys, OFFICIAL_PACKAGE_NAME, Symbol.for keys, doc comments.

## Phase 3: Re-apply 10 patches

Dùng `/tmp/existing-patches.txt` + đọc code mới. Mỗi patch: hỏi "upstream added equivalent? → obsolete. Refactored? → adapt. Unchanged? → re-apply."

| # | Patch | File | Lưu ý 0.81.1 |
|---|---|---|---|
| 1 | Branding hint + CLI fallback | `main.ts` | Upstream thêm builtInExtensions merge — extensionFactories vẫn appended |
| 2 | MYA_SKILL_SOURCE | `resource-loader.ts` | Thêm env gate trong `updateSkillsFromPaths` |
| 3 | subagentCount | `footer-data-provider.ts` | Field + getter/setter |
| 4 | systemPrompt accessors | `settings-manager.ts` | 4 methods + interface fields |
| 5 | compactDescription + elide location | `skills.ts` | Upstream thêm `<location>` tag — remove nó |
| 6 | setRuntimeApiKey shim | `model-registry.ts` | Delegate to runtime |
| 7 | APP_NAME branding | `system-prompt.ts` | **REMOVED 0.81.1** — upstream dùng `${APP_NAME}` |
| 8 | extensionFactories + re-export | `sdk.ts` | **NEW 0.81.1**: option + DefaultResourceLoader ctor |
| 9 | auth-storage shims | `auth-storage.ts` | runtimeOverrides + 10 methods |
| 10 | executeRegisteredTool | `agent-session.ts` | **NEW 0.81.1**: codeexec dispatch API |

**Verify**: `grep -rn "mya fork" packages/coding-agent/src/ --include="*.ts" | wc -l` ≥ số trước sync.

## Phase 4: Bundle + Test

```bash
npm run bundle                                    # → must succeed
grep -c "@earendil" dist/mya.js                   # → 5 legit refs only
npx vitest run --pool forks 2>&1 | grep "Tests "  # → 1824 passed
```

## Phase 5: Deep audit (~300 checks)

Đừng chỉ chạy unit tests. Test THẬT end-to-end:

### Gateway (86 routes)
Start gateway → curl MỖI endpoint → check non-500:
```bash
setsid node dist/mya.js serve --port 3999 </dev/null >/tmp/gw.log 2>&1 & disown
sleep 6
TOK=$(curl -s http://127.0.0.1:3999/ -D /dev/stderr -o /dev/null 2>&1 | grep -oP 'mya_ws=\K[^;]+)
# Test: /health/live /ready /sessions /cron/jobs /pool/acquire /mcp/servers /memory/stats ...
```

### MCP servers
```bash
# Pre-start at boot, connect, discover tools
for sid in jina-ai firecrawl zai-mcp; do
  curl -X POST http://127.0.0.1:3999/mcp/servers/$sid/connect -H "Cookie: mya_ws=$TOK"
  curl -X POST http://127.0.0.1:3999/mcp/servers/$sid/discover -H "Cookie: mya_ws=$TOK"
done
# Verify LLM sees mcp_ tools via WebSocket prompt
```

### Browser/Camofox
LLM → browser_navigate → example.com → snapshot → verify title.

### Security
- No token → 401 ✓
- Cross-origin POST → 403 ✓
- `javascript:` webhook URL → 400 ✓
- Path traversal skill name → rejected ✓

## Critical gotchas (đã tốn nhiều giờ debug)

### MCP (5 bugs nghiêm trọng)

| Bug | Symptom | Fix |
|---|---|---|
| **Framing sai** (L10) | ALL servers timeout 10s | newline JSON `{json}\n`, KHÔNG Content-Length |
| **register() ghi đè** (L11) | Tools biến mất sau session create | `if (existing) return;` idempotent |
| **Async registration** (L12) | LLM không thấy mcp_ tools | Pre-start at boot + sync register |
| **callTool no catch** | Empty tool results | try/catch → isError:true |
| **HTTP Accept header** (L13) | web-search-prime → 400 | `Accept: application/json, text/event-stream` |

### Khác

| Bug | Fix |
|---|---|
| Data files missing (L9) | Extract providers/data/*.json từ npm |
| SPA fallback 401 | Allowlist GET+text/html + catch-all index.html |
| Memory split-brain | `memoryStats()` dùng SQLite counts, không Brain |
| Code tool not registered | Register simplified `code` tool in mya-bridge |
| EPIPE spam | Suppress in uncaughtException handler |
| VAPID ephemeral | Persist keys to `~/.mya/agent/vapid-keys.json` |

## Pre-existing TS errors (KHÔNG fix)

- `packages/coding-agent/` — rootDir/composite conflicts (pi code)
- `packages/print/` — `@my-agent/acp`/`@my-agent/rpc` type resolution, .ts imports
- `packages/pi-agent-src/` — TS5097 .ts imports

esbuild (bundle) không type-check → bundle vẫn succeeds. Chỉ fix errors trong MYA packages (core/agent/tools/gateway/cron/memory).

## Test environment facts

- **MiniMax-M3** API key configured (`~/.mya/agent/auth.json` + `gateway.env`)
- **Camofox** chạy port 9377 (`~/camofox-browser/server.js`)
- **Vitest pool**: `forks` (KHÔNG `threads` — SQLite native addon breaks)
- **Background gateway**: `setsid node dist/mya.js serve --port 3999 </dev/null >/tmp/gw.log 2>&1 & disown`
- **WS token**: qua query param `?token=`, KHÔNG qua header
- **curl auth**: `-H "Cookie: mya_ws=$TOK"`, KHÔNG newline-separated headers (dùng riêng `-H`)

## Version history

| Version | Sync từ | Commit | Ghi chú |
|---|---|---|---|
| 0.80.6 | initial | `573b4c1` | Migrate to TS source |
| 0.80.10 | 0.80.6 | `238558e` | 585 files, 4 patches obsolete |
| **0.81.1** | 0.80.10 | `f0eaf2e` | 631 files, monorepo source, 15 bugs fixed |
