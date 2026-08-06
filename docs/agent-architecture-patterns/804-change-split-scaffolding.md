# Hướng ADX: Change Split Scaffolding — chia change lớn thành slice mergeable độc lập

> **Nguồn gốc:** OpenSpec | **Coupling:** 🟢 — CLI scaffolding, không đụng runtime | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn workflows; thiếu split CLI) | **Effort:** 1 tuần

## Nguồn gốc

**OpenSpec** task **add-change-stacking-awareness/tasks.md** định nghĩa **`openspec change split <id>`**: scaffold **child slices** kèm **parent/dependency metadata** và **stub proposal/tasks** cho mỗi slice. Change nguồn được chuyển thành **parent planning container** — không còn chứa implementation mà chỉ điều phối.

Hai rule quan trọng: (1) **re-split bị chặn** trừ khi `--overwrite` — không chia lại vô tội vạ lên slices đã có content; (2) mục tiêu là **slice mergeable độc lập** — mỗi slice có proposal + tasks stub, merge được riêng, không kẹt chờ nhau. Pattern khuyến khích chia change lớn từ sớm thay vì để nguyên khối khổng lồ.

## Mô tả

Với mya, split CLI nằm trong `packages/workflows` (hoặc tools): `mya change split <id>` đọc change (YAML — nối ADV), phân tích scope, sinh N child slices: mỗi slice có parent metadata (nối ADW `parent` field), dependency (dependsOn/requires), stub proposal + tasks. Parent trở thành planning container chỉ có danh sách con. `--overwrite` guard chống re-split phá slices đã có content. Slice có thể chạy qua `runStagedWorkflow` (nối ADF) như change độc lập. `packages/eval` verify mỗi slice mergeable (tests chạy độc lập).

## Kiến trúc (ASCII)

```
  CHANGE LỚN C1 (implementation khổng lồ)
    │
    ▼ openspec change split C1
  PARENT C1 (planning container — không còn implementation)
    ├─ slice C1.1: proposal.md + tasks.md stub
    │    parent: C1 · dependsOn: [] · merge độc lập
    ├─ slice C1.2: proposal.md + tasks.md stub
    │    parent: C1 · dependsOn: [C1.1]
    └─ slice C1.3: proposal.md + tasks.md stub
         parent: C1 · dependsOn: [C1.1] (touches C1.2)
            │
            ▼
  MỖI SLICE mergeable độc lập (test chạy riêng)
  ⚠️ re-split bị chặn trừ khi --overwrite
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/workflows — WorkflowContext + runner (chạy slice như change)
// ✅ packages/memory — Brain SQLite (lưu slice metadata)
// ✅ packages/tools — hashline-edit (nền scaffold file an toàn)
// ✅ packages/eval — tiers (verify slice mergeable độc lập)
// ✅ packages/audit — AuditLog (ghi hành động split)

// ❌ THIẾU: split CLI (phân tích scope → sinh slices)
// ❌ THIẾU: stub generator (proposal.md + tasks.md theo template — nối ADV)
// ❌ THIẾU: --overwrite guard chống re-split phá content
```

## Implementation

```typescript
// packages/workflows/src/split.ts (NEW)
export interface SliceStub {
  id: string;             // C1.1, C1.2...
  parent: string;         // C1
  dependsOn: string[];
  touches: string[];
  files: { path: string; content: string }[];
}

export async function splitChange(
  changeId: string,
  scope: string[],
  opts: { overwrite?: boolean },
): Promise<SliceStub[]> {
  const parentDir = join(".changes", changeId);
  const existing = readdirSync(parentDir).filter((f) => f !== "proposal.md");
  if (existing.length > 0 && !opts.overwrite) {
    throw new Error("re-split bị chặn — dùng --overwrite nếu chắc chắn");
  }

  // phân tích scope → nhóm file thành slices độc lập (theo seam — nối ADT)
  const groups = groupBySeam(scope);
  const slices: SliceStub[] = groups.map((files, i) => {
    const id = `${changeId}.${i + 1}`;
    return {
      id,
      parent: changeId,
      dependsOn: i === 0 ? [] : [slicesFor(i - 1)],   // chain dependency
      touches: i === 0 ? [] : files.slice(0, 2),      // advisory
      files: [
        { path: join(parentDir, id, "proposal.md"), content: stubProposal(id, files) },
        { path: join(parentDir, id, "tasks.md"), content: stubTasks(files) },
      ],
    };
  });

  // parent thành planning container (chỉ danh sách con)
  writeFileSync(join(parentDir, "proposal.md"), parentContainer(changeId, slices));
  for (const s of slices) for (const f of s.files) writeFileSync(f.path, f.content);
  return slices;
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Change lớn thành slice merge được riêng | ❌ Phân nhóm theo seam cần heuristic tốt |
| ✅ Parent là planning container — dễ theo dõi | ❌ Dependency chain sai → slice kẹt |
| ✅ Stub proposal/tasks có sẵn — bắt đầu ngay | ❌ Nhiều slice → overhead review từng cái |
| ✅ --overwrite guard chống phá content | ❌ Split sớm quá → slice vô nghĩa |

## Khác các hướng gần

| | ADX Split Scaffolding | ADW Change Stacking | ADI Intake Lanes |
|---|---|---|---|
| Trọng tâm | Chia change lớn | Metadata + graph | Phân loại prompt |
| Output | Child slices + stubs | change next (topo) | Work item + lane |
| Nối | ADW (parent/dependsOn) | ADX (slices) | ADX (change → slices) |

## Khi nào chọn

- Change lớn không merge nổi — cần chia từ sớm
- Slice có thể merge/test độc lập
- Đã có workflows + templates — thêm split CLI
- Muốn parent là planning container rõ ràng