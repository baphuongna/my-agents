# Hướng RC: Phase Topics Broadcast — Gemini update_topic publish chapter title+summary mỗi phase

> **Nguồn gốc:** Leaks Gemini CLI (`update_topic` tool); "publish topic updates as you work"; "chapter title + summary per phase"; "update_topic in first and last turn"; "topic = discrete subgoal every 3-10 turns"; "strategic detour topic on unexpected event"
> **Coupling:** 🟢 — thêm phase-topic broadcaster tool vào agent loop (publish per phase transition)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (lifecycle-hooks + progress sẵn — chưa có update_topic broadcaster)
> **Effort:** 1-2 tuần

## Nguồn gốc

**Leaks Gemini CLI** quy định `update_topic`: agent **publish topic updates** để user theo dõi — gọi `update_topic` ở **turn đầu + cuối** (cuối recap), mỗi khi **đổi topic** (topic = subgoal rời rạc, mỗi 3-10 turn), và khi **strategic detour** (test-fail/compile-error/unexpected event → publish "strategic detour" topic). Mỗi topic = **chapter title + summary** ("Researching Parser", "Implementing Buffer Fix" + tóm tắt phase). Nguyên tắc: **progress broadcast structured** — user không phải đoán agent đang làm gì; mỗi phase = 1 chapter có tiêu đề + tóm tắt. Khác **099 progressive-disclosure** (UI) — RC là **semantic chapter broadcast**; khác output thuần — RC là **structured progress topic**.

## Mô tả

mya phase topics broadcast: (1) **Phase detect**: agent chia task thành phases (research → implement → test), mỗi phase = topic. (2) **Broadcast**: mỗi phase transition → `update_topic(title, summary)` — tiêu đề ngắn + tóm tắt (đang làm gì, goal, transition). (3) **Cadence**: turn đầu (announce), cuối (recap), mỗi 3-10 turn (phase change), strategic detour (unexpected event). (4) **Render**: user UI hiển thị chapter list (title + summary) → theo dõi progress. mya có `292 lifecycle-hooks` + progress — RC thêm **phase detector** + **update_topic tool** + **chapter log**.

## Kiến trúc

```
  AGENT TASK: "fix parser timeout bug"
        │
        ▼
  ┌─── PHASE DETECTION ──────────────────────────────────┐
  │  turn 1 (start):  PHASE 1 "Researching Parser"        │
  │  turn 5 (done research): PHASE 2 "Implementing Fix"   │
  │  turn 8 (test fail): DETOUR "Debugging Race Condition"│
  │  turn 12 (fixed): PHASE 3 "Testing Fix"               │
  │  turn 14 (done):  RECAP                                │
  └───────────────────────┬─────────────────────────────┘
                          │ (phase transition)
                          ▼
  ┌─── update_topic BROADCAST (chapter title + summary) ─┐
  │  update_topic(title="Researching Parser",              │
  │    summary="Investigating parser timeout. Goal:        │
  │    understand test coverage, reproduce failure,        │
  │    identify bottleneck in main loop.")                 │
  │  ...                                                    │
  │  update_topic(title="Debugging Race Condition",        │
  │    summary="STRATEGIC DETOUR: test failed — found      │
  │    race in tokenizer buffer. Pivoting to fix async.") │
  └───────────────────────┬─────────────────────────────┘
                          │ (publish → user UI)
                          ▼
  ┌─── CHAPTER LOG (user follows along) ─────────────────┐
  │  Ch1: Researching Parser         (turn 1-5)            │
  │  Ch2: Implementing Fix           (turn 5-8)            │
  │  Ch3: Debugging Race Condition   (turn 8-12) [detour]  │
  │  Ch4: Testing Fix                (turn 12-14)          │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 292 lifecycle-hooks — event source (nền — RC phase trigger)
// ✅ progress / status bar — UI display (nền — RC chapter render)
// ✅ 468 QZ text-directives — structured output (nền — RC = update_topic tool)

// ❌ THIẾU: phase detector (identify subgoal boundary, 3-10 turn cadence)
// ❌ THIẾU: update_topic tool (title + summary broadcaster)
// ❌ THIẾU: chapter log (persist phases for recap)
// ❌ THIẾU: strategic-detour trigger (unexpected event → detour topic)
```

## Implementation

```typescript
// packages/agent/src/phase-topics.ts (MỚI)
interface Topic { title: string; summary: string; turn: number; isDetour?: boolean }

class PhaseTopics {
  private chapters: Topic[] = [];
  private turnCount = 0;
  private lastTopicTurn = 0;

  constructor(private broadcast: (t: Topic) => void) {}

  // call each turn — decide if phase changed
  onTurn(decidePhase: (turn: number, context: string) => Topic | null): void {
    this.turnCount++;
    // cadence: announce every 3-10 turns OR on explicit phase change
    if (this.turnCount - this.lastTopicTurn < 3) return;
    const topic = decidePhase(this.turnCount, currentContext);
    if (!topic) return;
    topic.turn = this.turnCount;
    this.chapters.push(topic);
    this.lastTopicTurn = this.turnCount;
    this.broadcast(topic);
  }

  // strategic detour (unexpected event)
  detour(title: string, summary: string): void {
    const t: Topic = { title, summary, turn: this.turnCount, isDetour: true };
    this.chapters.push(t);
    this.broadcast(t);
  }

  // recap (last turn)
  recap(): string {
    return this.chapters.map((c, i) =>
      `Ch${i + 1}: ${c.title} (turn ${c.turn})${c.isDetour ? ' [detour]' : ''}\n  ${c.summary}`,
    ).join('\n');
  }
}

// update_topic tool (agent-callable)
const updateTopic = defineTool({
  meta: { name: 'update_topic', description: 'Publish a chapter/phase topic with title + summary' },
  async run({ title, summary }: { title: string; summary: string }) {
    phaseTopics.detour(title, summary);
    return { ok: true, output: `published: ${title}` };
  },
});

// Usage:
// phaseTopics.onTurn(decidePhase);   // auto broadcast per phase
// agent calls update_topic on first/last turn + detours
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ User theo dõi progress structured (chapter list) | ❌ Phase detect sai (broadcast không đúng lúc) |
| ✅ Recap rõ ràng (cuối task = chapter log) | ❌ Topic spam (broadcast quá nhiều → noise) |
| ✅ Detour transparency (strategic pivot rõ) | ❌ Summary chất lượng (mơ hồ → user confuse) |
| ✅ Nối lifecycle-hooks + progress UI | ❌ Cadence tuning (3-10 turn chủ quan) |

## Khác các hướng gần

| | 099 Progressive-Disclosure | Progress Bar | RC: Phase-Topics |
|---|---|---|---|
| Cái gì | UI gating | % bar | **Chapter title + summary broadcast** |
| Cấu trúc | Show/hide | Numeric | **Semantic phase (subgoal)** |
| Detour | ❌ | ❌ | **✅ strategic-detour topic** |

## Khi nào chọn

- Task dài nhiều phase (research → implement → test)
- Muốn user theo dõi structured (chapter list, không đoán)
- Có detour (test-fail/compile-error → pivot)
- Nối 292 lifecycle-hooks (phase trigger) + progress UI (chapter render) + 468 QZ directives (broadcast channel); guard cadence (3-10 turn, không spam), summary quality (tiêu đề + tóm tắt rõ), và recap (turn cuối); teach agent trong system prompt khi nào gọi update_topic
