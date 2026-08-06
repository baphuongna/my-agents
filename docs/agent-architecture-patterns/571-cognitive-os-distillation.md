# Hướng UY: Cognitive-OS Distillation — chưng cất persona thành 5 lớp cognitive OS: mental model, decision heuristics, expression DNA, anti-patterns, honest boundaries

> **Nguồn gốc:** nuwa-skill `cognitive-os/` (`distill_persona.py`, 5-layer schema); "distill persona into 5 cognitive OS layers"; "mental model / decision heuristics / expression DNA / anti-patterns / honest boundaries"; "structured persona capture" | **Coupling:** 🟡 — thêm 5-layer cognitive-OS distiller vào skill pipeline (persona → 5 structured layer) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (prompts + skills sẵn — chưa có 5-layer cognitive schema + distiller) | **Effort:** 3-4 tuần

## Nguồn gốc

**nuwa-skill** khi chưng cất **persona** (cách một expert/domain nghĩ + hành động) không ghi 1 prompt lộn xộn — mà chia thành **5 lớp cognitive OS** có cấu trúc: (1) **Mental model** — expert hiểu thế giới thế nào (concept, relationship, assumption). (2) **Decision heuristics** — quy tắc quyết định (khi X → chọn Y). (3) **Expression DNA** — phong cách diễn đạt (tone, vocab, structure). (4) **Anti-patterns** — gì KHÔNG làm (lỗi phổ biến). (5) **Honest boundaries** — giới hạn kiến thức (không biết gì, khi nào fail). Nguyên tắc: **persona = 5 lớp có cấu trúc**, không 1 khối prose — mỗi lớp tách bỉ, audit, tune được.

## Mô tả

mya cognitive-OS distillation: (1) **Distill**: từ corpus persona → extract 5 layer. (2) **Layer schema**: mỗi layer có format riêng (mental-model: concept map; heuristics: rule list; expression: style guide; anti-patterns: don't list; boundaries: limit statement). (3) **Skill artifact**: 5 layer thành 5 section trong skill. (4) **Tunable**: tune từng layer độc lập (vd chỉ sửa expression DNA). mya có prompts + skills — UY thêm **5-layer distiller** + **cognitive schema** + **per-layer validator**.

## Kiến trúc

```
  PERSONA CORPUS (dialogue/work của expert)
        │ (distill → 5 layer cognitive OS)
        ▼
  ┌─── 5 LAYER COGNITIVE OS (có cấu trúc) ───────────────┐
  │  1. MENTAL MODEL: concept + relationship + assumption  │
  │     { "consensus"→[nodes, async], "fault"→[crash,…] }  │
  │  2. DECISION HEURISTICS: rule list                     │
  │     [ "khi <50 node → Raft", "BFT → PBFT" ]            │
  │  3. EXPRESSION DNA: tone + vocab + structure           │
  │     { tone:"precise", vocab:"academic", … }            │
  │  4. ANTI-PATTERNS: don't list                          │
  │     [ "không naive lock", "không bỏ leader election" ] │
  │  5. HONEST BOUNDARIES: limit statement                 │
  │     "không rành quantum consensus; fail khi >1000 node"│
  └───────────────────────┬─────────────────────────────┘
                          │ (5 section trong skill)
                          ▼
  SKILL.md = 5 layer (tách bỉ, tune độc lập, audit được)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/prompts — prompt template (nền — UY 5-layer section)
// ✅ packages/skills — skill artifact (nền — UY cognitive skill)
// ✅ 80 context-engineering — context struct (nền — UY structured persona)

// ❌ THIẾU: 5-layer cognitive schema (mental/heuristic/expression/anti/boundary)
// ❌ THIẾU: per-layer distiller (corpus → từng layer)
// ❌ THIẾU: per-layer validator (mỗi layer phải có content hợp lệ)
// ❌ THIẾU: per-layer tuner (sửa 1 layer không ảnh hưởng khác)
```

## Implementation

```typescript
// packages/skills/src/cognitive-os.ts (MỚI)
interface MentalModel { concepts: Record<string, string[]>; assumptions: string[] }
interface Heuristic { when: string; then: string }
interface ExpressionDNA { tone: string; vocab: string[]; structure: string }
interface CognitiveOS {
  mentalModel: MentalModel;
  heuristics: Heuristic[];
  expression: ExpressionDNA;
  antiPatterns: string[];
  honestBoundaries: string[];
}

class CognitiveOSDistiller {
  constructor(private distillLayer: <K extends keyof CognitiveOS>(layer: K, corpus: string) => Promise<CognitiveOS[K]>) {}

  // distill full 5-layer
  async distill(corpus: string): Promise<CognitiveOS> {
    const L = <K extends keyof CognitiveOS>(k: K) => this.distillLayer(k, corpus);
    return {
      mentalModel: await L('mentalModel'), heuristics: await L('heuristics'),
      expression: await L('expression'), antiPatterns: await L('antiPatterns'), honestBoundaries: await L('honestBoundaries'),
    };
  }

  // validate: mỗi layer phải có content
  validate(os: CognitiveOS): string[] {
    const issues: string[] = [];
    if (Object.keys(os.mentalModel.concepts).length === 0) issues.push('mental-model empty');
    if (!os.heuristics.length || !os.expression.tone || !os.antiPatterns.length || !os.honestBoundaries.length)
      issues.push('one or more layers empty (heuristics/expression/anti-patterns/boundaries)');
    return issues;
  }

  // tune 1 layer (không ảnh hưởng khác)
  async reLayer<K extends keyof CognitiveOS>(os: CognitiveOS, layer: K, corpus: string): Promise<CognitiveOS> {
    return { ...os, [layer]: await this.distillLayer(layer, corpus) };
  }

  // serialize skill (5 section)
  toSkill(os: CognitiveOS, title: string): string {
    const m = Object.entries(os.mentalModel.concepts).map(([k, v]) => `- ${k}: ${v.join(', ')}`).join('\n');
    const h = os.heuristics.map(x => `- khi ${x.when} → ${x.then}`).join('\n');
    const ap = os.antiPatterns.map(a => `- ❌ ${a}`).join('\n');
    const hb = os.honestBoundaries.map(b => `- ⚠ ${b}`).join('\n');
    return `# ${title} — Cognitive OS\n\n## Mental Model\n${m}\n\n## Decision Heuristics\n${h}\n\n` +
      `## Expression DNA\n- tone: ${os.expression.tone}\n- vocab: ${os.expression.vocab.join(', ')}\n\n## Anti-Patterns\n${ap}\n\n## Honest Boundaries\n${hb}`;
  }
}

// Usage:
// const d = new CognitiveOSDistiller(distillLayerLLM);
// const os = await d.distill(corpus); // 5 layer (validate đủ)
// fs.writeFileSync('SKILL.md', d.toSkill(os, 'Consensus Expert'));
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Persona có cấu trúc (5 layer tách bỉ) | ❌ Distill cost (LLM call mỗi layer) |
| ✅ Tunable (sửa 1 layer không phá khác) | ❌ Layer coupling (thực tế layer liên quan nhau) |
| ✅ Audit (mỗi layer check được) | ❌ Schema rigidity (expert không fit 5 layer) |
| ✅ Honest boundaries (biết giới hạn) | ❌ Mental-model abstraction (concept map khó extract) |

## Khác các hướng gần

| | packages/prompts | 140 Personalization | UY: Cognitive-OS |
|---|---|---|---|
| Cái gì | 1 prompt khối | User profile | **5-layer structured persona** |
| Structured | ❌ | ⚠️ | **✅ 5 schema** |
| Boundaries | ❌ | ❌ | **✅ honest layer** |

## Khi nào chọn

- Distill expert persona (cách họ nghĩ + hành động)
- Muốn persona có cấu trúc (không 1 khối prose)
- Cần tune từng khía cạnh độc lập (vd chỉ sửa expression)
- Nối packages/prompts + packages/skills + 80 context-engineering; guard layer completeness (validate đủ 5 layer), boundary honesty (UT source-liveness + UU disclosure), và mental-model fidelity (UZ triple-verify concept); UY = cognitive-OS distillation, kết hợp UZ triple-verified-mental-model (verify layer 1) + US corpus-pii-scrubbing (corpus sạch trước distill)
