# Hướng YA: Session Log Backstate — goal.ts lưu mọi state transition thành custom session entries append-only rồi reconstruct từ active branch khi reload/tree navigation — không cần database ngoài, sống qua compaction (extensions/goal.ts)

> **Nguồn gốc:** agent-stuff (extensions/goal.ts) | **Coupling:** 🟢 — session entries append-only, không đổi core | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có session-branch + JSONL — chưa có backstate reconstruction) | **Effort:** 2-3 tuần

## Nguồn gốc

**agent-stuff** mở rộng `goal.ts` cho session tracking: mọi **state transition** (goal mới, goal hoàn thành, goal bị hủy, ưu tiên đổi) được ghi thành **custom session entries** — append-only log nằm ngay trong session file, không phải database riêng. Khi **reload** session hoặc **tree navigation** (đi tới nhánh khác), trạng thái goal **reconstruct** bằng cách replay các entries từ active branch. Nhờ append-only + reconstruct, hệ thống **sống qua compaction** — session bị nén/compact vẫn giữ entries, trạng thái dựng lại được.

## Mô tả

mya áp dụng session-log-backstate: mỗi mutation trạng thái (goal, todo, kanban column) ghi một **entry** vào session log dạng `{ ts, type, payload }` — append-only, không sửa/xóa entry cũ. Backstate = hàm `reconstruct(branch)` đọc các entries của active branch (theo session-branch chain) rồi replay theo thứ tự thời gian → ra trạng thái hiện tại. Khi compaction nén history, entries **không bị nén mất** (chỉ nén message text, entries trạng thái giữ nguyên — hoặc tái sinh qua replay). mya có sẵn core/session-branch.ts (branch chain + childType), session.ts (History array), spill (payload lớn) — YA thêm **state entry schema** + **reconstruct engine**.

## Kiến trúc

```
  Mutation ──► SESSION LOG (append-only, trong session file)
    goal.add      { ts: 1, type: "goal.add", payload: {id:"G1", text:"ship v2"} }
    goal.done     { ts: 2, type: "goal.done", payload: {id:"G1"} }
    goal.priority { ts: 3, type: "goal.prio", payload: {id:"G2", prio: 1} }

  Reload / tree navigation:
    ┌─ session-branch chain ─┐
    │ parent ─► branch A ─► branch B (active)  │
    └───────────┬────────────┘
                ▼
    reconstruct(B): replay entries của chain
      G1: added → done        ⇒ completed
      G2: added → prio=1      ⇒ active, prio 1
                ▼
    Compaction: nén message text, GIỮ state entries → reconstruct vẫn chạy
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core session-branch.ts — branch chain + branchedFrom (nền — YA active branch)
// ✅ packages/core session.ts — History append (nền — YA entry sink)
// ✅ packages/core spill.ts — payload > 256KiB → ref (nền — YA entry payload lớn)
// ✅ packages/core session-utils.ts — session file handling (nền — YA JSONL)

// ❌ THIẾU: state entry schema (goal/todo mutation dạng entry)
// ❌ THIẾU: reconstruct engine (replay entries theo branch chain)
// ❌ THIẾU: compaction rule (nén text, giữ state entries)
```

## Implementation (TS)

```typescript
// packages/core/src/backstate.ts (MỚI)
export type StateEntry =
  | { ts: number; type: "goal.add"; payload: { id: string; text: string } }
  | { ts: number; type: "goal.done"; payload: { id: string } }
  | { ts: number; type: "goal.prio"; payload: { id: string; prio: number } };

export interface Goal {
  id: string;
  text: string;
  status: "active" | "completed";
  prio: number;
}

export class Backstate {
  private log: StateEntry[] = []; // append-only

  append(e: StateEntry): void {
    this.log.push(e); // không sửa/xóa entry cũ
  }

  /** Reconstruct từ active branch — replay entries theo thứ tự ts. */
  reconstruct(branchEntries: StateEntry[][]): Map<string, Goal> {
    const goals = new Map<string, Goal>();
    const replay = (entries: StateEntry[]) => {
      for (const e of entries) {
        if (e.type === "goal.add") goals.set(e.payload.id, { ...e.payload, status: "active", prio: 0 });
        else if (e.type === "goal.done") { const g = goals.get(e.payload.id); if (g) g.status = "completed"; }
        else if (e.type === "goal.prio") { const g = goals.get(e.payload.id); if (g) g.prio = e.payload.prio; }
      }
    };
    for (const chain of branchEntries) replay(chain); // parent → branch → active
    return goals;
  }

  /** Compaction: trả entries cần giữ (state) — message text nén riêng. */
  compactKeep(): StateEntry[] {
    return this.log.filter((e) => e.type !== "message"); // state entries sống qua compaction
  }
}

// Usage:
// const bs = new Backstate();
// bs.append({ ts: 1, type: "goal.add", payload: { id: "G1", text: "ship v2" } });
// bs.append({ ts: 2, type: "goal.done", payload: { id: "G1" } });
// const goals = bs.reconstruct([parentLog, branchLog]);
// goals.get("G1")?.status; // "completed" — dựng lại sau reload
```

## Được

- ✅ Không cần database ngoài — trạng thái sống trong session file
- ✅ Append-only — không conflict ghi, replay deterministic
- ✅ Sống qua compaction — state entries giữ khi nén history
- ✅ Tree navigation — reconstruct theo branch chain, mỗi nhánh trạng thái riêng
- ✅ Crash-safe — mất giữa chừng chỉ mất entry cuối, replay lại được

## Mất

- ❌ Replay cost — branch dài, entries nhiều → reconstruct chậm dần
- ❌ Schema migration — đổi StateEntry type phải migrate log cũ
- ❌ Branch merge — hai nhánh cùng sửa goal → conflict cần resolve (mya có conflict.ts)

## Khác các hướng gần

| | State trong DB riêng | Snapshot định kỳ | YA: Session Log Backstate |
|---|---|---|---|
| Nguồn sự thật | DB ngoài session | snapshot file | **session entries append-only** |
| Recovery | query DB | snapshot gần nhất | **replay toàn bộ chain** |
| Compaction | không liên quan | snapshot cũ mất | **state entries sống sót** |

## Khi nào chọn

- Goal/todo/kanban cần sống qua reload + compaction mà không muốn DB riêng
- Cần tree navigation với trạng thái riêng từng nhánh (nối session-branch)
- Có session-branch + session-utils sẵn — YA thêm entry schema + reconstruct
- Nối packages/core session-branch.ts (chain) + session.ts (append) + memory/conflict.ts (branch conflict); guard replay-order (ts tăng dần, tie-break theo branch depth), compaction-keep (state entries không bị nén — test), và schema-migration (StateEntry v2 đọc log v1 — versioned); YA = backstate, kết hợp 651 kế tiếp YB file-backed-todo-store (todo độc lập session — so sánh hai cách) + 639 incremental-fingerprint-analysis (reconstruct nhanh qua fingerprint)
