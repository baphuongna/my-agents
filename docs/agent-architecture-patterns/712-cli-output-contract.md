# Hướng AAJ: CLI Output Contract — client mỏng shell out tới `codeburn status --format menubar-json` và parse JSON

> **Nguồn gốc:** codeburn (docs/architecture.md) | **Coupling:** 🟢 — CLI output contract, client mỏng không phụ thuộc internals | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có CLI + structured result — chưa có format contract pin bằng tests) | **Effort:** 1-2 tuần

## Nguồn gốc

**codeburn** có **macOS menubar (Swift)** và **GNOME extension** — cả hai **shell out** tới `codeburn status --format menubar-json` rồi **parse JSON**. Client mỏng chỉ phụ thuộc **output contract** — format JSON được **pin bằng tests** (schema version + golden fixtures). Đổi internals (Rust code, storage) không phá client miễn contract giữ nguyên. Nguyên tắc: **output format là API public** — CLI shell-out làm boundary, contract là hợp đồng versioned.

## Mô tả

mya CLI output contract: packages/print cli.ts + structured-result.ts đã có structured output. AAJ thêm **`--format <name>` contract**: mỗi format (menubar-json, json, markdown…) có **schema version** (vd `menubar-json@1`) + **golden fixture tests** — test parse output như client thật, đổi format phá test. Client ngoài (extension menubar, widget, script) shell out `mya status --format menubar-json` và parse — không require internal API. Contract gồm: version field, shape ổn định, field có ý nghĩa rõ.

## Kiến trúc

```
  CLIENT MỎNG (Swift menubar / GNOME ext / script)
        │
        │  shell out: mya status --format menubar-json
        ▼
  ┌─── CLI (packages/print cli.ts) ────────────────────┐
  │  chạy status → render theo format registry          │
  │  menubar-json@1 → { version, items: [...] }         │
  └──────────────────────┬───────────────────────────────┘
                         ▼
  ┌─── CONTRACT PIN (tests) ───────────────────────────┐
  │  golden fixture: menubar-json@1 expected output     │
  │  test: parse output như client thật                 │
  │  → format đổi = test đỏ = breaking change           │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/print cli.ts — command registry (nơi thêm --format)
// ✅ packages/print structured-result.ts — <DONE> structured parse (nền)
// ✅ packages/print runtimes/cost-tracker.ts — status data nền
// ✅ packages/print cli-flags.ts — flag parsing (nơi thêm format flag)
// ✅ packages/eval tiers — test infrastructure (nền contract tests)

// ❌ THIẾU: format registry + schema version
// ❌ THIẾU: golden fixture tests cho menubar-json
```

## Implementation

```typescript
// packages/print/src/output-contract.ts (NEW)
export interface ContractVersion { name: string; version: number }

export interface MenubarItem {
  label: string;      // "tokens: 1.2k"
  value?: string;
  urgent?: boolean;   // true → client highlight
}

/** menubar-json@1 — contract cố định, versioned. */
export interface MenubarJsonV1 {
  contract: "menubar-json";
  version: 1;
  generatedAt: number;      // epoch ms
  items: MenubarItem[];
  totals?: { tokens: number; usd: number };
}

/** Format registry: name → renderer. Thêm format = thêm entry + fixture. */
export type FormatName = "menubar-json" | "plain";

export function renderStatus(opts: {
  format: FormatName;
  tokens: number; usd: number; active: boolean;
}): string {
  if (opts.format === "menubar-json") {
    const payload: MenubarJsonV1 = {
      contract: "menubar-json", version: 1,
      generatedAt: Date.now(),
      items: [
        { label: `tokens: ${opts.tokens.toLocaleString()}`, value: String(opts.tokens) },
        { label: `$${opts.usd.toFixed(2)}`, urgent: opts.usd > 5 },
      ],
      totals: { tokens: opts.tokens, usd: opts.usd },
    };
    return JSON.stringify(payload);
  }
  return `status: ${opts.active ? "active" : "idle"} — ${opts.tokens} tokens / $${opts.usd.toFixed(2)}`;
}

/** Client-side parse — dùng trong test như client thật. */
export function parseMenubarJson(raw: string): MenubarJsonV1 {
  const parsed = JSON.parse(raw) as MenubarJsonV1;
  if (parsed.contract !== "menubar-json" || parsed.version !== 1) {
    throw new Error(`unsupported contract: ${parsed.contract}@${parsed.version}`);
  }
  return parsed;
}

// Test contract (vitest):
//   const out = renderStatus({ format: "menubar-json", tokens: 1200, usd: 0.5, active: true });
//   expect(parseMenubarJson(out).items[0]!.label).toBe("tokens: 1,200");
//   → đổi shape menubar-json = test đỏ = breaking change rõ ràng
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Client mỏng — chỉ phụ thuộc contract | ❌ Shell-out overhead (spawn process mỗi lần) |
| ✅ Pin bằng tests — breaking change rõ ràng | ❌ Version bump phải phối hợp với client |
| ✅ Đổi internals không phá client | ❌ Field thêm mới phải backward-compatible |
| ✅ Nhiều format cùng renderer | ❌ JSON parse lỗi khi CLI crash — cần non-zero exit |

## Khác các hướng gần

| | RPC (bg-runner) | AAJ: CLI Output Contract |
|---|---|---|
| Kết nối | TCP persistent | **Shell-out mỗi lần** |
| Hợp đồng | Protocol framing | **JSON format versioned** |
| Client | Code chuyên dụng | **Bất kỳ (Swift/ext/script)** |
| Mối quan hệ | Stateful | **Stateless — dễ cho client mỏng** |

## Khi nào chọn

- Nhiều client ngoài cần status (menubar, widget, extension)
- Muốn boundary rõ giữa CLI và UI — format là API
- Đã có cli.ts + structured output — thêm format registry + fixtures
- Guard: contract field `{contract, version}` luôn có, test parse như client thật, non-zero exit khi lỗi
