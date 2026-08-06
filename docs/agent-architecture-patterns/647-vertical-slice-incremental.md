# Hướng XW: Vertical Slice Incremental — incremental implementation giao theo vertical slice, Implement→Test→Verify→Commit→Next Slice chống context rot (research.md)

> **Nguồn gốc:** agent-skills (incremental-implementation — research.md) | **Coupling:** 🟢 — protocol tổ chức công việc, không đổi runtime | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có session + exporters + eval — chưa có slice runner) | **Effort:** 1-2 tuần

## Nguồn gốc

**agent-skills** dạy incremental implementation: không viết cả feature một lần rồi test — mà cắt feature thành **vertical slice** (mỗi slice là một luồng user-visible hoàn chỉnh: UI + logic + data), giao theo vòng `Implement → Test → Verify → Commit → Next Slice`. Có 3 chiến lược cắt: **vertical** (theo luồng nghiệp vụ), **contract-first** (theo interface/api contract), **risk-first** (slice rủi ro cao nhất trước). Mỗi slice kết thúc bằng **commit** — trạng thái luôn xanh. Chống **context rot**: agent không phải giữ toàn bộ feature trong đầu, chỉ giữ slice hiện tại.

## Mô tả

mya áp dụng vertical-slice-incremental: trước khi code, agent chia feature thành slices theo một trong 3 chiến lược. Vòng lặp mỗi slice: implement tối thiểu → test (unit) → verify (chạy thật/đọc output) → commit → slice kế. Nếu verify fail → sửa trong slice, không mở rộng scope. Context window giữ ổn định vì mỗi slice chỉ cần research.md của riêng nó. mya có sẵn session-branch (tạo nhánh con cho slice), exporters (telemetry trace từng slice), eval harness (verify) — XW thêm **slice plan** + **vòng lặp slice runner**.

## Kiến trúc

```
  Feature ──cut──► S1 ─► S2 ─► S3 ─► S4
                    │      │      │      │
  mỗi slice:        ▼      ▼      ▼      ▼
    ┌─ Implement ─► Test ─► Verify ─► Commit ─► Next
    │   tối thiểu    unit     chạy thật    git commit
    └── fail ────────┘ (sửa trong slice, không mở scope)

  Chiến lược cắt:
    vertical       → theo luồng nghiệp vụ (search → view → edit)
    contract-first → theo interface (schema → impl → adapter)
    risk-first     → slice rủi ro cao trước (auth, payment)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core session-branch.ts — branch con cho slice (nền — XW mỗi slice một branch)
// ✅ packages/agent exporters.ts — OTel/Langfuse trace (nền — XW theo dõi slice)
// ✅ packages/eval harness.ts + tiers.ts — verify slice (nền — XW gate)
// ✅ packages/core iteration-budget.ts — giới hạn vòng (nền — XW chống loop)

// ❌ THIẾU: slice plan (danh sách slice + chiến lược cắt)
// ❌ THIẾU: slice runner (Implement→Test→Verify→Commit tuần tự)
// ❌ THIẾU: scope guard (fail slice → sửa trong slice, không mở rộng)
```

## Implementation (TS)

```typescript
// packages/core/src/slice-runner.ts (MỚI)
export type SliceStrategy = "vertical" | "contract-first" | "risk-first";

export interface Slice {
  id: string;          // "S1"
  scope: string;       // "search box: input → query → results"
  dependsOn: string[]; // ["S0"]
  risk: "low" | "med" | "high";
}

export interface SliceResult {
  id: string;
  testsPassed: number;
  verified: boolean;
  committed: boolean;
}

type Step = "implement" | "test" | "verify" | "commit";

export class SliceRunner {
  constructor(
    private slices: Slice[],
    private strategy: SliceStrategy,
  ) {}

  order(): Slice[] {
    // risk-first → sắp risk high trước; contract-first → dependsOn trước
    const list = [...this.slices];
    if (this.strategy === "risk-first") list.sort((a, b) => (a.risk === "high" ? -1 : 1));
    return list;
  }

  async run(
    implement: (s: Slice) => Promise<number>,   // → số test pass
    verify: (s: Slice) => Promise<boolean>,     // chạy thật / đọc output
  ): Promise<SliceResult[]> {
    const results: SliceResult[] = [];
    for (const slice of this.order()) {
      const testsPassed = await implement(slice);
      const verified = testsPassed > 0 && (await verify(slice));
      if (!verified) {
        // scope guard: sửa trong slice này, KHÔNG mở rộng
        results.push({ id: slice.id, testsPassed, verified: false, committed: false });
        continue;
      }
      results.push({ id: slice.id, testsPassed, verified, committed: true });
    }
    return results; // slice fail → không chặn slice sau (đánh dấu, báo leader)
  }
}

// Usage:
// const r = await new SliceRunner(slices, "vertical").run(implementSlice, verifySlice);
// → mỗi slice commit riêng, context chỉ giữ slice hiện tại
```

## Được

- ✅ Context window ổn định — chỉ giữ slice hiện tại, chống context rot
- ✅ Trạng thái luôn xanh — mỗi slice kết thúc bằng commit pass
- ✅ Fail isolate — slice fail không kéo sập feature
- ✅ 3 chiến lược cắt — chọn theo bản chất feature (risk-first cho auth)
- ✅ Scope guard — không sửa lan ra ngoài slice khi test fail

## Mất

- ❌ Slice-boundary overhead — feature xuyên slice (shared type) phải thiết kế trước
- ❌ Commit nhiều — history dày, cần squash nếu thích
- ❌ Verify cost — mỗi slice phải verify thật (chạy binary, không chỉ unit)

## Khác các hướng gần

| | Big-bang (làm cả rồi test) | Horizontal layer (model→view riêng) | XW: Vertical Slice |
|---|---|---|---|
| Đơn vị giao | cả feature | từng layer | **luồng user-visible** |
| Context rot | cao | trung bình | **thấp (slice nhỏ)** |
| Trạng thái | đỏ lâu | xanh giữa chừng | **luôn xanh sau mỗi slice** |

## Khi nào chọn

- Feature lớn vượt context window, cần chia nhỏ an toàn
- Muốn mỗi bước đều có commit xanh + telemetry trace
- Có session-branch + eval harness sẵn — XW thêm slice plan + runner
- Nối packages/core session-branch.ts (slice = branch con) + agent/exporters.ts (trace từng slice) + eval/harness.ts (verify); guard slice-scope (test fail không được sửa ngoài slice — review chặn), dependency-order (slice dependsOn phải chạy trước), và verify-commit-coupling (commit chỉ sau verify pass); XW = slice runner, kết hợp 646 XV assumption-surfacing-protocol (slice mang assumption riêng) + 648 XX five-axis-code-review (review slice trước commit)
