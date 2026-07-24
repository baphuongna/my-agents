# Test Quick Reference — mya

> **File tổng:** [`docs/TEST-COVERAGE.md`](TEST-COVERAGE.md) (chi tiết đầy đủ)
> **pi version:** 0.82.0 · **Tests:** 5,370 / 282 files / 0 failures / ~65s
>
> **Khi thêm tính năng mới → thêm test → cập nhật `docs/TEST-COVERAGE.md`**

---

## Checklist khi thêm feature mới

```
□ 1. Tạo test file matching source: packages/<pkg>/src/<module>.test.ts
□ 2. Minimum: happy path + error case + null/empty input
□ 3. Đọc SOURCE TRƯỚC khi viết test (tránh API mismatch)
□ 4. Chạy: npx vitest run <file> — phải PASS
□ 5. Nếu feature mới trong FEATURE-CATALOG → tạo test/features/<section>/
□ 6. Cập nhật docs/TEST-COVERAGE.md (bảng §4 hoặc §5)
```

## Lệnh thường dùng

```bash
npx vitest run                              # toàn bộ (~90s)
npx vitest run packages/core/src/           # 1 package
npx vitest run packages/memory/src/store.test.ts  # 1 file
npx vitest watch packages/tools/src/        # TDD watch mode
npx vitest run test/features/               # feature tests only
```

## Patterns

```typescript
// Unit test (pure function)
describe("[unit] myFunction", () => {
  it("happy path", () => expect(myFunction(input)).toBe(expected));
  it("error case", () => expect(() => myFunction(bad)).toThrow());
});

// Smoke test (module load)
describe("[smoke] myModule", () => {
  it("loads", async () => {
    const m = await import("./module.js").catch(() => null);
    expect(m).not.toBeNull();
  });
});

// Tool test (ToolImpl API)
const m = await import("./tool.js");
expect(m.myTool.meta.name).toBe("my_tool");  // NOT .name
expect(typeof m.myTool.run).toBe("function"); // NOT .invoke
const r = await m.myTool.run({ arg: "x" });
expect(r.ok).toBe(true);                      // ToolResult shape

// Time-dependent (Invariant #10: no Date.now())
import { setTimeProvider } from "@my-agent/core";
let fakeNow = 1000;
setTimeProvider(() => fakeNow);
afterEach(() => setTimeProvider(null));

// Temp directory
const tmp = mkdtempSync(join(tmpdir(), "test-"));
afterEach(() => rmSync(tmp, { recursive: true, force: true }));
```

## Import paths

| Test location | Import path |
|---|---|
| `packages/XX/src/test.ts` | `./module.js` |
| `test/features/XX-y/` | `../../../packages/` |
| `test/features/XX-y/ZZ-z/` | `../../../../packages/` |

## Cảnh báo API mismatches phổ biến

| ❌ Sai | ✅ Đúng |
|---|---|
| `tool.invoke()` | `tool.run()` |
| `tool.name` | `tool.meta.name` |
| `tool.inputSchema.required` | `tool.meta.args.required` |
| `scanThreats()` | `scanForThreats()` |
| `redactSecrets()` | `redactSensitiveText()` |
| `Date.now()` | `nowWallclock()` / `setTimeProvider()` |
| `manager.capture()` | `manager.write()` |
| `manager.query()` returns array | `manager.query({text})` returns hits |
| `scanThreats().threats` | `scanForThreats().matches` |
| `generatePkce().codeVerifier` | `generatePkce().verifier` |
