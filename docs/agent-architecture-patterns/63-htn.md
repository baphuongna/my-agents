# Hướng BK: HTN Planning — phân rã task có cấu trúc phương thức

> **Nguồn gốc:** Erol et al., 1994; SHOP2 (Nau et al., 2003); HTN + LLM 2025 (arXiv 2605.07707)
> **Coupling:** 🟢 — planner chạy trên task store, không phụ thuộc agent
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (kanban sẵn; method library + planner là build mới)
> **Effort:** 2-3 tuần

## Nguồn gốc

Hierarchical Task Network (HTN) planning — planning **formal** (không phải LLM tự do): task gốc → decompose bằng **method library** (tri thức miền: "task X → chạy các bước Y1..Yn nếu thỏa điều kiện C") → ra mạng task có thứ tự → còn primitive task (thực thi được) → chạy. Nếu ràng buộc vi phạm → **backtracking** chọn method khác. SHOP2 là planner HTN nổi nhất (2003, dùng trong DARPA). 2025: nghiên cứu sinh **method library bằng LLM** rồi thực thi deterministic (arXiv 2605.07707). Khác FFF Plan-and-Execute (LLM sinh plan tự do mỗi lần) — HTN tái dùng **cấu trúc đã biết tốt**, machine-checkable, deterministic.

## Mô tả

mya xây **method library** cho các loại task quen thuộc ("fix-bug", "add-feature", "refactor" — nhưng có cấu trúc thay vì prompt): mỗi method = precondition + các bước con (có thể là HTN con) + effect. Planner HTN nhận task → áp method → phân rã → kanban (I) nhận primitive tasks → executor chạy → kết quả verify (PP) → nếu fail: backtrack chọn method khác. LLM chỉ dùng để *soạn method mới* (khi thiếu), còn phân rã là deterministic. Khác EE Behavior Tree (cây quyết định thời điểm chạy, không phải decomposition theo task).

## Kiến trúc

```
  task "fix-bug" ──► HTN PLANNER (deterministic)
       │  method library: fix-bug → {pre: test-fail, steps: [repro, triage, patch, verify]}
       │  decompose đệ quy → mạng task (order + dep)
       ▼
  kanban (I): [repro, triage, patch, verify]  ──► executor chạy từng primitive
       │
       ├─ ok ──► verify tổng (PP) ──► done
       └─ constraint fail ──► BACKTRACK: method khác (nếu có)
                                     │
       thiếu method ──► LLM soạn method mới ──► lưu method library (học dần)
```

```
mya: kanban (I) + executor (XX) + verify (PP) sẵn
     thiếu: method library + planner HTN + backtracking
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools/src/kanban-sqlite.ts — task store cho mạng task (I)
// ✅ packages/print/src/role-subagent-spawn.ts — executor primitive tasks (XX)
// ✅ packages/eval — verify sau mỗi method (PP)
// ✅ packages/skills — nơi lưu method library dạng có cấu trúc (YY mở rộng)

// ❌ THIẾU: planner HTN (decompose deterministic + backtracking)
// ❌ THIẾU: method library format (precondition/effects — không phải skill text)
// ❌ THIẾU: LLM sinh method mới khi gap (training loop đơn giản)
```

## Implementation

```typescript
// packages/planner/src/htn.ts (NEW)
interface Method {
  name: string;                       // "fix-bug"
  preconditions: string[];            // test-fail, repo-clean
  steps: TaskNode[];                  // con: task hoặc method (đệ quy)
  effects: string[];                  // tests-green, code-changed
}

function plan(task: TaskNode, methods: Method[], trace = []): Task[] | null {
  for (const m of methods) {
    if (m.name !== task.name || !preconditionsHold(m)) continue;
    const expanded = m.steps.flatMap((s) => plan(s, methods, trace) ?? []);
    if (expanded !== null && constraintsOk(expanded)) return expanded;
    // fail → backtrack method tiếp theo
  }
  return null;                        // thiếu method → LLM sinh mới
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Deterministic: cùng task → cùng plan (so với LLM plan) | ❌ Method library phải xây + bảo trì |
| ✅ Backtracking: plan sai chọn lại method, không chạy sai tiếp | ❌ Miền mới không có method → tốn công soạn |
| ✅ Tri thức tái dùng: fix-bug lần 2 không cần LLM plan | ❌ Method cứng → task lạ không khớp |
| ✅ Đã có kanban + executor + eval — chỉ thêm planner | ❌ Overhead khi task nhỏ (planner > làm thẳng) |
| ✅ LLM chỉ lo phần "soạn method" — phần khó ổn định | |

## Khác các hướng gần

| | FFF Plan-and-Execute | EE Behavior Tree | LLL: HTN |
|---|---|---|---|
| Plan từ đâu | LLM mỗi lần (tự do) | Điều kiện thời điểm chạy | Method library (có cấu trúc) |
| Quyết định | Re-plan khi lệch | Node kiểm tra điều kiện | Decompose + backtrack |
| Đặc tính | Linh hoạt, kém ổn định | Reactive, real-time | Deterministic, học được |
| Dùng lại | Không trực tiếp | Tree tĩnh | ✅ Method tái dùng + sinh mới |

## Khi nào chọn

- Task lặp lại có quy trình rõ (fix-bug, add-feature, refactor)
- Muốn hành vi deterministic, audit được (không "mỗi lần khác nhau")
- Đã có kanban + executor + eval — thêm planner là chính
- Sẵn sàng duy trì method library (hoặc để LLM sinh method khi gap)