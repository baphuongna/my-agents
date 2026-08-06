# Hướng UO: Outline-First Research — Phase 1 chia nghiên cứu thành items + fields framework; outline tạo trước rồi duyệt lại với user qua AskUser(tool)

> **Nguồn gốc:** Deep-Research-skills `research/` (`outline_phase.py`, `AskUser` tool, `fields_framework`); "Phase 1 create outline first"; "split research into items + fields"; "review outline with user before searching"; "structured research plan" | **Coupling:** 🟢 — thêm outline-first planner + AskUser gate vào research workflow | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (workflows + subagents sẵn — chưa có outline-planner + user-review gate) | **Effort:** 2-3 tuần

## Nguồn gốc

**Deep-Research-skills** không nhảy thẳng vào search — mà **Phase 1 tạo outline trước**: chia đề tài nghiên cứu thành **items** (mảng con cần điều tra) + **fields framework** (mỗi item cần thu thập field nào: định nghĩa, ví dụ, nguồn, mối quan hệ). Outline này được **review với user** qua **AskUser(tool)** trước khi bắt đầu search — user xác nhận/chỉnh sửa hướng nghiên cứu. Nguyên tắc: **kế hoạch trước, dữ liệu sau** — outline định scope, tránh agent搜 lạc đề, tốn token搜 sai hướng. Khác search-first (nhảy thẳng vào search) — UO **plan-then-execute with human gate**.

## Mô tả

mya outline-first research: (1) **Outline generation**: từ đề tài → sinh items (mảng con) + mỗi item có fields framework (cần thu thập gì). (2) **AskUser gate**: trình outline cho user → user xác nhận/chỉnh sửa/bổ sung. (3) **Execute**: mỗi item → subagent search + thu thập theo fields. (4) **Assemble**: gộp kết quả theo outline framework. mya có workflows + subagents — UO thêm **outline-planner** + **AskUser review gate** + **fields-driven execution**.

## Kiến trúc

```
  USER: "nghiên cứu về consensus algorithm"
        │
        ▼
  ┌─── OUTLINE PHASE (tạo trước) ─────────────────────────┐
  │  items: [Paxos, Raft, PBFT, BFT variants]              │
  │  fields/framework: { định nghĩa, ví dụ, nguồn,         │
  │    độ phức tạp, khi nào dùng }                         │
  └───────────────────────┬─────────────────────────────┘
                          │ (trình outline)
                          ▼
  ┌─── AskUser GATE (review với user) ────────────────────┐
  │  "Outline OK? [items + fields]"                         │
  │  user: "thêm Nakamoto consensus" / "OK"                 │
  └───────────────────────┬─────────────────────────────┘
                          │ (xác nhận)
                          ▼
  ┌─── EXECUTE (mỗi item → search + thu thập fields) ────┐
  │  Raft → { định nghĩa, ví dụ, nguồn, … }                │
  │  Paxos → { … }                                          │
  └───────────────────────┬─────────────────────────────┘
                          ▼
  ASSEMBLE: báo cáo theo outline framework
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/workflows — workflow engine (nền — UO outline phase)
// ✅ packages/agent subagent — per-item research (nền — UO execute)
// ✅ 132 human-in-the-loop — AskUser gate (nền — UO review gate)

// ❌ THIẾU: outline-planner (topic → items + fields framework)
// ❌ THIẾU: AskUser tool binding (trình outline → user confirm/edit)
// ❌ THIẾU: fields-driven executor (thu thập theo framework)
// ❌ THIẾU: outline-assemble (gộp theo framework)
```

## Implementation

```typescript
// packages/workflows/src/outline-research.ts (MỚI)
interface ResearchItem { id: string; topic: string }
interface FieldDef { name: string; desc: string; required: boolean }
interface Outline { topic: string; items: ResearchItem[]; fields: FieldDef[] }

class OutlineResearch {
  constructor(
    private plan: (topic: string) => Promise<Outline>,
    private askUser: (msg: string, opts: string[]) => Promise<string>,
    private search: (item: ResearchItem, fields: FieldDef[]) => Promise<Record<string, string>>,
  ) {}

  // Phase 1: outline + review gate
  async phase1(topic: string): Promise<Outline> {
    let outline = await this.plan(topic);
    // AskUser gate: user review → confirm/edit
    const verdict = await this.askUser(
      `Outline:\n${outline.items.map(i => `- ${i.topic}`).join('\n')}\nFields: ${outline.fields.map(f => f.name).join(', ')}\nOK? (yes / edit / thêm item)`,
      ['yes', 'edit', 'add'],
    );
    if (verdict === 'edit') outline = await this.plan(topic + ' (revise per user)'); // revise
    return outline;
  }

  // Phase 2: execute (mỗi item → search + fields)
  async phase2(outline: Outline): Promise<Record<string, Record<string, string>>> {
    const results: Record<string, Record<string, string>> = {};
    for (const item of outline.items) {
      results[item.id] = await this.search(item, outline.fields); // thu thập theo framework
    }
    return results;
  }

  // assemble: gộp theo outline framework
  assemble(outline: Outline, results: Record<string, Record<string, string>>): string {
    return outline.items
      .map(i => `## ${i.topic}\n${outline.fields.map(f => `- ${f.name}: ${results[i.id]?.[f.name] ?? '∅'}`).join('\n')}`)
      .join('\n\n');
  }
}

// Usage:
// const research = new OutlineResearch(planLLM, askUserTool, searchFn);
// const outline = await research.phase1("consensus algorithm"); // review gate
// const results = await research.phase2(outline);
// const report = research.assemble(outline, results);
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Scope kiểm soát (outline định hướng trước search) | ❌ Gate latency (user phải duyệt → chậm) |
| ✅ User alignment (xác nhận hướng trước khi tốn token) | ❌ Outline sai (plan sai scope ban đầu) |
| ✅ Fields framework (thu thập có cấu trúc) | ❌ Rigid framework (field cố định → thiếu linh hoạt) |
| ✅ Traceable (mỗi item có field rõ) | ❌ Overhead (plan phase tốn thêm 1 bước) |

## Khác các hướng gần

| | Search-First | 132 Human-in-the-Loop | UO: Outline-First |
|---|---|---|---|
| Cái gì | Nhảy thẳng search | Gate từng bước | **Plan outline → duyệt → execute** |
| Scope | ❌ (lạc đề) | ⚠️ | **✅ items + fields** |
| User gate | ❌ | ✅ | **✅ outline gate** |

## Khi nào chọn

- Nghiên cứu phức tạp (nhiều mảng con) → cần scope rõ trước search
- Muốn user alignment (xác nhận hướng trước khi tốn token)
- Cần thu thập có cấu trúc (fields framework)
- Nối packages/workflows + packages/agent subagent + 132 human-in-the-loop; guard outline quality (plan chính xác scope), gate UX (user dễ confirm/edit), và framework flexibility (cho phép thêm field runtime); UO = outline-first research, kết hợp 104 task-decomposition (chia items) + VA parallel-source-silo-agents (execute song song)
