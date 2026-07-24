# AGENTS.md — see source/.learned/AGENT-SPEC.md (authoritative)

Stack: TS7 / Rust-stable via napi-rs / Node ≥20 ESM.
Rust gate (any one): trust boundary | hot inner loop (>100k files / AST) | determinism | platform parity.
Hard rules (§18): minimal core, no sandbox, single time helper (`core.time` / `natives.time`),
no `process::exit` in natives (`NativeResult<T>`), transports ↛ core, byte-faithful JSON,
no stub-then-replace.
Style: TS strict + `noUncheckedIndexedAccess` + ESM + discriminated unions; Rust `clippy::exit` denied.

## Test — bắt buộc đọc [`docs/TEST-COVERAGE.md`](docs/TEST-COVERAGE.md)

- **NO TEST = NO MERGE.** Khi thêm tính năng mới, PHẢI tạo `<module>.test.ts` matching source file.
- Runner: Vitest (`pool: forks`). Config: `vitest.config.ts`.
- Lệnh: `npx vitest run --testTimeout=5000` (toàn bộ) hoặc `npx vitest run <file>`.
- Import paths: 2-level deep → `../../../packages/` (3 `../`); 3-level deep → `../../../../packages/` (4 `../`).
- 5 tiers: `[unit]` (pure logic) → `[smoke]` (module load) → `[real]` (spawn binary, cần `MYA_BIN`) → `[system]` (E2E) → `[tui]` (PTY).
- Tool API: `tool.meta.name` + `tool.run()` → `ToolResult { ok, output }` — KHÔNG phải `.invoke()`.
- Time tests: dùng `setTimeProvider(() => fakeNow)` từ `@my-agent/core`, KHÔNG `Date.now()`.
- Temp dirs: `mkdtempSync` + `rmSync` trong `afterEach`.
- Current: 5,370 tests / 282 files / 0 failures.