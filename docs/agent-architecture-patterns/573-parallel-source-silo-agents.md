# Hướng VA: Parallel Source-Silo Agents — 6 agent nghiên cứu song song, mỗi agent ghi 1 chiều vào md riêng (works/voice/expression/others/decisions/timeline)

> **Nguồn gốc:** nuwa-skill `research/` (6 parallel agents, `works.md`/`voice.md`/`expression.md`/`others.md`/`decisions.md`/`timeline.md`); "6 agents research in parallel"; "each writes 1 dimension into separate md"; "dimension-siloed research"; "no cross-contamination" | **Coupling:** 🟡 — thêm 6-silo parallel research pattern vào subagent orchestration | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (subagents + workflows sẵn — chưa có dimension-silo parallel fan-out + merge) | **Effort:** 2-3 tuần

## Nguồn gốc

**nuwa-skill** khi nghiên cứu 1 persona/topic không để 1 agent làm hết (trộn chiều, thiếu chiều) — mà **fan-out 6 agent song song**, mỗi agent chỉ phụ trách **1 chiều** và ghi vào **md riêng** (silo — không cross-contamination): (1) **works** — tác phẩm/output. (2) **voice** — giọng điệu. (3) **expression** — cách diễn đạt. (4) **others** — người khác nói về persona. (5) **decisions** — quyết định quan trọng. (6) **timeline** — dòng thời gian. Mỗi agent chạy độc lập, ghi md riêng → rồi **merge** gộp 6 chiều. Nguyên tắc: **parallel dimension-silo** — chia để trị, mỗi agent chuyên 1 chiều, không lẫn.

## Mô tả

mya parallel source-silo agents: (1) **Fan-out**: spawn 6 subagent song song, mỗi cái 1 dimension prompt. (2) **Silo write**: mỗi agent ghi md riêng (works.md, …) — không ghi chung. (3) **Parallel**: 6 chạy đồng thời (fast, không chờ nhau). (4) **Merge**: gộp 6 md → 1 unified report (mỗi chiều 1 section). mya có subagents + workflows — VA thêm **6-silo fan-out** + **dimension-silo write** + **merge collector**.

## Kiến trúc

```
  TOPIC: "nghiên cứu expert X"
        │ (fan-out 6 agent song song)
        ▼
  ┌─── 6 PARALLEL SILO AGENTS ───────────────────────────┐
  │  agent-works     → works.md      (tác phẩm/output)     │
  │  agent-voice     → voice.md      (giọng điệu)          │
  │  agent-expression→ expression.md (cách diễn đạt)       │
  │  agent-others    → others.md     (người khác nói)      │
  │  agent-decisions → decisions.md  (quyết định)          │
  │  agent-timeline  → timeline.md   (dòng thời gian)      │
  │  (chạy song song, mỗi cái 1 silo, không cross)         │
  └───────────────────────┬─────────────────────────────┘
                          │ (gộp 6 md)
                          ▼
  ┌─── MERGE (unified report) ───────────────────────────┐
  │  ## Works … ## Voice … ## Expression …                │
  │  ## Others … ## Decisions … ## Timeline …             │
  │  (mỗi chiều đầy đủ, không thiếu)                       │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/agent subagent — spawn parallel (nền — VA fan-out)
// ✅ packages/workflows — orchestration (nền — VA parallel workflow)
// ✅ 86 agent-topology — fan-out topology (nền — VA 6-silo topology)

// ❌ THIẾU: 6 dimension-silo prompts (works/voice/expression/others/decisions/timeline)
// ❌ THIẾU: silo-write discipline (mỗi agent 1 md, không cross)
// ❌ THIẾU: merge collector (gộp 6 md → unified)
// ❌ THIẾU: completeness check (mỗi silo phải có content)
```

## Implementation

```typescript
// packages/agent/src/parallel-silo-research.ts (MỚI)
interface SiloAgent { dimension: string; prompt: string; outputFile: string }

const SILOS: SiloAgent[] = [
  { dimension: 'works', prompt: 'Tác phẩm/output chính của subject', outputFile: 'works.md' },
  { dimension: 'voice', prompt: 'Giọng điệu/tone của subject', outputFile: 'voice.md' },
  { dimension: 'expression', prompt: 'Cách diễn đạt (vocab, structure)', outputFile: 'expression.md' },
  { dimension: 'others', prompt: 'Người khác nói gì về subject', outputFile: 'others.md' },
  { dimension: 'decisions', prompt: 'Quyết định quan trọng của subject', outputFile: 'decisions.md' },
  { dimension: 'timeline', prompt: 'Dòng thời gian sự kiện của subject', outputFile: 'timeline.md' },
];

class ParallelSiloResearch {
  constructor(
    private spawn: (prompt: string) => Promise<string>, // subagent → returns md content
    private writeFile: (file: string, content: string) => Promise<void>,
    private readFile: (file: string) => Promise<string>,
  ) {}

  // fan-out 6 agent song song, mỗi cái 1 silo
  async fanOut(topic: string): Promise<void> {
    await Promise.all(SILOS.map(async silo => {
      const prompt = `${silo.prompt}\nSubject: ${topic}\nGhi kết quả (chỉ chiều ${silo.dimension}, không lẫn chiều khác).`;
      const content = await this.spawn(prompt); // parallel
      await this.writeFile(silo.outputFile, content); // silo write
    }));
  }

  // merge 6 md → unified report (mỗi chiều 1 section)
  async merge(): Promise<string> {
    const sections: string[] = [];
    for (const silo of SILOS) {
      try { sections.push(`## ${silo.dimension}\n${await this.readFile(silo.outputFile)}`); }
      catch { sections.push(`## ${silo.dimension}\n∅ (silo trống)`); }
    }
    return `# Unified Research\n\n${sections.join('\n\n')}`;
  }

  // completeness check: mỗi silo phải có content
  async completeness(): Promise<{ complete: string[]; missing: string[] }> {
    const complete: string[] = [], missing: string[] = [];
    for (const silo of SILOS) {
      try { (await this.readFile(silo.outputFile)).trim() ? complete.push(silo.dimension) : missing.push(silo.dimension); }
      catch { missing.push(silo.dimension); }
    }
    return { complete, missing };
  }
}

// Usage:
// const r = new ParallelSiloResearch(spawnSubagent, writeFs, readFs);
// await r.fanOut("expert X");          // 6 agent song song
// const report = await r.merge();      // gộp 6 silo + completeness()
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Fast (6 song song, không chờ nhau) | ❌ 6x cost (6 agent chạy đồng thời) |
| ✅ Dimension-complete (mỗi chiều chuyên sâu) | ❌ Cross-silo gap (chiều liên quan bị tách) |
| ✅ No cross-contamination (silo riêng) | ❌ Merge quality (gộp 6 md có thể mâu thuẫn) |
| ✅ Parallel scalable (thêm/sửa silo dễ) | ❌ Coordination overhead (spawn 6 agent) |

## Khác các hướng gần

| | 86 Agent-Topology | 134 Multi-Agent-Consensus | VA: Parallel-Silo |
|---|---|---|---|
| Cái gì | Topology fan-out | N agent đồng ý | **6 agent 1 chiều/silo** |
| Chia theo | Task | Ý kiến | **dimension** |
| Silo | ❌ | ❌ | **✅ md riêng** |

## Khi nào chọn

- Nghiên cứu cần đa chiều (mỗi chiều chuyên sâu)
- Muốn song song (fast, không serial)
- Cần dimension-silo (không cross-contamination)
- Nối packages/agent subagent + packages/workflows + 86 agent-topology; guard cross-silo coherence (merge resolve mâu thuẫn giữa chiều), completeness enforcement (re-run silo trống), và cost budget (6x token → ước lượng trước); VA = parallel source-silo agents, kết hợp UO outline-first-research (plan trước → dimension chia) + UY cognitive-OS-distillation (6 chiều → 5 cognitive layer)
