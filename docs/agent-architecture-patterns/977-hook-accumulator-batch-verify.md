# Hướng AKO: Hook Accumulator Batch Verify — PostToolUse accumulator gom path các file đã edit/created rồi Stop hook chạy batch build verify (Java + TypeScript) trước khi session kết thúc

> **Nguồn gốc:** vetc-dev-kit (hooks/hooks.json) | **Coupling:** 🟡 — hook accumulate + batch verify cuối session | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có ToolHookSink + lsp-cascade; thiếu accumulator) | **Effort:** 1 tuần

## Nguồn gốc

**vetc-dev-kit** (hooks/hooks.json) có **PostToolUse accumulator**: (1) **gom path các file đã edit/created** — mỗi khi tool sửa/tạo file, hook PostToolUse ghi path vào accumulator (không verify ngay); (2) **Stop hook chạy batch build verify** — khi session sắp kết thúc (Stop), hook chạy **một lần verify cho cả batch** (Java + TypeScript — build cả hai) — không verify từng file rời rạc; (3) **verification gộp theo batch thay vì từng file rời rạc** — một lần build thay vì N lần — nhanh hơn, ít noise; (4) **kết quả cuối session** — session kết thúc với trạng thái build thật của toàn bộ thay đổi.

Giá trị: (1) **nhanh** — batch verify 1 lần thay vì per-file; (2) **đúng ngữ cảnh** — verify cả batch như một đơn vị (file A phụ thuộc file B — verify riêng lẻ bỏ sót); (3) **cuối session chắc chắn** — session không kết thúc khi build vỡ; (4) **ít noise** — không interrupt từng lần edit.

## Mô tả

Với mya, pattern = **batch verification accumulator**: (1) **accumulator** — postTool hook (mya có `ToolHookSink` — preTool/postTool trong `packages/core/src/types.ts`): khi tool write/edit tạo file → push path vào Set (dedup); (2) **batch verify trigger** — cuối session/turn (Stop — nối lifecycle): chạy build trên batch: TS → `npm run typecheck`/`tsc -b` (mya có scripts/typecheck.mjs), Java → maven/gradle; (3) **verify scope** — chỉ verify batch thay đổi + dependencies (không build cả repo — nếu dự án lớn); (4) **report** — kết quả: pass → session đóng sạch; fail → báo file lỗi (nối `lsp-cascade.ts` diagnostics cho chi tiết); (5) nơi gắn — `packages/core` (ToolHookSink + lifecycle), `packages/tools` (verify runner — codeexec), `packages/eval` (batch như một test). Đây là pattern **deferred batch verification**: gom thay đổi, verify một lần đúng ngữ cảnh — thay vì verify từng mảnh lệch ngữ cảnh.

## Kiến trúc (ASCII)

```
  EDIT/CREATE FILE (PostToolUse hook — ToolHookSink)
    │
    ▼ ACCUMULATOR (gom path vào Set — dedup, không verify ngay)
  ├─ + src/foo.ts
  ├─ + src/bar.ts
  └─ + test/baz.test.ts
    │
    ▼ STOP HOOK (cuối session — lifecycle)
    ▼ BATCH VERIFY (một lần cho cả batch — Java + TypeScript)
  ├─ TS : npm run typecheck (tsc -b — mya scripts/typecheck.mjs)
  ├─ Java: mvn compile (nếu có pom.xml)
  └─ FAIL ──► báo file lỗi (lsp-cascade diagnostics) — session không đóng vỡ build
    │
    ▼ PASS ──► session đóng sạch (toàn bộ thay đổi verified như một đơn vị)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core/src/types.ts — ToolHookSink preTool/postTool (nơi gắn accumulator)
// ✅ packages/tools/src/lsp-cascade.ts — runCascade + diagnostics (nền — báo lỗi chi tiết)
// ✅ packages/tools/src/codeexec.ts — code-exec bridge (chạy batch build)
// ✅ scripts/typecheck.mjs — typecheck script (TS batch verify)
// ✅ packages/core/src/loop.ts — loop/lifecycle (nơi gắn Stop hook)
// ❌ THIẾU: accumulator (postTool gom path — Set dedup)
// ❌ THIẾU: batch verify runner (TS + Java một lần, không per-file)
// ❌ THIẾU: Stop hook trigger (cuối session verify cả batch)
```

## Implementation

```typescript
// packages/tools/src/batch-verify.ts (NEW)
export class BatchAccumulator {
  private files = new Set<string>();      // dedup — mỗi file một lần
  /** PostToolUse — gom path file đã edit/created (không verify ngay). */
  record(toolName: string, args: { path?: string; filePath?: string }): void {
    const p = args.path ?? args.filePath;
    if ((toolName === "write" || toolName === "edit") && p) this.files.add(p);
  }
  get batch(): string[] { return [...this.files]; }
  clear(): void { this.files.clear(); }
}

export interface BatchVerifyResult {
  ok: boolean;
  failed: Array<{ file: string; error: string }>;
  ran: string[];                          // lệnh đã chạy (TS + Java)
}

/** Batch verify — một lần cho cả batch; TS qua typecheck, Java qua maven nếu có. */
export async function batchVerify(accumulator: BatchAccumulator, run: (cmd: string) => Promise<{ stdout: string; exitCode: number | null }>): Promise<BatchVerifyResult> {
  const batch = accumulator.batch;
  const failed: Array<{ file: string; error: string }> = [];
  const ran: string[] = [];
  const tsFiles = batch.filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
  if (tsFiles.length > 0) {   // TS batch — verify cả batch như một đơn vị
    const r = await run("npx tsc -b --pretty false");
    ran.push("tsc -b");
    if (r.exitCode !== 0) failed.push({ file: tsFiles.join(", "), error: r.stdout.slice(0, 500) });
  }
  const javaFiles = batch.filter((f) => f.endsWith(".java"));
  if (javaFiles.length > 0) {   // Java batch — maven compile nếu có
    const r = await run("mvn -q compile");
    ran.push("mvn compile");
    if (r.exitCode !== 0) failed.push({ file: javaFiles.join(", "), error: r.stdout.slice(0, 500) });
  }
  if (failed.length === 0) accumulator.clear();     // pass — batch sạch, bắt đầu batch mới
  return { ok: failed.length === 0, failed, ran };
}

/** Stop hook — cuối session: verify cả batch trước khi đóng. */
export async function onSessionStop(accumulator: BatchAccumulator, verify: () => Promise<BatchVerifyResult>): Promise<BatchVerifyResult> {
  if (accumulator.batch.length === 0) return { ok: true, failed: [], ran: [] };
  const result = await verify();
  if (!result.ok) return result;   // Không xóa accumulator — session sau retry được
  accumulator.clear();
  return result;
}
// Nối core: ToolHookSink.postTool → accumulator.record; lifecycle stop → onSessionStop
// Nối lsp-cascade: fail → chạy diagnostics trên batch files cho chi tiết
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Nhanh — batch verify 1 lần thay vì per-file | ❌ Lỗi chỉ lộ cuối session — không bắt sớm giữa chừng |
| ✅ Đúng ngữ cảnh — file phụ thuộc nhau verify chung | ❌ Build cả batch khi chỉ sửa 1 file — hơi thừa |
| ✅ Cuối session chắc chắn — không đóng khi build vỡ | ❌ Batch lớn → verify lâu — cần threshold |
| ✅ Ít noise — không interrupt từng edit | ❌ Accumulator mất khi crash — batch chưa verify |

## Khác các hướng gần

| | AKO Batch Verify | 826 Test-Run Parser | 783 Ralph Loop |
|---|---|---|---|
| Trọng tâm | Gom edit → verify cuối | Parse kết quả test | Loop tới verified |
| Cơ chế | Accumulator + Stop hook | Regex theo runner | Snapshot + retry |
| Quan hệ | Nguồn verify cho session | Đọc output batch verify | Verify trong loop |

## Khi nào chọn

- Session dài, nhiều edit — verify per-file quá tốn kém/noise
- File phụ thuộc nhau — verify cả batch đúng ngữ cảnh
- Muốn session không bao giờ đóng với build vỡ
- Guard: accumulator dedup, batch verify một lần, fail báo file, pass mới clear