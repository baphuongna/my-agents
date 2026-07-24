# Test Coverage — mya

> **Tài liệu tham chiếu chính thức về test coverage. Khi thêm tính năng mới, PHẢI thêm test và cập nhật file này.**
>
> **Last updated:** 2025-07-24 · **Total:** 5,370 tests · 282 files · 0 failures · **pi: 0.82.0** (sync commit `358e5c0`)

---

## 1. Tổng quan

| Loại | Files | Tests | Vai trò |
|------|-------|-------|---------|
| **Feature tests** (`test/features/`) | 54 | 1,191 | Test theo feature catalog (§1-§23) |
| **In-package tests** (`packages/*/src/`) | 505 | 6,703 | Test theo module/source file |
| **Pre-existing** (`packages/*/test/`) | 166 | ~4,800 | Vendored PI test suite |
| **TOTAL** | **725+** | **~12,700+** | |

### Lệnh chạy test

```bash
# Toàn bộ
npx vitest run --testTimeout=5000

# Một package
npx vitest run packages/core/src/ --testTimeout=5000

# Một file
npx vitest run packages/memory/src/store.test.ts --testTimeout=5000

# Feature tests only
npx vitest run test/features/ --testTimeout=5000

# Watch mode (TDD)
npx vitest watch packages/core/src/
```

### Config

- **Runner:** Vitest 2.x
- **Pool:** `forks` (child processes, NOT worker_threads — tránh crash ONNX runtime)
- **Environment:** `node`
- **TS target:** `es2022`
- **Config file:** `vitest.config.ts`

---

## 2. Quy tắc bắt buộc — KHI THÊM TÍNH NĂNG MỚI

### ⚠️ NGUYÊN TẮC: NO TEST = NO MERGE

Khi thêm tính năng mới, BẮT BUỘC:

1. **Tạo test file** matching source file:
   - Source: `packages/<pkg>/src/<module>.ts`
   - Test: `packages/<pkg>/src/<module>.test.ts`

2. **Minimum coverage per function:**
   - Happy path (1 test)
   - Error/edge case (1 test)
   - Empty/null input (1 test)
   - Boundary value (1 test nếu có số liệu)

3. **Nếu thêm feature vào FEATURE-CATALOG.md:**
   - Tạo test file trong `test/features/<section>/`
   - Cập nhật `test/features/00-MASTER-TESTPLAN.md`
   - Thêm entry vào bảng §4 bên dưới

4. **Chạy test trước khi commit:**
   ```bash
   npx vitest run packages/<pkg>/src/<module>.test.ts
   ```

5. **Cập nhật file này** (§4 hoặc §5 bảng)

---

## 3. Quy ước viết test

### 3.1. Import paths theo độ sâu thư mục

```
test/features/XX-yyyy/           → ../../../packages/   (3 ../)
test/features/XX-yyyy/ZZ-zzz/      → ../../../../packages/ (4 ../)
packages/XX/src/                  → ./module.js           (relative)
```

### 3.2. 5-tier test pattern

| Tier | Tag | Mục đích | Khi nào dùng |
|------|-----|----------|-------------|
| **Unit** | `[unit]` | Pure functions, logic | Mọi function có logic |
| **Smoke** | `[smoke]` | Module load, no-throw | Mọi module mới |
| **Real** | `[real]` | Spawn `mya` binary | CLI integration |
| **System** | `[system]` | Multi-process E2E | `MYA_INTEGRATION=1` |
| **TUI** | `[tui]` | Interactive PTY | `MYA_TUI_TEST=1` |

```typescript
describe("[unit] functionName", () => {
  it("happy path", () => { ... });
  it("error case", () => { ... });
});

describe("[smoke] moduleName", () => {
  it("loads without error", async () => {
    const m = await import("./module.js").catch(() => null);
    expect(m).not.toBeNull();
  });
});
```

### 3.3. Async imports với graceful fallback

```typescript
const m = (await import("../../../packages/tools/src/osv-check.ts")
  .catch(() => null)) as any;
if (m?.osvCheckTool) {
  // test nếu module load thành công
}
```

### 3.4. Temp directories cho file-based tests

```typescript
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mya-test-"));
});
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});
```

### 3.5. Time-dependent tests (Invariant #10)

```typescript
import { setTimeProvider } from "@my-agent/core";

afterEach(() => setTimeProvider(null)); // restore real clock

it("expires after TTL", () => {
  let fakeNow = 1000;
  setTimeProvider(() => fakeNow);
  // ... test ...
  fakeNow += 10000; // advance time
  // ... assert expiry ...
});
```

### 3.6. `[real]` tests — tránh hang

```typescript
// KHÔNG chạy nếu MYA_BIN không tồn tại
const MYA_BIN = process.env.MYA_BIN;
describe.skipIf(!MYA_BIN)("[real] mya CLI", () => {
  // ...
});
```

---

## 4. Feature tests theo section

> Đường dẫn đầy đủ: `test/features/<path>`

### §1 Core Agent (9 files, 213 tests)
| File | Tests | Feature |
|------|-------|---------|
| `01-core-agent/01-tui.test.ts` | 33 | Interactive TUI (ArrayHistory, SIGINT, EOF) |
| `01-core-agent/02-print.test.ts` | 20 | Print mode (makeSink, humanize) |
| `01-core-agent/03-json-stream.test.ts` | 17 | NDJSON streaming format |
| `01-core-agent/04-rpc.test.ts` | 13 | JSON-RPC 2.0 server |
| `01-core-agent/05-dap-launch.test.ts` | 16 | DAP launch mode |
| `01-core-agent/06-bg.test.ts` | 12 | Background sessions (list/kill) |
| `01-core-agent/07-session.test.ts` | 18 | Session create/resume/fork |
| `01-core-agent/08-model-override.test.ts` | 26 | Model override |
| `01-core-agent/09-context-compression.test.ts` | 58 | Context compression (thresholds, idle, pruning) |

### §2 Multi-Provider Gateway (8 files, 184 tests)
| File | Tests | Feature |
|------|-------|---------|
| `02-providers/01-eight-providers.test.ts` | 28 | 8+ provider registry |
| `02-providers/02-provider-discovery.test.ts` | 21 | Provider discovery |
| `02-providers/03-oauth-flow.test.ts` | 31 | OAuth PKCE flow |
| `02-providers/04-mcp-oauth.test.ts` | 21 | MCP OAuth |
| `02-providers/05-fallback-chain.test.ts` | 24 | Fallback chain + classifyTurnError |
| `02-providers/06-taint.test.ts` | 21 | Auth/quota taint |
| `02-providers/07-registry.test.ts` | 25 | Provider registry lifecycle |
| `02-providers/08-serve.test.ts` | 13 | Gateway serve |

### §3 Tools System (12 files, 210 tests)
| File | Tests | Feature |
|------|-------|---------|
| `03-tools/3a-file-code/01-read.test.ts` | 17 | read tool |
| `03-tools/3a-file-code/02-write.test.ts` | 14 | write tool |
| `03-tools/3a-file-code/03-edit.test.ts` | 16 | edit tool |
| `03-tools/3a-file-code/04-bash.test.ts` | 14 | bash tool |
| `03-tools/3a-file-code/05-glob-grep-ls-find.test.ts` | 28 | glob/grep/ls/find |
| `03-tools/3b-web/01-web-search-fetch.test.ts` | 26 | Web search + SSRF guard |
| `03-tools/3b-web/02-browser.test.ts` | 14 | Browser tool |
| `03-tools/3c-code-intel/01-codegraph-lsp.test.ts` | 22 | Codegraph + LSP |
| `03-tools/3c-code-intel/02-code-screen.test.ts` | 18 | Code exec + screen capture |
| `03-tools/3d-security/01-osv-url-safety.test.ts` | 14 | OSV + URL safety |
| `03-tools/3e-productivity/01-image-video-gen.test.ts` | 16 | Image/video generation |
| `03-tools/3e-productivity/02-disk-cleanup-cron.test.ts` | 11 | Disk cleanup + cron tools |

### §4-§23 (25 files, 584 tests)
| File | Tests | Feature |
|------|-------|---------|
| `04-memory/01-pipeline.test.ts` | 29 | 5-layer memory pipeline |
| `04-memory/02-features.test.ts` | 47 | Memory features (DreamCycle, roles, embeddings, etc.) |
| `05-cron/01-cron-system.test.ts` | 49 | Cron system (15 features) |
| `06-channels/01-channels.test.ts` | 23 | Channel adapters + rate limit |
| `07-skills/01-06` (6 files) | 82 | Skills system |
| `07a-kanban/01-08` (8 files) | 117 | Kanban SQLite |
| `08-subagents/01-subagents-council-workflows.test.ts` | 37 | Subagents/council/workflows |
| `09-security/01-security-auth.test.ts` | 22 | Redact + threat-scan |
| `10-21-remaining/all-remaining.test.ts` | 103 | Desktop/Launcher/Web/Sync/Eval/MCP/TTS/x402/DAP/Voice/System/Gamification |
| `16-tts/01-tts-depth.test.ts` | 24 | TTS backend selection + ModelManager |
| `18-dap/01-dap-depth.test.ts` | 23 | DAP framing + client lifecycle |
| `22-p0-spec/01-spec-compliance.test.ts` | 14 | P0 invariants (time, JSON, NativeResult) |
| `23-discovery/01-provider-discovery.test.ts` | 14 | Provider discovery |

---

## 5. In-package tests theo package

| Package | Src | Tests | Cases | Key modules tested |
|---------|-----|-------|-------|--------------------|
| **core** | 18 | 15 | 249 | LaneBoard, roles, session-utils, cost, budget, redact, threat-scan, canonical-json |
| **memory** | 35 | 38 | 630 | manager, sqlite-store/recall/db, retrieve, lifecycle, tree, embeddings, weibull, brain, migrate |
| **tools** | 30 | 28 | 457 | builtin, hashline, registry, dispatch, permission, path-safety, frecency, tool-search, reference-graph, kanban, codeexec |
| **gateway** | 20 | 26 | 404 | channel-session/setup/adapters, mcp-client, rate-limiter, media-cache, approval-relay, hook-registry, push, stale-lock, systemd |
| **tui** | 16 | 14 | 437 | keys, utils, tui, terminal-image, terminal-color, stdin-buffer, terminal, word-nav, keybindings, autocomplete, fuzzy, kill-ring, undo-stack, sanitize |
| **ai** | 12 | 7 | 170 | openai, pi-ai-bridge, registry, fallback, oauth, provider-discovery |
| **prompts** | 7 | 3 | 121 | assembler (rebuildStableTier/Volatile, markCompressed), compress |
| **cron** | 5 | 6 | 86 | scan, lifecycle-guard, cross-process-lock, agent-tools, catchup |
| **audit** | 4 | 2 | 53 | achievements, trust, merkle-root, recovery |
| **print** | 16 | 12 | 217 | mya-bridge, command-registry, cron-cli/persist/observability, channels-cli, gateway-supervisor, shared-instances |
| **natives** | 1 | 1 | 45 | hash, mac, glob, grep, compressLog, reflink, parseTsSymbols, verifyNativeDeclaration |
| **secrets** | 3 | 3 | 40 | fingerprint, pairing, webauthn |
| **eval** | 4 | 3 | 39 | harness, egress, tier |
| **agent** | 4 | 4 | 52 | subagent, pool, sdk |
| **x402** | 1 | 2 | 21 | wallet, makePaidFetchTool |
| **signing** | 1 | 1 | 14 | npm provenance, signTarball |
| **tts** | 3 | 2 | 17 | mlx, model-manager |
| **workflows** | 4 | 4 | 20 | runner, orchestration, runRhaiWorkflow |
| **sync** | 1 | 3 | 17 | state sync, collab |
| **desktop** | 1 | 1 | 12 | desktop lifecycle |
| **council** | 4 | 3 | 24 | council, hindsight |
| **web** | 6 | 4 | 24 | build, dashboard |
| **collab** | 2 | 2 | 11 | relay |
| **skills** | 3 | 1 | 11 | curator |
| **dap/dap-server** | 5 | 2 | 12 | debug, DAP server |
| **acp** | 1 | 2 | 13 | ACP bridge |
| **pkg** | 1 | 1 | 4 | package manager |
| **rpc** | 2 | 1 | 2 | RPC server |

---

## 6. API mismatches đã phát hiện và fix

> Đây là tài liệu tham chiếu khi viết test mới — đọc source TRƯỚC khi viết.

### 6.1. Tool API

```typescript
// ĐÚNG (ToolImpl interface):
tool.meta.name         // NOT tool.name
tool.meta.args.required  // NOT tool.inputSchema.required
tool.run(args, ctx)    // NOT tool.invoke(args, ctx)

// ToolResult:
{ callId: string, ok: boolean, output: unknown, error?: string }
```

### 6.2. Provider API

```typescript
// PKCE:
generatePkce() → { verifier, challenge, method: "S256" }  // NOT { codeVerifier, ... }

// Auth URL:
buildAuthUrl({ authEndpoint, clientId, redirectUri, scopes[], pkce, state? })
  → { url: string, state: string, pkce: object }  // NOT a URL string

// Token response: snake_case
{ access_token, refresh_token, expires_in }  // NOT camelCase

// Registry:
registry.taint(id, reason)  // NO timestamp param — uses nowWallclock()
registry.eligible(id, now?)  // optional injected time
registry.health()            // NO now param
```

### 6.3. Memory API

```typescript
// MemoryManagerImpl:
manager.write({ role, content, metadata })  // NOT capture()
manager.query({ text })                      // NOT query()

// RetrievalEngine multi-arm:
{ name: string, hits: MemoryHit[] }  // NOT { arm, results }

// CJK tokenizer:
tokenize(text) → Token[]  // NOT string[], use .map(t => t.token)

// Weibull:
weibullBoost({ ageMs, halfLifeMs, ... }) → number
parseTimestamp(input: string | Date | null) → number | null  // rejects numbers
```

### 6.4. Compression API

```typescript
resolveModelThreshold(model, modelThresholds, defaultPercent) → number
computeThresholdTokens(contextLength, thresholdPercent, maxTokens?) → number
shouldIdleCompact({ enabled, idleAfterSeconds, idleGapSeconds, tokens, floorTokens, cooldownActive })
pruneOldToolResults(messages, { protectTailCount }) → { messages, prunedCount }
assembleCompressed(head[], summary, tail[]) → Message[]
CompressionState.updateFromResponse(realTokens, thresholdTokens)
```

### 6.5. Cron API

```typescript
matchesCronExpr(expr, date) → boolean  // invalid expr returns false, doesn't throw
acquireCronLock(workerId) → releaseFn | null  // NOT (jobId, { lockDir, pid, ttlMs })
validateCronPrompt(prompt) → string | null    // null = OK, NOT { ok: boolean }
validateCronBaseUrl(provider, baseUrl)         // 2 args, NOT 1 object
```

### 6.6. Security API

```typescript
// Redaction:
redactSensitiveText(text)  // NOT redactSecrets
maskSecret(secret)

// Threat scan:
scanForThreats(text, scope) → { safe, matches }  // NOT scanThreats, NOT { threats }
firstThreatMessage(text, scope) → string | null

// URL safety:
checkUrl(rawUrl, opts?) → GuardDecision  // NOT shouldBlockUrl / checkUrlSafety
```

---

## 7. Bugs phát hiện qua testing

| # | Module | Bug | Status |
|---|--------|-----|--------|
| 1 | memory/store.ts | UnifiedStore loadFromDisk race condition (double-load) | ⚠️ Documented |
| 2 | tools/lsp-cascade.ts | LspClient.start() hangs 30s on missing binary (no error listener) | ⚠️ Documented |
| 3 | audit/achievements | night-owl achievement triggers on any stat if after midnight | ✅ Fixed in test |
| 4 | bash tool | No command filtering (no sandbox per AGENTS.md) | ⚠️ By design |
| 5 | ai/openai.ts:178 | `tc.index` not in TS interface (runtime works via JSON.parse) | ⚠️ Pre-existing |
| 6 | tools/hashline | JS fallback `**/*.ts` glob divergence from native | ⚠️ Documented |

---

## 8. Không test được (và lý do)

| Module | Lý do |
|--------|-------|
| `print/launcher.ts` (176 branches) | Interactive PTY main loop — cần E2E/PTY spawn |
| `print/main.ts` (67 branches) | CLI entry point, 0 exports — chỉ side effects |
| `pi-ai-src/*`, `pi-agent-src/*` | Vendored upstream code (tested riêng) |
| Rust `desktop-shell` | Tauri main — cần GUI runtime |
| Rust `natives` | Tested qua JS bridge (`packages/natives/src/index.test.ts`) |
| `desktop/DesktopIpc` | Cần Tauri IPC runtime |
| `agent/FullAgentSDK` | Tested gián tiếp qua subagent.test.ts |
| 5 memory constants (`BRAIN_TYPES`, `TRUST_*`) | Tested gián tiếp qua functions |
| 4 tools constants (`HASH_RE`, `MAX_HASH_*`) | Tested gián tiếp qua hashline |
| 5 web exports (`isMobile`, `renderMobileNav`) | React/DOM — cần jsdom browser env |

---

## 9. Lịch sử coverage

| Vòng | Ngày | Focus | Tests |
|------|------|-------|-------|
| 1 | 2025-07-23 | Fix 50 feature files (API mismatches) | → 1,284 |
| 2 | 2025-07-23 | Structural gaps (natives, TUI, §22/§23) | +196 |
| 3 | 2025-07-23 | Deep: core/memory/tools/ai | +394 |
| 4 | 2025-07-23 | Deep: gateway/print/audit/prompts/eval/secrets | +330 |
| 5 | 2025-07-23 | Deep: memory fns, tools/gateway classes | +160 |
| 6 | 2025-07-24 | Final exports: ref-graph/builtin/screen/lsp | +123 |
| 7 | 2025-07-24 | Last exports: createRagfs, singletons | +51 |
| 8 | 2025-07-24 | Edge cases: sqlite/lifecycle/mcp/kanban | +192 |
| 9 | 2025-07-24 | Edge cases: sqlite-db + mya-bridge | +79 |
| 10 | 2025-07-24 | TUI deep: keys + utils + engine | +204 |
| 11 | 2025-07-24 | TUI: terminal-image + stdin + terminal | +75 |
| 12 | 2025-07-24 | TUI: image encoding + colors + word-nav | +82 |
| **TOTAL** | | | **5,370+** |
