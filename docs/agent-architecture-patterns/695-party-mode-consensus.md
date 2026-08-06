# Hướng ZS: Party-Mode Consensus — gather perspective của N agent song song (ctx.parallel.map) → breakpoint review → BMad Master synthesize consensus + action items — đa quan điểm trước quyết định lớn
> **Nguồn gốc:** BMAD-METHOD (bmad-party-mode.js) | **Coupling:** 🟡 — N-agent parallel + synthesis vào council | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (council.ts + workflows parallel — chưa có party-mode flow hoàn chỉnh) | **Effort:** 2 tuần

## Nguồn gốc

**BMAD-METHOD** trước quyết định lớn không hỏi 1 agent — dùng **Party Mode**: (1) **Gather perspective** — N agent (mỗi agent 1 góc nhìn/role) chạy **song song** qua `ctx.parallel.map` — mỗi agent phân tích độc lập; (2) **Breakpoint review** — sau khi gather, dừng lại để **review tổng hợp** (human hoặc master xem các perspective); (3) **Synthesize** — **BMad Master** (agent tổng hợp) gộp các perspective → **consensus** (điểm chung, điểm tranh cãi) + **action items** (việc cụ thể). Đa quan điểm trước quyết định lớn → ít thiên kiến, phát hiện rủi ro bị bỏ sót. Nguyên tắc: **N perspectives → review → consensus + action items**.

## Mô tả

mya party-mode consensus: (1) **Party spawn** — N agent với role/perspective khác nhau (council member analog) chạy song song (nối ZI deterministic parallel). (2) **Collect perspectives** — mỗi agent trả phân tích độc lập (không thấy nhau — tránh bias). (3) **Breakpoint** — dừng, review (human có thể xem/chỉnh). (4) **Synthesize** — master agent gộp → consensus (đồng thuận/khác biệt) + action items. mya có council.ts (CouncilProvider, adversarial) + workflows runner (ctx.parallel) — ZS thêm **party spawn (N perspective)** + **breakpoint review** + **synthesis (consensus + action items)**.

## Kiến trúc

```
  QUYẾT ĐỊNH LỚN
  ┌──────────────────────────────────────────────────┐
  │  PARTY SPAWN (ctx.parallel.map — N agent song song)│
  │  ┌─ perspective-1 (dev) ─┐ ┌─ perspective-2 (sec) ─┐│
  │  │  phân tích độc lập     │ │  phân tích độc lập     ││
  │  └──────────┬────────────┘ └──────────┬────────────┘│
  │  ┌─ perspective-3 (ux) ─┐ ┌─ perspective-4 (ops) ─┐│
  │  └──────────┬────────────┘ └──────────┬────────────┘│
  └─────────────┴──────────────────────────┴───────────┘
                ▼ collect (N perspectives độc lập)
  ┌── BREAKPOINT REVIEW ─────────────────────────────┐
  │  dừng → review (human/master xem các perspective)  │
  └────────────────────┬─────────────────────────────┘
                       ▼
  ┌── SYNTHESIS (BMad Master) ──────────────────────┐
  │  consensus: điểm chung + điểm tranh cãi           │
  │  action items: việc cụ thể kế tiếp                │
  └─────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/council council.ts — CouncilProvider + strategy (nền — ZS synthesis analog)
// ✅ packages/council adversarial.ts — adversarialReview (nền — ZS multi-góc nhìn)
// ✅ packages/workflows runner.ts — ctx.parallel (nền — ZS N-agent song song)
// ✅ packages/agent index.ts — spawn subagent (nền — ZS party members)
// ✅ packages/core supervised.ts — supervisedTask (nền — ZS breakpoint review)

// ❌ THIẾU: party spawn (N perspective với role riêng, chạy độc lập)
// ❌ THIẾU: breakpoint review step (dừng giữa gather và synthesize)
// ❌ THIẾU: synthesis output chuẩn (consensus + action items)
```

## Implementation

```typescript
// packages/council/src/party-mode.ts (MỚI)

interface Perspective { role: string; analysis: string }
interface PartyConfig { roles: string[]; concurrency?: number }

class PartyMode {
  constructor(
    private gatherOne: (role: string) => Promise<string>,       // chạy 1 agent perspective
    private synthesize: (perspectives: Perspective[], review: string) => Promise<{ consensus: string[]; actions: string[] }>,
    private reviewGate: (perspectives: Perspective[]) => Promise<string>,  // breakpoint review
  ) {}

  // Party flow: N song song → breakpoint → synthesize
  async run(question: string, config: PartyConfig): Promise<{
    perspectives: Perspective[]; consensus: string[]; actions: string[];
  }> {
    // 1. Gather — N agent song song, độc lập (không thấy nhau)
    const analyses = await Promise.all(config.roles.map(r => this.gatherOne(`${r}: ${question}`)));
    const perspectives = config.roles.map((role, i) => ({ role, analysis: analyses[i] ?? "" }));

    // 2. Breakpoint review — dừng, review (human/master xem)
    const review = await this.reviewGate(perspectives);

    // 3. Synthesize — master gộp → consensus + action items
    const { consensus, actions } = await this.synthesize(perspectives, review);
    return { perspectives, consensus, actions };
  }
}
// Usage:
// const party = new PartyMode(
//   (role) => spawnSubagent(role),                                  // mỗi role 1 agent
//   (perspectives, review) => bmadMasterSynthesize(perspectives, review),
//   (perspectives) => humanBreakpointReview(perspectives),          // dừng chờ review
// );
// const { consensus, actions } = await party.run("có nên đổi sang SQLite?", {
//   roles: ["dev", "security", "ops", "ux"],
// });
// // 4 góc nhìn độc lập → review → consensus + action items
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Đa quan điểm (ít thiên kiến, bắt rủi ro sót) | ❌ N agent song song → tốn token gấp N |
| ✅ Độc lập (không thấy nhau → không herd bias) | ❌ Synthesis là LLM → có thể chôn ý kiến thiểu số |
| ✅ Breakpoint cho human can thiệp giữa chừng | ❌ Review dừng chờ human → latency |
| ✅ Consensus + action items rõ ràng | ❌ Role overlap → perspectives trùng, ít giá trị thêm |

## Khác các hướng gần

| | Single agent | Adversarial (2) | ZS: Party Mode |
|---|---|---|---|
| Góc nhìn | 1 | 2 | **N (role riêng)** |
| Song song | ✗ | ⚠️ | **✅ ctx.parallel.map** |
| Output | 1 ý | Debate | **Consensus + actions** |

## Khi nào chọn

- Quyết định lớn (kiến trúc, đổi stack, rủi ro) cần đa góc nhìn
- Muốn perspective độc lập trước khi chốt (tránh thiên kiến)
- Muốn human review giữa chừng (breakpoint) trước khi tổng hợp
- Nối packages/council council.ts + adversarial.ts + workflows runner.ts + agent index.ts + core supervised.ts; guard role-diversity (roles không trùng lặp), independence (agent không thấy nhau), và synthesis-fidelity (ý thiểu số không bị chôn); ZS = party-mode consensus, kết hợp 685 ZI deterministic-parallel-map (N song song deterministic) + 681 ZE durable-breakpoint-adapter (breakpoint sống qua restart)
