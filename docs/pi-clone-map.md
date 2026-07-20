# Pi Clone Map — mya ↔ pi

> Bản đồ chi tiết: mya clone phần nào của pi, ở đâu, mức sửa đổi bao nhiêu,
> và chiến lược sync.
> Pi version: `@earendil-works/*` **v0.80.6**. Cập nhật: 2026-07-20.

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
| 1 | **pi-coding-agent** | Agent chính: TUI, session manager, tools, CLI, modes | `packages/coding-agent/` | `vendored/pi/` (156 files) |
| 2 | **pi-agent-core** | Agent harness/loop (lower-level: agent-loop, compaction, session) | `packages/pi-agent-src/` (25 files) | `vendored/pi-agent-core/` (25 files) |
| 3 | **pi-ai** | Provider abstraction: streaming, auth, OAuth, 35+ providers | `packages/pi-ai-src/` (149 files) | `vendored/pi-ai/` (148 files) |
| 4 | **pi-tui** | Terminal UI components (Ink-based renderer, markdown, editor) | `packages/tui/` (28 files) | — (npm only) |

---

## Chiến lược clone: SOURCE-first (2 bản sao mỗi package)

### Tầng 1: TS SOURCE (owned, bundle từ đây)

| Vị trí | Package name | Files | Sửa logic |
|---|---|---|---|
| `packages/coding-agent/` | `@my-agent/coding-agent` | 37 core + 48 mở rộng | **5 file** (surgical) |
| `packages/pi-agent-src/` | `@my-agent/pi-agent-core` | 25 | 0 (chỉ rename import) |
| `packages/pi-ai-src/` | `@my-agent/pi-ai` | 149 | 0 (chỉ rename import) |
| `packages/tui/` | `@my-agent/tui` | 28 | 0 (nguyên bản 100%) |

### Tầng 2: Compiled JS (vendored, fallback)

| Vị trí | Pi package | Files | Mục đích |
|---|---|---|---|
| `vendored/pi/` | pi-coding-agent | 156 | Reference (không dùng runtime) |
| `vendored/pi-agent-core/` | pi-agent-core | 25 | Reference (không dùng runtime) |
| `vendored/pi-ai/` | pi-ai | 148 | **Runtime**: provider loading + types + model list |

### Tầng 3: Pi runtime dependencies (vendored, 131 MB tổng)

18 dependencies của pi được vendor để bundle không cần npm:

```
chalk  cross-spawn  diff  genai  get-east-asian-width
highlight.js  hosted-git-info  ignore  jiti  marked
mistralai  openai  partial-json  proper-lockfile
sdk (google-genai)  typebox  undici  yaml
```

---

## Runtime: ai dùng cái nào?

| Component | Nguồn runtime | Cách load |
|---|---|---|
| **Interactive TUI** | `packages/coding-agent/` (TS source) | `await import("@my-agent/coding-agent")` trong `pi-main.ts` |
| **Agent harness/loop** | `packages/pi-agent-src/` (TS source) | esbuild resolve từ bundle |
| **AI providers (streaming/auth)** | `packages/pi-ai-src/` (TS source) | esbuild resolve từ bundle |
| **Provider module loading** | `vendored/pi-ai/dist/providers/*.js` | `require()` động trong `shared-instances.ts`, `agent/index.ts` |
| **Model list** | `vendored/pi-ai/dist/models.generated.js` | Gateway model registry |
| **Type definitions** | `vendored/pi-ai/dist/types.d.ts` | `pi-ai-bridge.ts` reference |
| **TUI components** | `packages/tui/` (TS source) | esbuild resolve từ bundle |

---

## Mức sửa đổi chi tiết

### 1. `packages/coding-agent/` — 5 patch surgical + mở rộng

**5 file sửa logic** (tất cả có marker `// mya fork:`):

| File | Sửa đổi | Dòng |
|---|---|---|
| `core/sdk.ts` | `x-mya-rotated-key` header — extension rotate API key (gần `streamSimple` call) | 3 |
| `core/resource-loader.ts` | `MYA_SKILL_SOURCE` env gate — restrict skill loading dir (trong `updateSkillsFromPaths`) | ~10 |
| `config.ts` | `APP_NAME="mya"`, `APP_TITLE="mya"`, `CONFIG_DIR_NAME=".mya"` — branding | 3 |
| `main.ts` | Hint `"mya -ne"` trong extension load failure | 1 |
| `modes/interactive/interactive-mode.ts` | Branding "mya" trong help text + error messages | 3 |

**1 file mới (mya-only):**
- `core/subagent.ts` — subagent spawning system (isolated cwd + JSONL history)

**Thư mục mở rộng (mya thêm, không đụng pi core):**
- `core/tools/` — 30 file (custom tools)
- `core/extensions/` — 10 file (extension system)
- `core/compaction/` — 8 file (context compaction)

**31 file còn lại**: chỉ rename import path (`@earendil-works/*` → `@my-agent/*`).
Line count delta (+614 agent-session, +516 package-manager...) = TS annotations +
JSDoc bị strip khi compile ra .js, **không phải sửa logic**.

### 2. `packages/pi-agent-src/` — gần như nguyên bản

25 file TS source. Chỉ sửa đổi import path: `@earendil-works/*` → `@my-agent/*`
(pi-ai, pi-ai/compat). **Không thay đổi logic trong bất kỳ file nào.**

### 3. `packages/pi-ai-src/` — gần như nguyên bản

149 file TS source. Chỉ rename import path. **Không thay đổi logic.**

### 4. `packages/tui/` — nguyên bản 100%

28 file TS source. **0 tham chiếu mya, 0 sửa đổi.** Version match pi-tui v0.80.6.

---

## Sync pi bản mới — quy trình

### Bước 1: `packages/tui/` — RỦI RO THẤP NHẤT
```
Copy pi-tui TS source → packages/tui/src/
(không cần re-apply patch — 0 sửa đổi)
```

### Bước 2: `packages/pi-agent-src/` — THẤP
```
1. Copy pi-agent-core TS source → packages/pi-agent-src/src/
2. sed import paths: @earendil-works/* → @my-agent/*
   (pi-ai, pi-ai/compat, pi-agent-core)
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
   (GIỮ LẠI: subagent.ts, core/tools/, core/extensions/, core/compaction/)
2. sed import paths: @earendil-works/* → @my-agent/*
3. Re-apply 5 patch (tìm bằng grep "mya fork"):
   a. sdk.ts:              x-mya-rotated-key (gần streamSimple)
   b. resource-loader.ts:  MYA_SKILL_SOURCE (trong updateSkillsFromPaths)
   c. config.ts:           APP_NAME/APP_TITLE/CONFIG_DIR_NAME
   d. main.ts:             extension failure hint
   e. interactive-mode.ts: branding strings
4. npm run bundle + test
```

### Bước 5: `vendored/` — thay compiled fallback
```
1. Replace vendored/pi/          → new pi-coding-agent dist
2. Replace vendored/pi-agent-core/ → new pi-agent-core dist
3. Replace vendored/pi-ai/       → new pi-ai dist
4. Update vendored deps if changed (chalk, openai, undici...)
```

### Verify sau sync
```bash
grep -r "@earendil" packages/     # → should be 0
grep -r "mya fork" packages/coding-agent/src/  # → 5 matches (patches intact)
npx tsc -b                        # → clean
npm run bundle                    # → success
npx vitest run --pool forks       # → all pass
```

---

## Pi version tracking

| Cột mốc | Pi version | Commit |
|---|---|---|
| Clone pi TUI vào vendored/ | 0.80.6 | `35054f0` |
| Migrate to pi-mono TS SOURCE | 0.80.6 | `573b4c1` |
| Current | 0.80.6 | — |

> Khi pi release bản mới, cập nhật bảng này + chạy quy trình sync ở trên.
