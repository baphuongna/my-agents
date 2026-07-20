# Pi Clone Map — mya ↔ pi

> Bản đồ chi tiết: mya clone phần nào của pi, ở đâu, mức sửa đổi bao nhiêu,
> và chiến lược sync.
> Pi version: `@earendil-works/*` **v0.80.6**. Cập nhật: 2026-07-20.
> **Reviewed**: 3 vòng (code review + security review + cold-verify).

---

## Tổng quan

mya clone **toàn bộ 4 package** của pi (v0.80.6). Chiến lược: **own the
source** — TypeScript source được copy vào `packages/` và esbuild bundle trực
 tiếp từ source, **không phụ thuộc npm runtime**.

```
scripts/bundle.mjs:
  entry: packages/print/src/main.ts
  resolve: @my-agent/* → packages/*/src/  (TS SOURCE trực tiếp)
  
  → "No external pi dependency. No vendored JS. Source is owned by mya."
```

`dist/mya.js` build **100% từ TS source**. `vendored/` (131 MB) chỉ dùng cho
provider loading runtime + type reference.

---

## Pi có 4 package npm (`@earendil-works/*`)

| # | Pi package | Chức năng | Clone TS source | Clone compiled JS |
|---|---|---|---|---|
| 1 | **pi-coding-agent** | Agent chính: TUI, session manager, tools, CLI, modes | `packages/coding-agent/` | `vendored/pi/` (165 .js) |
| 2 | **pi-agent-core** | Agent harness/loop (lower-level: agent-loop, compaction, session) | `packages/pi-agent-src/` (25 .ts) | `vendored/pi-agent-core/` (25 .js) |
| 3 | **pi-ai** | Provider abstraction: streaming, auth, OAuth, 35+ providers | `packages/pi-ai-src/` (149 .ts) | `vendored/pi-ai/` (148 .js) |
| 4 | **pi-tui** | Terminal UI components (Ink-based renderer, markdown, editor) | `packages/tui/` (28 .ts) | — (npm only) |

---

## Chiến lược clone: SOURCE-first (2 bản sao mỗi package)

### Tầng 1: TS SOURCE (owned, bundle từ đây)

| Vị trí | Package name | Files | Sửa logic |
|---|---|---|---|
| `packages/coding-agent/` | `@my-agent/coding-agent` | 39 core (.ts) + tools(15) + extensions(5) + compaction(4) | **10 file** (xem §Sửa đổi) |
| `packages/pi-agent-src/` | `@my-agent/pi-agent-core` | 25 | 0 (chỉ rename import) |
| `packages/pi-ai-src/` | `@my-agent/pi-ai` | 149 | 0 (chỉ rename import) |
| `packages/tui/` | `@my-agent/tui` | 28 | 0 (nguyên bản 100%) |

### Tầng 2: Compiled JS (vendored, fallback)

| Vị trí | Pi package | Files (.js) | Mục đích |
|---|---|---|---|
| `vendored/pi/` | pi-coding-agent | 165 | Reference (không dùng runtime) |
| `vendored/pi-agent-core/` | pi-agent-core | 25 | Reference (không dùng runtime) |
| `vendored/pi-ai/` | pi-ai | 148 | **Runtime**: provider loading + types + model list |

### Tầng 3: Pi runtime dependencies (vendored, 131 MB tổng)

18 dependencies của pi được vendor để bundle không cần npm:

```
chalk  cross-spawn  diff  genai (@google/genai)  get-east-asian-width
highlight.js  hosted-git-info  ignore  jiti  marked
mistralai  openai  partial-json  proper-lockfile
sdk (@anthropic-ai/sdk)  typebox  undici  yaml
```

> **Lưu ý**: `vendored/sdk` = `@anthropic-ai/sdk` (KHÔNG phải google-genai —
> Google là `vendored/genai`). Còn có `vendored/@opentelemetry/semantic-conventions`.

---

## Runtime: ai dùng cái nào?

| Component | Nguồn runtime | Cách load |
|---|---|---|
| **Interactive TUI** | `packages/coding-agent/` (TS source) | `await import("@my-agent/coding-agent")` trong `pi-main.ts` |
| **Agent harness/loop** | `packages/pi-agent-src/` (TS source) | esbuild resolve từ bundle |
| **AI providers (streaming/auth)** | `packages/pi-ai-src/` (TS source) | esbuild resolve từ bundle |
| **Provider module loading** | `vendored/pi-ai/dist/providers/*.js` | `require()` động trong `shared-instances.ts:168`, `agent/index.ts:842` |
| **Model list** | `vendored/pi-ai/dist/models.generated.js` | Gateway model registry |
| **Type definitions** | `vendored/pi-ai/dist/types.d.ts` | `pi-ai-bridge.ts` reference |
| **TUI components** | `packages/tui/` (TS source) | esbuild resolve từ bundle |

> **Bundle integrity**: `grep -c "@earendil" dist/mya.js` = **0**. Tất cả 9 chuỗi
> `earendil` còn lại là hợp lệ (GitHub URLs, GITHUB_REPO constant, earendil-announcement
> UI component).

---

## Sửa đổi chi tiết — coding-agent (10 file + 1 file mới)

> ⚠️ **Cold-verify (R3) phát hiện**: doc gốc chỉ liệt kê 5 file, thực tế có **10 file
> sửa logic + 1 file mới**. Tất cả nay đã có marker `// mya fork:`.

### 10 file sửa logic (tất cả có marker `// mya fork:`)

| # | File | Sửa đổi gì | Vị trí |
|---|---|---|---|
| 1 | `core/sdk.ts` | `x-mya-rotated-key` header — extension rotate API key | ~3 dòng, gần `streamSimple` (line 329) |
| 2 | `core/resource-loader.ts` | `MYA_SKILL_SOURCE` env gate — restrict skill loading dir | ~10 dòng, trong `updateSkillsFromPaths` (line 616) |
| 3 | `config.ts` | `APP_NAME="mya"`, `APP_TITLE="mya"`, `CONFIG_DIR_NAME=".mya"` — branding | 3 hằng số (line 489) |
| 4 | `main.ts` | Hint `"mya -ne"` trong extension load failure | 1 chuỗi (line 52) |
| 5 | `modes/interactive/interactive-mode.ts` | Branding "mya" trong help text + error messages | 3 chuỗi (lines 790, 3587, 4429) |
| 6 | `core/footer-data-provider.ts` | `subagentCount` field + `getSubagentCount()`/`setSubagentCount()` | line 113 |
| 7 | `core/settings-manager.ts` | `getSystemPrompt`/`setSystemPrompt`/`getAppendSystemPrompt`/`setAppendSystemPrompt` — slim-prompt | 4 methods (line 707) |
| 8 | `core/skills.ts` | `compactDescription()` — rút gọn skill description ≤80 chars + elide `<location>` tag | line 339 |
| 9 | `core/keybindings.ts` | `app.message.copy` + `app.message.followUp` bindings + darwin defaults | line 26 |
| 10 | `core/model-registry.ts` | `supportsToolSearch` + `supportsToolReferences` capability flags | lines 143, 152 |

### 1 file mới (mya-only, không có trong pi)

- `core/subagent.ts` — subagent spawning system (isolated cwd + JSONL history)

### Thư mục đi kèm pi (KHÔNG phải mya thêm — clone 1:1 từ pi)

> ⚠️ **Cold-verify (R3) phát hiện**: các thư mục này là **pi stock** (clone 1:1 từ
> `vendored/pi/dist/core/`), KHÔNG phải "custom tools mya thêm" như doc gốc nói.

- `core/tools/` — 15 file (clone pi stock tools)
- `core/extensions/` — 5 file (clone pi extension system)
- `core/compaction/` — 4 file (clone pi compaction)

### 28 file còn lại (39 core − 10 sửa − 1 mới = 28)

Chỉ rename import path (`@earendil-works/*` → `@my-agent/*`). Line count delta
(+614 agent-session, +516 package-manager...) = TS annotations + JSDoc bị strip
khi compile ra .js. **Verified by cold-verify (R3): agent-session.ts compiled JS
byte-identical với vendored pi sau khi normalize imports.**

---

## pi-agent-src / pi-ai-src / tui — nguyên bản

**Verified by 3 vòng review**: 0 file sửa logic. Chỉ rename import path.

- `grep -rn "@earendil" packages/{pi-agent-src,pi-ai-src,tui}/src/` → **0 hits**
- `grep -ri "mya" packages/tui/` → **0 hits**
- `git log` chỉ có 1 commit (`573b4c1` Migrate to pi-mono TS SOURCE)
- `git diff 573b4c1 HEAD --stat` → **empty** (0 sửa post-migration)

---

## Sync pi bản mới — quy trình

> ⚠️ **CRITICAL**: Trước khi sync, chạy `grep -r "mya fork" packages/coding-agent/src/`
> để tìm TẤT CẢ 10 patch. Doc cũ chỉ ghi 5 — nếu chỉ re-apply 5, sẽ mất 5 patch kia.

### Bước 1: `packages/tui/` — RỦI RO THẤP NHẤT
```
Copy pi-tui TS source → packages/tui/src/
(không cần re-apply patch — 0 sửa đổi)
```

### Bước 2: `packages/pi-agent-src/` — THẤP
```
1. Copy pi-agent-core TS source → packages/pi-agent-src/src/
2. sed import paths: @earendil-works/* → @my-agent/*
3. Verify: grep "@earendil" → should be 0
```

### Bước 3: `packages/pi-ai-src/` — THẤP
```
1. Copy pi-ai TS source → packages/pi-ai-src/src/
2. sed import paths: @earendil-works/* → @my-agent/*
3. Verify: grep "@earendil" → should be 0
```

### Bước 4: `packages/coding-agent/` — CẨN THẬN NHẤT
```
1. Copy pi-coding-agent TS source → packages/coding-agent/src/
   (GIỮ LẠI: subagent.ts — file mya-only)
2. sed import paths: @earendil-works/* → @my-agent/*
3. Re-apply 10 patch (tìm bằng grep "mya fork"):
   a. sdk.ts:               x-mya-rotated-key (gần streamSimple)
   b. resource-loader.ts:   MYA_SKILL_SOURCE (trong updateSkillsFromPaths)
   c. config.ts:            APP_NAME/APP_TITLE/CONFIG_DIR_NAME
   d. main.ts:              extension failure hint
   e. interactive-mode.ts:  branding strings
   f. footer-data-provider: subagentCount field + getSubagentCount/setSubagentCount
   g. settings-manager:     getSystemPrompt/setSystemPrompt + append variants
   h. skills.ts:            compactDescription + elide <location>
   i. keybindings.ts:       app.message.copy + followUp
   j. model-registry.ts:    supportsToolSearch + supportsToolReferences
4. DIFF REVIEW: git diff vendored/pi/dist/core/ packages/coding-agent/src/core/
   cho MỖI file — kiểm tra thêm/bớt ngoài 10 patch đã biết
5. npm run bundle + test
```

### Bước 5: `vendored/` — thay compiled fallback
```
1. Replace vendored/pi/             → new pi-coding-agent dist
2. Replace vendored/pi-agent-core/  → new pi-agent-core dist
3. Replace vendored/pi-ai/          → new pi-ai dist
4. Update vendored deps if changed (chalk, openai, undici...)
```

### Verify sau sync
```bash
grep -r "@earendil" packages/                # → should be 0
grep -r "mya fork" packages/coding-agent/src/ # → 10+ matches (patches intact)
npx tsc -b                                   # → clean
npm run bundle                               # → success
npx vitest run --pool forks                  # → all pass
git diff --stat <prev-sync-sha>..HEAD -- packages/coding-agent/src/core/  # review all changes
```

---

## Security notes (từ security review R2)

### Trust model
mya **fully trusts** pi code (no sandbox, no capability restriction). Điều này
**by-design** theo AGENTS.md ("no OS sandbox, §7 permission gate is the ONLY
runtime control"). mya kế thừa 100% attack surface của pi:
- Bash tool chạy với full process privilege (no seccomp/container)
- Subagent "isolation" chỉ là `cwd` (cùng Node process, cùng fs/env perms)
- Provider auth bugs, OAuth state-CSRF, vendored dep deserialization

### Findings (0 CRITICAL, 1 HIGH, 3 MEDIUM)

| # | Severity | Finding | Mitigation |
|---|---|---|---|
| 1 | **HIGH** | No automated upstream tracking — pi security fixes lag indefinitely | Add Dependabot/Renovate cho `@earendil-works/*` + `npm audit` CI |
| 2 | **MED** | `MYA_SKILL_SOURCE` path không validate, symlink followed | Add `realpath` containment + reject symlinks |
| 3 | **MED** | `x-mya-rotated-key` — extension-trusted credential rotation | Document trust model; audit-log key hash (not value) |
| 4 | **MED** | Sync procedure không có automated diff-review gate | Add CI diff gate + `.pi-upstream-sha` sidecar |
| 5 | LOW | Provider require() không có allowlist guard (hiện safe — hardcoded) | Add `^[a-z0-9-]+$` regex guard |
| 6 | LOW | Bundle không có SBOM / `npm audit` step | Add SBOM + audit CI |

### Known test issue
`packages/coding-agent/test/skills.test.ts:247` **FAILS** — expects `<location>`
tag but mya's `skills.ts` elides it (slim-prompt feature). File này nằm ngoài
vitest include pattern (`packages/*/src/**/*.test.ts`), nên không chạy trong CI.
**Action**: update test hoặc document as intentional divergence.

---

## Pi version tracking

| Cột mốc | Pi version | Commit |
|---|---|---|
| Clone pi TUI vào vendored/ | 0.80.6 | `35054f0` |
| Migrate to pi-mono TS SOURCE | 0.80.6 | `573b4c1` |
| 3-round review + markers added | 0.80.6 | (commit này) |
| Current | 0.80.6 | — |

> Khi pi release bản mới, cập nhật bảng này + chạy quy trình sync ở trên.
> **QUAN TRỌNG**: chạy `grep -r "mya fork"` TRƯỚC khi sync để không mất 10 patch.
