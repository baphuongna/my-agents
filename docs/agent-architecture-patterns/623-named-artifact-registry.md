# Hướng WY: Named Artifact Registry — state.named tích lũy artifact theo tên (slot array, latest-wins); stage multi-input khai báo reads:

> **Nguồn gốc:** rpiv-mono (named registry); "state.named accumulate by name", "slot array, latest-wins", "stage multi-input declares reads:" | **Coupling:** 🟢 — thêm named artifact store (pure data registry) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (spill + session state sẵn — chưa có named-slot registry + reads declaration) | **Effort:** 2-3 tuần

## Nguồn gốc

**rpiv-mono** giữ **artifact** (output stage) trong **`state.named`** — registry tích lũy artifact theo **tên**. Mỗi tên là một **slot**: nhiều stage có thể ghi cùng tên → slot giữ **array** (tất cả giá trị từng ghi), nhưng resolve mặc định **latest-wins** (giá trị mới nhất). Stage cần nhiều artifact → khai báo `reads: ["report", "schema"]` (multi-input) → engine nạp các slot đó vào scope stage. Nguyên tắc: **artifact có tên, tích lũy, latest-wins** — stage không nhận raw payload mà nhận theo tên đã khai báo, dữ liệu trace được (ai ghi "report", khi nào).

## Mô tả

mya named artifact registry: mỗi artifact ghi vào `state.named[name]` (slot array). Resolve `latest(name)` trả giá trị mới nhất; `all(name)` trả cả lịch sử. Stage khai báo `reads` → engine inject artifact đã resolve. mya có spill + session state — WY thêm **named-slot registry** + **latest-wins resolve** + **reads declaration**.

## Kiến trúc

```
  ┌─── state.named (registry theo tên) ──────────────────┐
  │  "report":  [ {stage:A, v:1}, {stage:B, v:2} ]  slot   │  ← array (tích lũy)
  │  "schema":  [ {stage:A, v:s1} ]                  slot   │
  │  "config":  [ {stage:C, v:c1}, {stage:D, v:c2} ] slot   │
  └───────────────────────┬───────────────────────────────┘
                          │
                          ▼  resolve (latest-wins)
  ┌─── latest-wins ──────────────────────────────────────┐
  │  latest("report") → v:2 (stage B, mới nhất)             │
  │  latest("config") → v:c2 (stage D)                      │
  └───────────────────────┬───────────────────────────────┘
                          │
                          ▼  stage khai báo reads
  ┌─── STAGE E (reads: ["report", "schema"]) ────────────┐
  │  ctx.artifacts = { report: latest("report"),             │  ← multi-input
  │                    schema: latest("schema") }            │
  │  → stage nhận artifact đã resolve theo tên khai báo      │
  └─────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/core spill.ts — data carry (nền — WY artifact spill)
// ✅ packages/core session.ts — session state (nền — WY state.named)
// ✅ packages/workflows worker.ts — worker scope (nền — WY inject reads)

// ❌ THIẾU: named-slot registry (state.named, array per name)
// ❌ THIẾU: latest-wins resolve (latest/all)
// ❌ THIẾU: reads declaration (stage multi-input theo tên)
```

## Implementation

```typescript
// packages/workflows/src/named-registry.ts (MỚI)
interface SlotEntry { stage: string; value: unknown }

class NamedRegistry {
  private slots = new Map<string, SlotEntry[]>();
  // ghi artifact theo tên → push vào slot array
  write(name: string, stage: string, value: unknown): void {
    const arr = this.slots.get(name) ?? [];
    arr.push({ stage, value });
    this.slots.set(name, arr);
  }
  // latest-wins: giá trị mới nhất
  latest(name: string): unknown { const arr = this.slots.get(name); return arr?.at(-1)?.value; }
  // toàn bộ lịch sử slot
  all(name: string): SlotEntry[] { return this.slots.get(name) ?? []; }
}

// stage khai báo reads → engine inject artifact resolve
interface ReadStage {
  reads: string[]; // tên artifact cần
  run: (artifacts: Record<string, unknown>) => Promise<void>;
}

async function runWithReads(reg: NamedRegistry, stage: ReadStage): Promise<void> {
  const artifacts: Record<string, unknown> = {};
  for (const name of stage.reads) artifacts[name] = reg.latest(name); // resolve + inject
  await stage.run(artifacts);
}

// Usage:
// reg.write("report", "A", buildReport());
// reg.write("report", "B", revisedReport()); // slot = [v1, v2]
// reg.latest("report"); // → v2 (latest-wins)
// await runWithReads(reg, { reads: ["report","schema"], run: async (a) => use(a.report) });
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Artifact có tên, trace (ai ghi, khi nào) | ❌ Slot phình (array tích lũy, không prune) |
| ✅ Latest-wins đơn giản (resolve mặc định mới nhất) | ❌ Latest-bias (stage vô tình dùng giá trị cũ nếu không hiểu resolve) |
| ✅ Multi-input (stage reads nhiều artifact) | ❌ Name collision (hai nhóm dùng cùng tên) |
| ✅ History giữ (all() truy lịch sử) | ❌ Reads-declaration verbosity (mỗi stage list reads) |

## Khác các hướng gần

| | Positional payload | Global state bag | WY: Named-Registry |
|---|---|---|---|
| Tên | ❌ (theo thứ tự) | key tùy ý | **✅ slot theo tên** |
| Lịch sử | ❌ | overwrite | **✅ array (latest + all)** |
| Multi-input | theo param | implicit | **✅ reads declaration** |

## Khi nào chọn

- Artifact cần tích lũy theo tên + trace lịch sử + latest-wins resolve
- Stage cần nhiều artifact đầu vào (multi-input reads)
- Nối packages/core spill.ts + session.ts + packages/workflows worker.ts; guard slot-pruning (capped history, không phình), name-namespace (prefix tên theo stage nhóm tránh collision), và reads-validation (warn khi reads tên chưa từng ghi → undefined inject); WY = named artifact registry, kết hợp 619 WU produces-acts-terminal-factories (produces ghi vào named) + 620 WV outcome-collector-parser-validator (parser đọc named artifact)
