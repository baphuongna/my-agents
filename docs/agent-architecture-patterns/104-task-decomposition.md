# Hướng AAAAA: Task Decomposition — tách task lớn thành cây subtask có chốt kiểm

> **Nguồn gốc:** "Hierarchical LLM Multi-Agent with Task Decomposition" (arXiv 2602.21670, 2026); oneuptime 2026; emergentmind
> **Coupling:** 🟢 — tầng planning, agent không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (triage/plan sẵn; thiếu task tree + chốt)
> **Effort:** 1 tuần

## Nguồn gốc

Task decomposition: **LLM tách task lớn thành cây subtask** tới mức primitive (chạy được) — arXiv 2602.21670 (2026): "hierarchical multi-agent architecture that distributes task decomposition and allocation across layers"; oneuptime 2026: "breaking complex goals into manageable subtasks"; emergentmind: "LLM-based hierarchical TODO decomposition — improving accuracy and efficiency". Khác **3xg task splitting** (chia task workflow thường, gần như sequential steps) — AAAAA là *chiến lược đầy đủ*: task tree, primitive resolution (subtask đủ nhỏ để thực thi — executable primitives), **checkpoint giữa nhánh** (verify trước khi sang nhánh kế — nối UU/16), adaptive re-plan (task thay đổi → re-decompose — arXiv 2026 "adaptive"). Khác **YYY PDDL** (formal planning domain) — AAAAA linh hoạt dùng LLM không cần formal model; khác **FFF plan-execute** (2 pha: plan rồi execute nguyên bản) — AAAAA re-plan theo checkpoint.

## Mô tả

mya planner (triage — GG/UU có nền): (1) **decompose** — task → cây subtask (dependency + primitive check: mỗi lá ≤ ngưỡng size, có thể thực thi bằng tool có sẵn — nối XXXX); (2) **checkpoint** — mỗi nhánh: verify kết quả (16 grounded + GGGG/53) trước khi xuống nhánh kế — fail → re-do nhánh (RRRR) hoặc re-plan; (3) **adaptive** — trạng thái thay đổi giữa chừng → re-decompose nhánh (không nguyên bản cứng — khác FFF); (4) **đo** — số subtask thật cần vs dự tính (JJJ/QQQQ) → tinh chỉnh độ chi tiết decomposition (over-decompose = tốn, under = vỡ). Nối kanban: task tree → kanban board (24/25 sẵn — subtask thành item theo dõi được, YYYY anti-hack: done phải kèm chứng cứ mỗi lá).

## Kiến trúc

```
  TASK ──► DECOMPOSE (LLM — GG/UU)
      └── TREE: subtask (dependency) ──► primitive check (tool có sẵn? — XXXX)
                 │
                 ▼
  EXECUTE nhánh (từng lá — kanban item 24/25)
        │  checkpoint: VERIFY (16/GGGG/53) — chứng cứ (YYYY)
        │    ├─ OK ──► lá kế (dependency)
        │    └─ fail ──► re-do (RRRR) | re-plan nhánh (adaptive — arXiv 2026)
        ▼
  TRẠNG THÁI đổi giữa chừng ──► RE-DECOMPOSE nhánh (không cứng — FFF khác)
        ▼
  đo: subtask thực vs dự tính (JJJ/QQQQ) → tinh chỉnh độ chi tiết
```

```
mya: triage (GG) + UU escalate + kanban SẴN — thiếu decompose planner + checkpoints
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ GG supervisor + UU escalate — triage nền (nơi thêm decompose)
// ✅ tools/kanban-sqlite — board (task tree → items 24/25)
// ✅ 16 grounded + GGGG/53 — checkpoint verify
// ✅ RRRR recovery — re-do nhánh khi fail
// ✅ YYYY anti-hack — done kèm chứng cứ mỗi lá
// ✅ XXXX tools — primitive check (subtask chạy được bằng tool nào)

// ❌ THIẾU: decompose planner (task → tree có dependency)
// ❌ THIẾU: primitive resolution (lá đủ nhỏ + tool khả dụng)
// ❌ THIẾU: adaptive re-decompose (trạng thái đổi giữa chừng)
```

## Implementation

```typescript
// packages/planning/src/decompose.ts (NEW)
interface Subtask { id: string; goal: string; deps: string[]; primitive: boolean; }

function decompose(goal: string, tools: ToolIndex): SubtaskTree {
  const root = llmDecompose(goal);                     // LLM tách
  return {
    ...root,
    leaves: root.leaves.map((l) =>
      l.size > MAX_SUBTASK || !tools.has(l.needTool)
        ? decompose(l.goal, tools)                     // chưa primitive → tách tiếp
        : { ...l, primitive: true }),                  // lá thực thi được
  };
}
// checkpoint: sau mỗi lá verify (16/GGGG) — fail → redo (RRRR) / re-plan
// adaptive: state đổi → re-decompose nhánh (arXiv 2602.21670 "adaptive")
// kanban: tree → items (24/25) — theo dõi + chứng cứ (YYYY)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Task lớn chia được — chạy từng phần chắc chắn | ❌ Over-decompose = tốn token/latency |
| ✅ Checkpoint mỗi nhánh — fail sớm không vỡ toàn cục | ❐ LLM decompose sai dependency → kẹt |
| ✅ Adaptive re-plan — thay vì FFF cứng nhắc | ❌ Tree sâu = quản lý phức tạp |
| ✅ Nối kanban + checkpoint + YYYY chứng cứ | ❌ Cần theo dõi độ chi tiết (JJJ) |

## Khác các hướng gần

| | 3xg Task Splitting | FFF Plan-Execute | AAAAA: Decompose |
|---|---|---|---|
| Cấu trúc | Steps gần tuần tự | Plan nguyên bản | **Task tree + dependency** |
| Verify | Không | Không | **Checkpoint mỗi nhánh** |
| Re-plan | Không | Không | **Adaptive (2026)** |
| Mối quan hệ | Nền | Gần | **Mở rộng cả hai** |

## Khi nào chọn

- Task lớn liên tục vỡ giữa chừng (JJJ đo được)
- Nhiều dependency giữa phần việc
- Đã có triage + kanban + verify — thêm decompose planner
- Chấp nhận theo dõi chi tiết để chỉnh độ tách