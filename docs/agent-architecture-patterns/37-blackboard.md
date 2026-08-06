# Hướng LL: Blackboard — shared problem-solving state, knowledge sources

> **Nguồn gốc:** Hearsay-II speech recognition (Erman, Hayes-Roth, Lesser, 1980)
> **Coupling:** 🟡 Shared state — mọi KS đọc/ghi cùng blackboard
> **Agent-agnostic:** ⚠️ — agents phải cooperate (đọc/ghi shared state)
> **Code sẵn:** ⚠️ (1 phần — memory graph, governance, kanban; thiếu control module)
> **Effort:** 1-2 tuần

## Nguồn gốc

Hearsay-II (1980): một **blackboard** — workspace dùng chung lưu partial solutions — và các **knowledge sources (KS)** độc lập. KS quan sát blackboard, chỉ kích hoạt khi có dữ liệu chúng xử lý được ("opportunistic"), viết kết quả lại lên blackboard. Không KS nào gọi trực tiếp KS khác; **control module** quyết định KS nào chạy khi nào. Khác Tuple Space (Hướng U): tuple-space là *messaging vô danh*, blackboard là *state giải bài toán dùng chung* với ngữ nghĩa theo phase.

## Mô tả

Blackboard = nguồn sự thật cho *trạng thái hiện tại của task*: file nào đã sửa, kết luận nào đã chốt, lỗi nào còn tồn đọng. Các agents (KS) đăng ký "tôi xử lý loại dữ liệu X", control loop kích hoạt chúng theo pha: parse → phân tích → viết code → review → cập nhật blackboard. Agent không cần biết agent khác tồn tại — chỉ cần biết blackboard.

## Kiến trúc

```
┌──────────────────────────────────────────────────────────────┐
│                       BLACKBOARD (SQLite)                     │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐          │
│  │ TaskState    │ │ Findings     │ │ Decisions    │          │
│  │ files[]      │ │ bug: 3       │ │ "use napi-rs │          │
│  │ stage: code  │ │ open: 1      │ │  for hot     │          │
│  │ owner: pi    │ │ closed: 2    │ │  path"       │          │
│  └──────────────┘ └──────────────┘ └──────────────┘          │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │               CONTROL MODULE (mya)                    │    │
│  │  loop:                                                │    │
│  │    changed = blackboard.poll()                        │    │
│  │    for ks in knowledgeSources:                        │    │
│  │      if ks.triggers(changed): activate(ks)            │    │
│  │    if taskDone(blackboard): exit                      │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐      │
│  │ KS: parser    │ │ KS: analyzer  │ │ KS: writer    │      │
│  │ (reads files) │ │ (finds bugs)  │ │ (writes code) │      │
│  └───────────────┘ └───────────────┘ └───────────────┘      │
│        KS kích hoạt theo dữ liệu, không biết nhau             │
└──────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// packages/memory/src/graph.ts — knowledge graph = blackboard lõi
// packages/memory/src/governance.ts — grounding: fact phải nối vào source
// packages/memory/src/brain-store.ts — brain: facts + takes + tombstones
// packages/kanban (kanban-sqlite) — task state dùng chung giữa agents
// packages/council — findings từ reviewer (đã là KS thụ động)

// THIẾU: control module + KS registry + trigger conditions.
// Hiện nay state phân tán (brain + kanban + session files) — blackboard
// pattern là luận cứ để hợp nhất vào MỘT nơi + định nghĩa trigger.
```

## Implementation

```typescript
// packages/blackboard/src/index.ts (NEW)
export interface KnowledgeSource {
  name: string;
  triggers: Array<"file_changed" | "finding_added" | "decision_made" | "stage_changed">;
  run(ctx: BlackboardContext): Promise<void>;
}

class BlackboardControl {
  private ks: KnowledgeSource[] = [];

  register(source: KnowledgeSource): void {
    this.ks.push(source);
  }

  async loop(): Promise<void> {
    while (!this.isTaskDone()) {
      const changed = await this.pollChanges();     // fs.watch + SQLite
      for (const source of this.ks) {
        if (source.triggers.some(t => changed.has(t))) {
          log(`[blackboard] activate ${source.name}`);
          await source.run({ blackboard: this.board, changes: changed });
        }
      }
      await sleep(100);                              // cooldown
    }
  }
}

// VD: reviewer KS chỉ chạy khi stage → "code"
const reviewer: KnowledgeSource = {
  name: "reviewer",
  triggers: ["stage_changed"],
  async run({ blackboard }) {
    if (blackboard.get("stage") !== "code") return;
    const findings = await spawnAgent("claude", "review staged files");
    blackboard.set("findings", findings);
    blackboard.set("stage", findings.length ? "fix" : "done");
  },
};
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Một nơi nhìn toàn bộ tiến độ task | ❌ Mọi KS chạy qua blackboard (bottleneck) |
| ✅ KS độc lập, thêm/bớt dễ | ❌ Control module phức tạp (chọn KS nào chạy) |
| ✅ Không cần agents biết nhau | ❌ Cần cooperation (agents phải đọc/ghi state) |
| ✅ Trạng thái nhất quán (single source) | ❌ Nếu một KS ghi sai → toàn bộ sai |
| ✅ AI classic, đã chứng minh | ❌ Schema evolution của blackboard |

## Khác Tuple Space (Hướng U)

| | U: Tuple Space | LL: Blackboard |
|---|---|---|
| Đơn vị | Tuple (message vô danh) | State giải bài toán + partial solutions |
| Kích hoạt | Agent tự *blocking-read* tìm việc | Control module *chủ động* kích hoạt KS |
| Ngữ nghĩa | Queuing / rendezvous | Theo phase của task |
| Agent tự do | Tự chọn việc | KS chỉ chạy khi trigger khớp |

## Khi nào chọn

- Nhiều agents làm CHUNG một task (cùng bàn bài toán)
- Muốn nhìn toàn bộ tiến độ ở một nơi
- Đã có brain + kanban, muốn hợp nhất thành một blackboard có trigger
- Muốn control loop chủ động (khác tuple-space thụ động)
- OK với việc agents cooperate qua shared state
