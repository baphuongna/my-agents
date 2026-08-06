# Hướng XH: Workflow Mining Autoskill — screenpipe capture cục bộ → cluster session → embedding match skill hiện có → LLM phân loại reuse/compose/novel

> **Nguồn gốc:** scientific-agent-skills (autoskill); "screenpipe local capture", "cluster session", "embedding match existing skill", "LLM classify reuse/compose/novel" | **Coupling:** 🔴 — thêm offline capture + embedding + LLM classifier (nhiều moving part) | **Agent-agnostic:** ✅ | **Code sẵn:** ❌ (chưa có capture + embedding + skill mining) | **Effort:** 5-6 tuần

## Nguồn gốc

**scientific-agent-skills** chạy **autoskill**: (1) **screenpipe** capture cục bộ mọi thao tác user (terminal command, file edit, app switch) — offline, local. (2) **Cluster session** — group capture thành **session** (block công việc liền mạch, tách bằng idle gap). (3) **Embedding match** — vector hóa session, **so với skill hiện có** (cosine similarity) → tìm skill gần nhất. (4) **LLM phân loại** 3 nhãn: **reuse** (session trùng skill hiện có → gợi ý dùng lại), **compose** (session = tổ hợp vài skill → gợi ý workflow nối), **novel** (session mới hoàn toàn → đề xuất tạo skill mới). Nguyên tắc: **khai thác hành vi thực → skill tự động** — không cần user viết tay.

## Mô tả

mya workflow mining autoskill: (1) screenpipe capture local action stream. (2) cluster thành session (idle-split). (3) embed session + so skill store (match). (4) LLM classify reuse/compose/novel → đề xuất. mya có skills + curator + memory — XH thêm **screenpipe capture** + **session cluster** + **embedding match** + **LLM classify**.

## Kiến trúc

```
  ┌─── 1. SCREENPIPE CAPTURE (local, offline) ────────────┐
  │  actions: [ cmd:"git add", edit:"a.ts", cmd:"commit" ] │  ← mọi thao tác
  └───────────────────────┬───────────────────────────────┘
                          │
                          ▼
  ┌─── 2. CLUSTER SESSION (idle-split) ──────────────────┐
  │  actions → session S1 (block liền, tách bằng gap>5m)   │
  └───────────────────────┬───────────────────────────────┘
                          │
                          ▼
  ┌─── 3. EMBEDDING MATCH (vs skill store) ───────────────┐
  │  embed(S1) → cosine vs embed(skill_i)                  │
  │  → top matches: [ commit-skill(0.91), lint-skill(0.4) ]│  ← gần nhất
  └───────────────────────┬───────────────────────────────┘
                          │
                          ▼
  ┌─── 4. LLM CLASSIFY ───────────────────────────────────┐
  │  match 0.91 ≥ threshold → REUSE (dùng commit-skill)    │
  │  matches tổ hợp      → COMPOSE (nối commit+lint)        │
  │  no match ≥ threshold→ NOVEL (tạo skill mới "git-flow")│
  └───────────────────────┬───────────────────────────────┘
                          ▼
  ┌─── SUGGESTION → user (gợi ý skill/workflow) ──────────┐
  │  "Reuse commit-skill" / "Compose commit+lint" / "Novel: tạo git-flow" │
  └─────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/skills skill.ts — skill (nền — XH match skill)
// ✅ packages/skills curator.ts — skill curator (nền — XH propose novel)
// ✅ packages/memory — embedding store (nền — XH embed session)

// ❌ THIẾU: screenpipe capture (local action stream)
// ❌ THIẾU: session cluster (idle-split)
// ❌ THIẾU: embedding match + LLM classify (reuse/compose/novel)
```

## Implementation

```typescript
// packages/skills/src/autoskill.ts (MỚI)
interface Action { type: string; data: string; ts: number }
interface SkillVec { name: string; vec: number[] }

// cluster session: tách bằng idle gap
function clusterSessions(actions: Action[], idleMs: number): Action[][] {
  const sessions: Action[][] = [];
  let cur: Action[] = [];
  for (const a of actions) {
    if (cur.length && a.ts - cur.at(-1)!.ts > idleMs) { sessions.push(cur); cur = []; } // idle split
    cur.push(a);
  }
  if (cur.length) sessions.push(cur);
  return sessions;
}

// embedding match + LLM classify
async function autoskill(
  session: Action[], skillVecs: SkillVec[], embed: (a: Action[]) => Promise<number[]>,
  classify: (s: Action[], matches: SkillVec[]) => Promise<"reuse" | "compose" | "novel">,
  threshold: number,
): Promise<{ label: string; matches: SkillVec[] }> {
  const vec = await embed(session);
  const ranked = skillVecs
    .map((s) => ({ ...s, sim: cosine(vec, s.vec) }))
    .sort((a, b) => b.sim - a.sim);
  const matches = ranked.filter((m) => m.sim >= threshold);
  const label = await classify(session, matches); // LLM: reuse/compose/novel
  return { label, matches };
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! ** 2; nb += b[i]! ** 2; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// Usage:
// const sessions = clusterSessions(capturedActions, 5*60*1000);
// for (const s of sessions) { const r = await autoskill(s, skillVecs, embed, classify, 0.85); }
// → label: reuse (dùng lại) / compose (nối) / novel (tạo mới)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Skill tự động (khai thác hành vi thực) | ❌ Privacy (capture mọi thao tác cục bộ) |
| ✅ Reuse đề xuất (gợi ý skill trùng) | ❌ Noise (capture rác → cluster rác) |
| ✅ Novel phát hiện (tạo skill mới) | ❌ Embedding cost (vector hóa mỗi session) |
| ✅ Compose (nối skill thành workflow) | ❌ LLM classify ambiguity (ranh giới reuse/novel mờ) |

## Khác các hướng gần

| | Manual skill write | Template suggest | XH: Mining-Autoskill |
|---|---|---|---|
| Nguồn skill | user viết tay | rule match | **✅ screenpipe capture** |
| Classify | ❌ | ❌ | **✅ reuse/compose/novel (LLM)** |
| Match | ❌ | keyword | **✅ embedding cosine** |

## Khi nào chọn

- Muốn khai thác hành vi thực (capture local) → đề xuất skill tự động
- Có skill store đủ lớn để match (embedding meaningful)
- Nối packages/skills skill.ts + curator.ts + packages/memory (embedding); guard capture-consent (user opt-in, không capture ngầm), embed-cache (vector hóa skill 1 lần, cache), và novel-validation (novel phải confirm user trước khi tạo skill, không auto-add); XH = workflow mining autoskill, kết hợp 632 XH self (recursive) + 105 self-improving-agents (skill tự cải thiện) + packages/memory (embedding store)
