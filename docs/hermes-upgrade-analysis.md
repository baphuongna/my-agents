# Hermes Agent — Phân tích nâng cấp mới (477c08b44 → 163fab8d0)

**364 commits** từ 2026-07-21 → 2026-07-22. Đây là bản phân tích chọn lọc 
các tính năng thú vị nhất, ranked theo độ liên quan đến mya.

---

## 🔥 Top 5 Nâng Cấp Quan Trọng Nhất (cho mya)

### 1. Idle-Triggered Context Compaction ⭐⭐⭐⭐⭐
**Files:** `agent/turn_context.py`, `agent/agent_init.py`, `agent/conversation_compression.py`

```python
# config.yaml
compression:
  idle_compact_after_seconds: 1800  # 30 phút idle → tự compact
```

**Vấn đề nó giải quyết:** Các session dài (Telegram/Slack thread kéo dài giờ/ngày) 
tích tụ context lớn. Cho đến nay chỉ có threshold dựa trên % context window. 
Giờ thêm **threshold dựa trên thời gian**: khi resume session sau N giây inactivity, 
compact ngay upfront thay vì re-read toàn bộ history mỗi turn.

**Logic** (`_should_idle_compact`):
- Opt-in (`idle_after_seconds <= 0` = disabled)
- Orthogonal với token-threshold (không yêu cầu vượt `threshold_tokens`)
- Skip khi context ≤ `floor_tokens` (size compaction sẽ giảm đến — tiết kiệm công vô ích)
- Defer khi đang trong compression-failure cooldown
- **Pure predicate** → unit-testable không cần live agent

**Relevance cho mya:** Rất cao. Cron/gateway sessions của mya là long-lived. 
Idle compaction sẽ giảm token waste đáng kể.

---

### 2. Absolute Token Threshold + Per-Model Overrides ⭐⭐⭐⭐⭐
**Config mới:**
```yaml
compression:
  threshold_tokens: 50000          # absolute cap (bên cạnh % threshold)
  max_attempts: 3                   # retry cap cho mỗi turn
  per_model_overrides:
    "gpt-4o": { threshold_percent: 0.8 }
    "claude-sonnet": { threshold_percent: 0.7 }
```

**Vấn đề:** 
- % threshold không đủ — đôi khi cần absolute "compact sau 50K tokens bất kể context window"
- Model khác nhau có context window khác nhau → cần threshold riêng

**Relevance cho mya:** Cao. mya dùng multi-provider với context window rất khác nhau 
(MiniMax 200K vs Claude 200K vs GPT-4o 128K).

---

### 3. Secrets Management System (Bitwarden + 1Password + Command) ⭐⭐⭐⭐
**Files:** `agent/secret_sources/` (registry.py, base.py, bitwarden.py, onepassword.py, _cache.py)

```yaml
# config.yaml
secrets:
  provider: bitwarden  # hoặc onepassword, command
  sources:
    - type: bitwarden
    - type: command
      name: vault
      command: ["./get-secret.sh", "{key}"]
```

**Tính năng:**
- **Unified registry**: đăng ký secret sources qua plugin system
- **Precedence**: mapped > bulk; first-claim-wins (không silent clobber)
- **Encrypted stale cache fallback**: khi Bitwarden API fail, dùng cache cũ
- **`${env:VAR}` SecretRef resolution** trong config.yaml
- **Token rotation** một lệnh
- **Command source**: chạy arbitrary command để fetch secret (HashiCorp Vault, AWS Secrets Manager, etc.)

**Relevance cho mya:** Trung bình. mya hiện dùng `auth.json` + `gateway.env`. 
Nhưng nếu muốn tích hợp enterprise secret managers thì đây là pattern tốt.

---

### 4. TUI Widget Grid SDK + Theme System ⭐⭐⭐⭐
**Files:** `ui-tui/src/sdk/` (registry.ts, host.tsx, types.ts), `ui-tui/src/lib/widgetGrid.ts`

**Widget SDK:**
- **2-axis grid layout engine** với overlay primitives
- **Widget app registry** — apps tự đăng ký qua slash command
- **Self-authored widgets** — user-widget loader, hot-load từ file
- **Ambient widget mode** — dock widgets in-flow trong TUI
- **Widget primitives**: charts, accordion, shimmer loaders, stable streams
- **Crash boundary** — widget crash không kill TUI
- **Reference apps**: weather, ticker, clock

**Theme/Skin System:**
- `hermes skin set <key> <hex>` — tweak ONE color in-place
- Agent-authored skins (agent tạo skin file, gateway watcher repaint live)
- Background-aware adaptation (OSC 10/11 polling)
- Cross-surface: CLI + TUI + Desktop cùng dùng một skin

**Relevance cho mya:** Cao cho TUI. mya TUI hiện dùng pi's ink renderer. 
Widget grid SDK là pattern rất hay nếu muốn thêm dashboard panels.

---

### 5. Schema v23: External-Content FTS + CJK Bigram ⭐⭐⭐⭐
**Files:** `agent/` (SessionDB changes)

**Tính năng:**
- **External-content FTS5** — FTS index tách biệt khỏi main table → 
  search nhanh hơn, không phải duplicate toàn bộ content
- **Tool-row-free trigram index** — không index tool call rows → giảm index size
- **CJK unicode61 tokenizer** — native FTS5 extension với bigram cho Chinese/Japanese/Korean
- **Slow-query log** cho session search với routing-path attribution
- **REINDEX auto-repair** — phát hiện + sửa stale B-tree index corruption
- **FTS corruption self-heal** — self-heal trên read path

**Relevance cho mya:** Rất cao. mya memory/session search dùng SQLite. 
CJK bigram + external-content FTS sẽ cải thiện recall cho Vietnamese/Chinese text đáng kể.

---

## 📋 Các Nâng Cấp Khác (Theo Khu Vực)

### MCP Reliability (23 commits)
- **Transport classification** cycle-safe (unwrap exception groups)
- **Park permanent failures** immediately (#65673)
- **Reconnect budget**: charge immediate reconnects against rapid-drop budget
- **Isolate single failing stdio server** from bridge (#50394)
- **Nested interruption detection** hardened
- **Reconnect on message-less closed transports**
- **Revision-aware reload.mcp** — ack = revision was loaded
- **Background discovery retry** after connecting nothing

### Gateway Hardening (40 commits)
- **Stale lock detection** (TTL + PID liveness) — atomic tombstone rename
- **Orphan child reap** on POSIX
- **Platform-lock token takeover** (once)
- **Honest durable ack semantics** for undeliverable async completions
- **Hard-exit on KeyboardInterrupt** path
- **Stale gateway_state.json** detection

### Slack Integration (28 commits)
- **Block Kit buttons** for native interactive multi-choice clarifies
- **Thread context rehydration** after gateway restart
- **Socket Mode ping/pong staleness** healing
- **Mention routing** from mentioned thread parents
- **Wake on human replies** in bot-authored threads
- **Rich text sanitization** at API boundary

### Kanban (4 commits)
- `hermes kanban repair` CLI verb
- Periodic WAL checkpoint (TRUNCATE) on dispatcher tick
- Auto-repair index-only kanban.db corruption via REINDEX
- Cap corrupt-backup retention at 10 files

### Desktop SSH (35 commits)
- SSH transport primitives + isolated SSH bootstrap
- Windows remote backend runtime
- Native OAuth (RFC 8252, PKCE, system browser, no webview)
- Billing page revamp + native in-app downgrade

### OpenViking (6 commits)
- Session context alignment with shared profile contract
- Memory context injection at session start
- Orphan session recovery + chunked structured sync

### Subagent Improvements
- **`execute_code` for subagents** (#69325) — subagents giờ chạy được code
- **Per-model threshold overrides** — subagent có thể dùng threshold riêng

### Compression Edge Cases (rest of 72 commits)
- **Strict redaction** at every compaction text boundary
- **Preserve latest actionable user turn** — không mất câu hỏi cuối
- **Preserve zero-user provenance** — synthetic user provenance
- **CJK token budgeting** with ASCII fast path
- **Compaction handoff dedup/supersede**
- **Decay protected summaries after restart**
- **Codex context window validation** + credential-scoped cache

### Memory
- **skip_memory + memory toolset**: tạo built-in memory store dù skip_memory=True nếu toolset enabled
- **Holographic memory**: không harvest compaction summaries; honor auto_extract=false

### DDGS Worker Isolation
- DuckDuckGo search cô lập trong disposable process (tránh GIL hold)

### Web UI
- **Content-hash freshness check** thay vì mtime
- **Exclusive flock** cho concurrent web-UI builds
- **SPA fallback**: attempt one recovery build when --skip-build finds no dist

---

## 🎯 Đề Xuất Áp Dụng Cho mya

### Ưu tiên cao (nên port):
1. **Idle compaction** → thêm `idle_compact_after_seconds` vào mya's context engine
2. **Absolute threshold_tokens** → thêm config option
3. **CJK FTS bigram** → áp dụng cho mya's SQLite session/memory search
4. **External-content FTS5** → refactor FTS schema
5. **MCP reconnect budget + park failures** → port vào mya's mcp-client.ts

### Ưu tiên trung bình (nice-to-have):
6. **Widget grid SDK** → tham khảo cho TUI dashboard
7. **REINDEX auto-repair** → SQLite resilience
8. **Stale lock detection** → gateway lock hardening
9. **Slack Block Kit clarify** → UX improvement cho channels

### Ưu tiên thấp (không phù hợp mya hiện tại):
10. Secrets management (mya dùng auth.json đơn giản hơn)
11. Desktop SSH (mya chưa có desktop app production)
12. Billing/subscription (không applicable)
13. OpenViking integration (không dùng)

---

## 📊 Thống Kê Code

| Area | Commits | New Files | Impact |
|------|---------|-----------|--------|
| Compression | 72 | ~15 | Massive |
| TUI/Theme | 61 | ~30 | Major |
| Gateway | 40 | ~10 | High |
| Desktop | 35 | ~40 | Major |
| Slack | 28 | ~5 | Medium |
| State/DB | 22 | ~8 | High |
| MCP | 23 | ~2 | High |
| Secrets | 19 | ~6 | Medium |
| Other | 64 | — | Mixed |
| **Total** | **364** | **~116** | |
