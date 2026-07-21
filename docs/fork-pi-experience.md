# Fork pi → mya: Kinh nghiệm & Quy trình chính xác

> **Mục đích**: Document hóa toàn bộ kinh nghiệm fork pi-coding-agent (`@earendil-works/*`)
> thành mya, bao gồm chiến lược, sai lầm gặp phải, bài học, và quy trình sync
> upstream chính xác nhất.
>
> **Pi version hiện tại**: 0.80.10 (synced từ 0.80.6).
> **Cập nhật cuối**: 2026-07-20 — commit `dc33923`.

---

## Mục lục

1. [Tóm tắt dự án](#1-tóm-tắt-dự-án)
2. [Chiến lược fork](#2-chiến-lược-fork)
3. [Bài học quan trọng (LESSONS LEARNED)](#3-bài-học-quan-trọng-lessons-learned)
4. [Cấu trúc fork hiện tại](#4-cấu-trúc-fork-hiện-tại)
5. [Quy trình sync upstream CHÍNH XÁC](#5-quy-trình-sync-upstream-chính-xác)
6. [Checklist sync (copy-paste)](#6-checklist-sync-copy-paste)
7. [Pitfalls & Gotchas](#7-pitfalls--gotchas)
8. [Kiểm thử (Testing Strategy)](#8-kiểm-thử-testing-strategy)
9. [Lịch sử version](#9-lịch-sử-version)

---

## 1. Tóm tắt dự án

mya là fork của **pi-coding-agent** (`@earendil-works/*`) — một AI coding agent
harness viết bằng TypeScript. mya thêm:

- **Branding**: pi → mya (APP_NAME, config dir `.mya`, CLI name)
- **Cron system**: full-featured (22 commits hardening)
- **Memory system**: SQLite FTS5 + Weibull decay + embeddings
- **Channels**: multi-platform delivery (Telegram/Discord/Slack/Email/WhatsApp/Signal)
- **Skills**: MYA_SKILL_SOURCE gate + compactDescription
- **Roles system**: role-based agent configuration
- **Subagent footer**: subagentCount display
- **Slim-prompt**: systemPrompt override support
- **Key rotation**: x-mya-rotated-key → RuntimeCredentials.setRuntimeApiKey

**Stack**: TypeScript 7 / Rust-stable via napi-rs / Node ≥20 ESM.

---

## 2. Chiến lược fork

### Nguyên tắc cốt lõi: **SOURCE-first, own the source**

```
       ┌─────────────────────────────────────────┐
       │  npm: @earendil-works/* (0.80.10)       │
       │  ── TS source (extracted)               │
       └────────────────┬────────────────────────┘
                        │ copy + rename imports
                        ▼
       ┌─────────────────────────────────────────┐
       │  mya packages/ (owned TS source)        │
       │  ── @my-agent/* (all imports renamed)   │
       │  ── 8 patches re-applied with markers   │
       └────────────────┬────────────────────────┘
                        │ esbuild bundle
                        ▼
       ┌─────────────────────────────────────────┐
       │  dist/mya.js (single-file bundle)       │
       │  ── Zero @earendil references           │
       │  ── 100% from owned TS source           │
       └─────────────────────────────────────────┘
```

**Tại sao source-first thay vì fork git?**
1. **Không phụ thuộc npm runtime** — bundle từ source, `npm install` không cần thiết ở production
2. **Kiểm soát toàn bộ** — có thể sửa bất kỳ file nào
3. **Pi không phải monorepo public** — chỉ publish compiled `.js` trên npm, TS source phải extract
4. **Reproducible builds** — `npm run bundle` tạo cùng output mỗi lần

### Tầng kiến trúc

| Tầng | Vị trí | Nguồn | Vai trò |
|---|---|---|---|
| **Tầng 1: TS Source** | `packages/coding-agent/src/` | Extracted từ pi npm | Bundle trực tiếp (owned) |
| **Tầng 2: TS Source** | `packages/pi-agent-src/`, `pi-ai-src/`, `tui/` | Extracted từ pi npm | Bundle trực tiếp (owned) |
| **Tầng 3: Vendored JS** | `vendored/pi-ai/` | pi compiled `.js` | Provider loading runtime + types |
| **Tầng 4: Vendored deps** | `vendored/{openai,sdk,...}/` | 18 npm packages | Bundled dependencies |

### PiConfig — cơ chế branding chính thức

Upstream 0.80.10 thêm `pkg.piConfig` support — **cách chính thức để fork**:

```json
// package.json
{
  "piConfig": {
    "name": "mya",        // → APP_NAME, binary name, help text
    "configDir": ".mya"   // → ~/.mya/ instead of ~/.pi/
  }
}
```

Điều này **thay thế** patch #3 cũ (hardcode `APP_NAME="mya"` trong `config.ts`).
Pi tự đọc `piConfig` từ package.json → động branding.

> **Bài học**: Khi upstream thêm cơ chế chính thức cho thứ ta đang patch, **xóa
> patch cũ và dùng cơ chế upstream**. Giảm maintenance burden.

---

## 3. Bài học quan trọng (LESSONS LEARNED)

### L1: Doc patches KHÔNG ĐỦ — phải có marker trong code

**Sai lầm**: Ban đầu doc ghi "5 file sửa", thực tế có **10 file**.
**Hậu quả**: Sync đầu tiên suýt mất 5 patch vì chỉ re-apply theo doc.

**Giải pháp**: Mọi patch đều có marker `// mya fork:` trong code.
```typescript
// mya fork: expose RuntimeCredentials.setRuntimeApiKey to extensions
setRuntimeApiKey(providerId: string, apiKey: string): Promise<void> { ... }
```

**Quy tắc**: `grep -rn "mya fork" packages/coding-agent/src/` = source of truth,
không phải doc. **Luôn grep TRƯỚC khi sync.**

---

### L2: Upstream refactor có thể VÔ HIỆU hóa patch

Trong sync 0.80.6 → 0.80.10:
- `model-registry.ts` (1020 dòng) → tách thành 7 file mới (126 dòng).
- Patch `supportsToolSearch` / `supportsToolReferences` → **di chuyển** sang `provider-composer.ts`.
- Patch `setRuntimeApiKey` → upstream thêm `RuntimeCredentials.setRuntimeApiKey()` chính thức!

**Giải pháp**: Đối với mỗi patch, hỏi:
1. **Upstream đã thêm tính năng tương tự?** → Xóa patch, dùng upstream.
2. **Upstream refactor file?** → Tìm lại patch trong file mới.
3. **Upstream không đổi?** → Re-apply y nguyên.

| Patch cũ (0.80.6) | Trạng thái 0.80.10 | Hành động |
|---|---|---|
| `config.ts`: hardcode APP_NAME | **Obsolete** — upstream thêm `piConfig` | ✅ Xóa, dùng `package.json` piConfig |
| `model-registry.ts`: setRuntimeApiKey | **Obsolete** — upstream thêm RuntimeCredentials | ✅ Xóa, dùng upstream + shim |
| `sdk.ts`: x-mya-rotated-key | **Obsolete** — upstream thêm RuntimeCredentials | ✅ Thay bằng `setRuntimeApiKey()` |
| `skills.ts`: compactDescription | **Still needed** — upstream không có | ✅ Re-apply |
| `settings-manager.ts`: systemPrompt | **Still needed** — upstream không có | ✅ Re-apply |
| `footer-data-provider.ts`: subagentCount | **Still needed** | ✅ Re-apply |
| `resource-loader.ts`: MYA_SKILL_SOURCE | **Still needed** | ✅ Re-apply |
| `main.ts`: extension hint | **Still needed** | ✅ Re-apply |
| `system-prompt.ts`: APP_NAME dynamic | **Still needed** — upstream hardcode "pi" | ✅ Re-apply |

---

### L3: Backward-compat shims CẦN THIẾT khi upstream breaking change

`auth-storage.ts` 0.80.10 thay đổi API (sync → async, method rename).
Test files cũ và internal callers dùng API cũ → break.

**Giải pháp**: Thêm **10 backward-compat shims** với `runtimeOverrides` Map:
```typescript
// mya fork: backward-compat shims for pre-0.80.10 test/internal callers
async getApiKey(provider: string): Promise<string | undefined> {
  const override = this.runtimeOverrides.get(provider);  // ← shim
  if (override) return override;
  return this.runtime.getApiKey(provider);  // ← upstream API
}
```

**Quy tắc**: Khi upstream breaking change, **luôn thêm shim layer** để existing
code không break. Đánh dấu `// mya fork: backward-compat`.

---

### L4: Cold-verify là review quan trọng nhất

Trong 3-round review discipline (code review → security review → cold-verify):
- **Code review** tìm bugs trong logic mới.
- **Security review** tìm vulnerabilities.
- **Cold-verify** (độc lập, không tin analysis trước) tìm **confirmation bias**.

Cold-verify phát hiện:
1. Doc ghi 5 patch, thực tế 10 patch
2. `browser_type` không phải bug code — là Camofox/Playwright limitation
3. `contain()` không handle undefined ctx
4. `codeexec` package phantom (không tồn tại, không reference)

> **Quy tắc**: Luôn có cold-verify round cuối cùng, verify facts độc lập.

---

### L5: Test E2E thông qua TUI/CLI thật, không chỉ unit test

Unit test pass ≠ feature works. Nhiều bug chỉ phát hiện khi test end-to-end:

| Bug | Unit test | E2E test |
|---|---|---|
| SSE tool_call delta continuation | ✅ Pass | ❌ Minimax stream broken |
| Cron PATCH vs POST | ✅ Pass | ❌ Real endpoint dùng POST |
| VAPID private key format (PEM vs base64url) | ✅ Pass | ❌ Push subscribe fails |
| CSRF Origin check | ✅ Pass | ⚠️ Curl bypasses (no Origin) |
| WS token via query param | ✅ Pass | ❌ Header-based fails |

**Giải pháp**: Test mỗi feature bằng:
1. Start gateway thật (`mya serve --port 3999`)
2. Gọi endpoint bằng curl/node fetch
3. Verify response + side effects (file written, DB updated)

---

### L6: Invariant #10 — dùng `nowWallclock()` thay vì `Date.now()`

Codebase có invariant: **tất cả wallclock timestamps phải dùng `nowWallclock()`**
(injectable cho tests), không `Date.now()` trực tiếp.

Sync đầu tiên copy code upstream dùng `Date.now()` → 34 violations trong 14 file.

**Giải pháp**: Replace tất cả `Date.now()` → `nowWallclock()` trong MYA source:
```bash
grep -rn "Date\.now()" packages/{memory,tools,print,gateway}/src/ --include="*.ts"
# → Replace each with nowWallclock()
```

**Ngoại lệ**: `Date.now()` trong comment, hoặc `packages/coding-agent/src/` (pi
code — không sửa ngoài patch).

---

### L7: Xóa compiled artifacts khi sync

Upstream npm package chứa cả `.js` + `.d.ts` + `.map` (compiled từ TS).
Khi copy vào `packages/*/src/`, **xóa tất cả compiled artifacts**:

```bash
find packages/coding-agent/src -name "*.js" -o -name "*.d.ts" -o -name "*.map" | xargs rm
find packages/pi-agent-src/src -name "*.js" -o -name "*.d.ts" -o -name "*.map" | xargs rm
find packages/pi-ai-src/src -name "*.js" -o -name "*.d.ts" -o -name "*.map" | xargs rm
find packages/tui/src -name "*.js" -o -name "*.d.ts" -o -name "*.map" | xargs rm
```

Sync 0.80.6 → 0.80.10 xóa **462 file** compiled artifacts.

**Lý do**: esbuild bundle từ `.ts` source. Nếu có cả `.js`, có thể resolve sai,
hoặc stale `.js` override `.ts` mới.

---

### L8: Import rename bằng sed, nhưng VERIFY sau

```bash
# Rename all imports
find packages/ -name "*.ts" -exec sed -i \
  's/@earendil-works\/coding-agent/@my-agent\/coding-agent/g; \
   s/@earendil-works\/pi-agent-core/@my-agent\/pi-agent-core/g; \
   s/@earendil-works\/pi-ai/@my-agent\/pi-ai/g; \
   s/@earendil-works\/pi-tui/@my-agent\/tui/g' {} +

# VERIFY: zero @earendil remaining
grep -r "@earendil" packages/ --include="*.ts" | wc -l   # → MUST be 0
```

**Gotcha**: `pi-tui` → `@my-agent/tui` (không phải `pi-tui`). Package name khác
folder name.

---

## 4. Cấu trúc fork hiện tại

### Fork markers (27 locations sau sync 0.80.10)

```
packages/coding-agent/src/
├── main.ts                         # mya -ne hint + CLI flag fallback
├── core/
│   ├── auth-storage.ts             # 10 backward-compat shims + runtimeOverrides
│   ├── footer-data-provider.ts     # subagentCount field + accessors
│   ├── model-registry.ts           # setRuntimeApiKey shim (delegates to RuntimeCredentials)
│   ├── resource-loader.ts          # MYA_SKILL_SOURCE env gate
│   ├── settings-manager.ts         # systemPrompt / appendSystemPrompt accessors
│   ├── skills.ts                   # compactDescription + MYA_SKILL_SOURCE path
│   ├── sdk.ts                      # re-export AgentSession for subagent.ts
│   └── system-prompt.ts            # APP_NAME/APP_TITLE dynamic branding
└── (main.js, core/*.js)            # compiled mirrors (auto-generated by tsc)
```

### Files NEW (mya-only, không có trong pi)

| File | Mục đích |
|---|---|
| `packages/coding-agent/src/core/subagent.ts` | Subagent spawning system |
| `packages/print/src/main.ts` | mya CLI entry point (wraps pi-main.ts) |
| `packages/print/src/mya-bridge.ts` | mya-specific features bridge |
| `packages/print/src/launcher.ts` | TUI launcher with cron display |
| `packages/print/src/cron-cli.ts` | Cron CLI commands |
| `packages/print/src/cron-persist.ts` | Cron persistence layer |
| `packages/print/src/cron-observability.ts` | Cron observability |
| `packages/print/src/cron-role.ts` | Cron role seam |
| `packages/print/src/shared-instances.ts` | Shared singleton instances |
| `packages/print/src/skill-search/index.ts` | Skill search |

### MYA packages (100% original, không fork pi)

```
packages/
├── cron/          # Cron system (22 commits hardening)
├── memory/        # Memory system (SQLite FTS5 + Weibull)
├── channels/      # Multi-platform delivery
├── gateway/       # HTTP gateway (auth, cron, sync, collab, push, WS)
├── tools/         # Tool implementations (builtin, web, browser)
├── core/          # Core types (budget, cost, loop, session, roles, time)
├── agent/         # Agent pool + subagent runner
├── collab/        # Collaboration rooms
├── sync/          # Cross-device sync
├── skills/        # Skill system
├── secrets/       # Secret management (WebAuthn, pairing)
├── audit/         # Audit log + recovery trust
├── workflows/     # Workflow orchestration
├── council/       | Council (multi-model debate)
├── tui/           # TUI (forked from pi-tui, 0 patches)
├── eval/          # Evaluation harness
├── dap/           # Debug adapter protocol
├── json/          # Byte-faithful JSON
├── rpc/           # RPC protocol
├── signing/       # Content signing
├── x402/          # x402 payment protocol
├── web/           # Web dashboard (PWA)
├── pkg/           # Package management
├── prompts/       # Prompt assembly + compression
├── subagents/     # Subagent isolation + mergeback
├── codeexec/      # Code execution bridge
├── codenav/       # Code navigation
├── lsp/           # LSP client
├── desktop/       # Desktop (Tauri)
└── tts/           # Text-to-speech (MLX)
```

---

## 5. Quy trình sync upstream CHÍNH XÁC

> Quy trình đã được validate qua sync 0.80.6 → 0.80.10 (585 files changed,
> 0 regression).

### Giai đoạn 0: Chuẩn bị (30 phút)

```bash
# 0.1. Đảm bảo working tree clean
git status --short  # → must be empty
git checkout main
git pull origin main

# 0.2. Ghi SHA hiện tại (để rollback nếu cần)
echo "PRE_SYNC_SHA=$(git rev-parse HEAD)" > /tmp/sync-info.txt

# 0.3. Tạo branch sync
git checkout -b sync/pi-${NEW_VERSION}

# 0.4. Tìm TẤT CẢ patches hiện tại (SOURCE OF TRUTH)
grep -rn "mya fork" packages/coding-agent/src/ --include="*.ts" | \
  grep -v "\.js:" > /tmp/existing-patches.txt
cat /tmp/existing-patches.txt
echo "Total: $(wc -l < /tmp/existing-patches.txt) patch locations"

# 0.5. Download upstream npm packages
mkdir -p /tmp/pi-upstream
cd /tmp/pi-upstream
npm pack @earendil-works/coding-agent@${NEW_VERSION}
npm pack @earendil-works/pi-agent-core@${NEW_VERSION}
npm pack @earendil-works/pi-ai@${NEW_VERSION}
npm pack @earendil-works/pi-tui@${NEW_VERSION}

# 0.6. Extract
for pkg in *.tgz; do
  dir=$(basename "$pkg" .tgz)
  mkdir -p "$dir" && tar xzf "$pkg" -C "$dir"
done
```

### Giai đoạn 1: Sync packages có RỦI RO THẤP nhất trước (15 phút)

> Thứ tự: tui → pi-agent-src → pi-ai-src (0 patches, chỉ rename)

```bash
# 1.1. Sync tui (0 patches)
rm -rf packages/tui/src
cp -r /tmp/pi-upstream/earendil-works-pi-tui*/package/dist/src/ packages/tui/src/ 2>/dev/null || \
  cp -r /tmp/pi-upstream/earendil-works-pi-tui*/package/src/ packages/tui/src/

# 1.2. Sync pi-agent-src (0 patches)
rm -rf packages/pi-agent-src/src
cp -r /tmp/pi-upstream/earendil-works-pi-agent-core*/package/src/ packages/pi-agent-src/src/

# 1.3. Sync pi-ai-src (0 patches)
rm -rf packages/pi-ai-src/src
cp -r /tmp/pi-upstream/earendil-works-pi-ai*/package/src/ packages/pi-ai-src/src/

# 1.4. Rename imports (all 3 packages)
find packages/tui/src packages/pi-agent-src/src packages/pi-ai-src/src \
  -name "*.ts" -exec sed -i \
  's/@earendil-works\/coding-agent/@my-agent\/coding-agent/g; \
   s/@earendil-works\/pi-agent-core/@my-agent\/pi-agent-core/g; \
   s/@earendil-works\/pi-ai/@my-agent\/pi-ai/g; \
   s/@earendil-works\/pi-tui/@my-agent\/tui/g' {} +

# 1.5. Remove compiled artifacts
find packages/tui/src packages/pi-agent-src/src packages/pi-ai-src/src \
  \( -name "*.js" -o -name "*.d.ts" -o -name "*.map" \) -delete

# 1.6. VERIFY
grep -r "@earendil" packages/tui/ packages/pi-agent-src/ packages/pi-ai-src/ --include="*.ts"
# → MUST output nothing
```

### Giai đoạn 2: Sync coding-agent (CẨN THẬN NHẤT) (1-2 giờ)

```bash
# 2.1. BACKUP current coding-agent source
cp -r packages/coding-agent/src /tmp/coding-agent-src-backup/

# 2.2. Save mya-only files (don't overwrite)
cp packages/coding-agent/src/core/subagent.ts /tmp/subagent.ts.bak

# 2.3. Overwrite with upstream
rm -rf packages/coding-agent/src
cp -r /tmp/pi-upstream/earendil-works-coding-agent*/package/src/ packages/coding-agent/src/

# 2.4. Restore mya-only files
cp /tmp/subagent.ts.bak packages/coding-agent/src/core/subagent.ts

# 2.5. Rename imports
find packages/coding-agent/src -name "*.ts" -exec sed -i \
  's/@earendil-works\/coding-agent/@my-agent\/coding-agent/g; \
   s/@earendil-works\/pi-agent-core/@my-agent\/pi-agent-core/g; \
   s/@earendil-works\/pi-ai/@my-agent\/pi-ai/g; \
   s/@earendil-works\/pi-tui/@my-agent\/tui/g' {} +

# 2.6. Remove compiled artifacts
find packages/coding-agent/src \( -name "*.js" -o -name "*.d.ts" -o -name "*.map" \) -delete

# 2.7. VERIFY zero @earendil
grep -r "@earendil" packages/coding-agent/src/ --include="*.ts"
# → MUST output nothing
```

### Giai đoạn 3: Re-apply patches (1-2 giờ)

> **Đây là bước quan trọng nhất.** Dùng `/tmp/existing-patches.txt` làm reference,
> nhưng ĐỌC code mới để xem patch có còn áp dụng được không.

```bash
# 3.1. Cho mỗi patch trong /tmp/existing-patches.txt:
#      - Mở file mới
#      - Tìm vị trí tương ứng (function name, nearby code)
#      - Quyết định: re-apply / obsolete / cần adapt

# 3.2. Template cho mỗi patch:
# ┌─────────────────────────────────────────────┐
# │ PATCH: <tên>                                 │
# │ FILE: <file>                                 │
# │ TRẠNG THÁI: re-apply / obsolete / adapt      │
# │ LÝ DO: <nếu obsolete/adapt>                  │
# │                                              │
# │ if (obsolete):                               │
# │   → Upstream added <feature>, patch redundant│
# │   → Delete from markers list                 │
# │                                              │
# │ if (re-apply):                               │
# │   → Copy patch code + "// mya fork:" marker  │
# │   → Verify surrounding code hasn't changed   │
# │                                              │
# │ if (adapt):                                  │
# │   → Modify patch for new upstream structure  │
# │   → Add "// mya fork: adapted for 0.80.X"    │
# └─────────────────────────────────────────────┘
```

**Chi tiết từng patch** (xem [§4 cấu trúc fork](#4-cấu-trúc-fork-hiện-tại) và
file markers list):

| # | Patch | File | Cách re-apply |
|---|---|---|---|
| 1 | Extension hint | `main.ts` | Tìm `EXTENSION_LOAD_FAILURE_HINT`, sửa chuỗi |
| 2 | CLI flag fallback | `main.ts` | Tìm settings load logic, thêm `?? runtimeSettingsManager.getSystemPrompt()` |
| 3 | MYA_SKILL_SOURCE | `resource-loader.ts` | Tìm `updateSkillsFromPaths`, thêm env gate |
| 4 | subagentCount | `footer-data-provider.ts` | Thêm field + getter/setter |
| 5 | systemPrompt accessors | `settings-manager.ts` | Thêm 4 methods + interface fields |
| 6 | compactDescription | `skills.ts` | Thêm function + dùng trong skill listing |
| 7 | setRuntimeApiKey shim | `model-registry.ts` | Delegate to `this.runtime.setRuntimeApiKey()` |
| 8 | APP_NAME branding | `system-prompt.ts` | Thay hardcoded "pi" → `${APP_NAME}` |
| 9 | AgentSession re-export | `sdk.ts` | `export type { AgentSession }` |
| 10 | auth-storage shims | `auth-storage.ts` | Thêm `runtimeOverrides` Map + 10 methods |

### Giai đoạn 4: Sync vendored (30 phút)

```bash
# 4.1. Update vendored compiled JS
rm -rf vendored/pi vendored/pi-agent-core vendored/pi-ai
cp -r /tmp/pi-upstream/earendil-works-coding-agent*/package/dist/ vendored/pi/
cp -r /tmp/pi-upstream/earendil-works-pi-agent-core*/package/dist/ vendored/pi-agent-core/
cp -r /tmp/pi-upstream/earendil-works-pi-ai*/package/dist/ vendored/pi-ai/

# 4.2. Check if upstream deps changed
diff <(ls vendored/) /tmp/pi-upstream/earendil-works-coding-agent*/package/node_modules/ 2>/dev/null
# → If new deps, vendor them too
```

### Giai đoạn 5: Build + Test (30 phút)

```bash
# 5.1. TypeScript compile
npx tsc -b 2>&1 | grep "error TS" | head -20
# → Fix any errors (usually import path issues)

# 5.2. Bundle
npm run bundle
# → Must succeed

# 5.3. Verify bundle integrity
grep -c "@earendil" dist/mya.js  # → MUST be 0

# 5.4. Full test suite
npx vitest run --pool forks 2>&1 | grep -E "Test Files|Tests "
# → Must be all pass (or only pre-existing failures)

# 5.5. E2E smoke test
mya serve --port 3999 &
sleep 2
curl -s http://127.0.0.1:3999/health/live  # → OK
curl -s http://127.0.0.1:3999/ready        # → OK
# ... test cron, sync, push, etc.
```

### Giai đoạn 6: Commit + Push (10 phút)

```bash
# 6.1. Review all changes
git diff --stat | tail -5
git diff --stat | wc -l  # → file count

# 6.2. Verify patches intact
grep -rn "mya fork" packages/coding-agent/src/ --include="*.ts" | wc -l
# → Must be ≥ number before sync

# 6.3. Commit
git add -A
git commit -m "feat: PI sync ${OLD_VERSION}→${NEW_VERSION}

PI SYNC (${OLD_VERSION} → ${NEW_VERSION}):
- Overwrite coding-agent/src, pi-agent-src, pi-ai-src, tui
- Import rename: @earendil-works/* → @my-agent/*
- Remove compiled artifacts (.js/.d.ts/.map)
- Re-apply N patches (M obsolete via upstream additions)

[Describe any bug fixes needed during sync]

Verified:
- N/N tests pass
- Bundle: 0 @earendil references
- E2E: gateway/cron/sync/push all functional"

# 6.4. Merge + push
git checkout main
git merge sync/pi-${NEW_VERSION}
git push origin main
```

---

## 6. Checklist sync (copy-paste)

```bash
# ═══ PRE-SYNC ═══
[ ] git status clean, on main, up-to-date
[ ] grep -rn "mya fork" packages/coding-agent/src/ --include="*.ts" > /tmp/existing-patches.txt
[ ] Created branch sync/pi-${VERSION}
[ ] Downloaded + extracted npm packages to /tmp/pi-upstream/

# ═══ SYNC LOW-RISK (tui, pi-agent-src, pi-ai-src) ═══
[ ] Overwrote 3 packages with upstream src/
[ ] sed import rename (@earendil-works/* → @my-agent/*)
[ ] Deleted compiled artifacts (.js/.d.ts/.map)
[ ] grep "@earendil" → 0 hits

# ═══ SYNC HIGH-RISK (coding-agent) ═══
[ ] Backed up packages/coding-agent/src
[ ] Saved subagent.ts (mya-only)
[ ] Overwrote with upstream src/
[ ] Restored subagent.ts
[ ] sed import rename
[ ] Deleted compiled artifacts
[ ] grep "@earendil" → 0 hits

# ═══ RE-APPLY PATCHES ═══
[ ] main.ts: extension hint + CLI flag fallback
[ ] resource-loader.ts: MYA_SKILL_SOURCE
[ ] footer-data-provider.ts: subagentCount
[ ] settings-manager.ts: systemPrompt accessors
[ ] skills.ts: compactDescription
[ ] model-registry.ts: setRuntimeApiKey shim
[ ] system-prompt.ts: APP_NAME branding
[ ] sdk.ts: AgentSession re-export
[ ] auth-storage.ts: backward-compat shims
[ ] (Check each: re-apply / obsolete / adapt)

# ═══ SYNC VENDORED ═══
[ ] Updated vendored/pi, vendored/pi-agent-core, vendored/pi-ai
[ ] Checked for new upstream deps

# ═══ BUILD + TEST ═══
[ ] npx tsc -b → clean (or only pre-existing errors)
[ ] npm run bundle → success
[ ] grep "@earendil" dist/mya.js → 0
[ ] npx vitest run --pool forks → all pass
[ ] E2E: gateway /health/live, /ready
[ ] E2E: cron add/list/run
[ ] E2E: sync push/pull

# ═══ VERIFY PATCHES INTACT ═══
[ ] grep -rn "mya fork" packages/coding-agent/src/ --include="*.ts" | wc -l ≥ before

# ═══ COMMIT ═══
[ ] git commit with detailed message
[ ] git push origin main
```

---

## 7. Pitfalls & Gotchas

### P1: `@earendil` ẩn trong string literals

```typescript
// "Nhưng grep @earendil ra 0!"
const url = "github.com/earendil-works/pi";  // ← vẫn còn!
```

**Giải pháp**: `grep "@earendil"` check cả strings, nhưng URL hợp lệ (GitHub
repo links) thì OK. Verify manual:
```bash
grep -n "earendil" dist/mya.js  # → chỉ GitHub URLs + GITHUB_REPO constant
```

### P2: Test files dùng API cũ sau breaking change

Upstream 0.80.10 đổi `auth-storage.ts` sync → async. Test files cũ gọi:
```typescript
store.getApiKey("openai")  // ← sync, giờ cần await
```

**Giải pháp**: Convert test calls sang async:
```typescript
await store.getApiKey("openai")  // ← async
```

Sync 0.80.10 phải convert **6 test files** (auth-storage + 6 oauth).

### P3: `vitest pool` phải là `forks`

```typescript
// vitest.config.ts
export default defineConfig({
  test: { pool: "forks" }  // ← NOT "threads" (SQLite native addon breaks)
});
```

### P4: Cron dist phải force-rebuild

```bash
rm -rf packages/cron/dist && npx tsc -b packages/cron
# NOT just: npx tsc -b packages/cron  (stale cache)
```

### P5: Gateway port không default

```bash
mya serve --port 3999           # gateway
MYA_PORT=3999 mya cron list     # CLI phải set MYA_PORT
```

### P6: WS token qua query param, KHÔNG qua header

```javascript
// ✅ Đúng
new WebSocket(`ws://127.0.0.1:3999/events?token=${TOKEN}`)

// ❌ Sai (không work)
new WebSocket(`ws://127.0.0.1:3999/events`, { headers: { token: TOKEN } })
```

### P7: CSRF = Origin-header check (curl bypasses)

```bash
# curl không gửi Origin header → same-origin → pass CSRF
curl -X POST http://127.0.0.1:3999/cron/jobs -d '...'
# Browser sends Origin → checked against allowlist
```

### P8: Pre-existing TS errors trong coding-agent

`packages/coding-agent/` có TS errors (rootDir/composite conflicts) — **đây là
pi code, không phải ours**. Không fix. `npx tsc -b` có thể fail nhưng
`npm run bundle` (esbuild) vẫn works vì esbuild không type-check.

### P9: Compiled .js mirrors trong coding-agent/src

`packages/coding-agent/src/` có cả `.ts` VÀ `.js` (compiled mirrors).
Đây là artifacts từ quá khứ. Khi sync, **xóa hết .js** và chỉ giữ .ts.
esbuild bundle từ .ts.

### P10: `MINIMAX_MODEL` phải set

```json
// auth.json
{
  "env": {
    "MINIMAX_MODEL": "MiniMax-M3"  // ← NOT "auto" (API rejects)
  }
}
```

---

## 8. Kiểm thử (Testing Strategy)

### Unit tests (vitest)

```bash
npx vitest run --pool forks
# → 1824/1824 pass (142 test files)
```

**Baseline**: Nếu số test giảm → có regression. Luôn ghi baseline trước sync.

### E2E tests (manual, thông qua TUI/CLI thật)

```bash
# 1. Start gateway
mya serve --port 3999 &
GW_PID=$!
sleep 2

# 2. Health
curl -sf http://127.0.0.1:3999/health/live  # → OK
curl -sf http://127.0.0.1:3999/ready        # → OK

# 3. Auth (get token)
TOKEN=$(cat ~/.mya/agent/gw.token)

# 4. Cron
MYA_PORT=3999 mya cron add --name test --schedule "* * * * *" --prompt "echo hi"
MYA_PORT=3999 mya cron list
MYA_PORT=3999 mya cron run test --now

# 5. Sync
curl -X POST http://127.0.0.1:3999/sync/pull -H "Cookie: gw=$TOKEN"

# 6. Push (VAPID)
curl http://127.0.0.1:3999/push/vapid-key  # → public key

# 7. WebSocket
wscat -c "ws://127.0.0.1:3999/events?token=$TOKEN"

# 8. Cleanup
kill $GW_PID
```

### Browser tools E2E (Camofox)

```bash
# Start Camofox
cd ~/camofox-browser
CAMOFOX_PORT=3000 xvfb-run node server.js &

# Test via node script
CAMOFOX_URL=http://127.0.0.1:3000 timeout 30 node --input-type=module << 'SCRIPT'
import { browserNavigateTool } from './packages/tools/dist/web/browser/index.js';
const r = await browserNavigateTool.run({ url: 'https://example.com' }, undefined);
console.log(r?.ok ? '✅' : '❌', r?.error || 'navigated');
SCRIPT
```

### 3-round review discipline

Cho mỗi major change:
1. **Code review** — logic correctness, style, regression
2. **Security review** — trust boundaries, injection, auth bypass
3. **Cold-verify** — independent verification, no prior context

---

## 9. Lịch sử version

| Ngày | Pi version | Commit | Thay đổi chính |
|---|---|---|---|
| 2026-07-10 | 0.80.6 | `573b4c1` | Migrate to pi-mono TS SOURCE (initial fork) |
| 2026-07-15 | 0.80.6 | `017a9cc`→`2899f7b` | Cron hardening (22 commits, Phases 0-5) |
| 2026-07-18 | 0.80.6 | `9c35bd9` | Launcher cron sync |
| 2026-07-19 | 0.80.6 | `23c9389` | Pi clone map (3-round review) |
| 2026-07-20 | **0.80.10** | `238558e` | **PI sync 0.80.6→0.80.10** (585 files, 4 patches obsolete) |
| 2026-07-20 | 0.80.10 | `dc33923` | contain() undefined ctx fix |

### Sync deltas (0.80.6 → 0.80.10)

| Metric | Value |
|---|---|
| Files changed | 585 |
| New files | 34 |
| Deleted files | 462 (.js/.d.ts/.map artifacts) |
| Modified files | 193 |
| Patches re-applied | 6 (down from 10) |
| Patches obsolete | 4 (upstream added equivalent) |
| New patches needed | 2 (auth-storage shims, sdk re-export) |
| Bug fixes during sync | 8 (P1 fixes) |
| Test baseline | 1824/1824 pass |

### Upstream breaking changes (0.80.6 → 0.80.10)

1. **`model-registry.ts` refactored**: 1020 → 126 dòng, split thành 7 file mới
   - `model-config.ts`, `model-runtime.ts`, `models-store.ts`,
     `provider-composer.ts`, `radius.ts`, `remote-catalog-provider.ts`,
     `runtime-credentials.ts`
2. **`auth-storage.ts` refactored**: 539 → 271 dòng, sync → async API
3. **`sdk.ts` refactored**: `streamSimple` → `modelRuntime.streamSimple`
4. **`system-prompt.ts`**: upstream rewrote `main.ts`, dropped systemPrompt fallback
5. **`piConfig` support**: upstream added `pkg.piConfig` in package.json
6. **`RuntimeCredentials`**: upstream added `setRuntimeApiKey()` method

---

## Tham khảo

- `docs/pi-clone-map.md` — Bản đồ clone chi tiết (3-round reviewed)
- `docs/FEATURE-CATALOG.md` — Feature catalog (18 areas)
- `docs/cron-system-reference.md` — Cron technical reference
- `docs/test-plan-comprehensive.md` — Test plan
- `docs/untested-features.md` — Features blocked by missing credentials
- `AGENTS.md` — Project rules (stack, hard rules, style)
- `source/.learned/AGENT-SPEC.md` — Authoritative spec
