# Hướng UU: Selective Self-Disclosure — hướng dẫn user chọn chủ đề loại bỏ kiến thức khi self-distillation: trade secret, điểm yếu, ranh giới cá nhân

> **Nguồn gốc:** DISTILL-R2 `self_distill/` (`disclosure_guide.md`, `topic_selector`); "user chooses topics to remove knowledge"; "selective disclosure in self-distillation"; "trade secret / weakness / personal boundary exclusion"; "user-in-the-loop redaction" | **Coupling:** 🟢 — thêm selective-disclosure guide vào self-distillation flow (user chọn chủ đề loại bỏ) | **Agent-agnostic:** ✅ | **Code sẵn:** ❌ (chưa có topic-selector + disclosure gate) | **Effort:** 2-3 tuần

## Nguồn gốc

**DISTILL-R2** khi **self-distillation** (user chưng cất chính kiến thức/experience của mình thành skill) gặp vấn đề **quá-disclose**: user có thể vô tình đưa vào **trade secret** (bí mật kinh doanh), **điểm yếu** (lỗ hổng cá nhân/org), **ranh giới cá nhân** (thông tin nhạy cảm) → skill publish = lộ. Giải pháp: **selective self-disclosure guide** — trước khi distill, trình cho user **chủ đề** đã detect (potential sensitive) → user **chọn loại bỏ** (không vào skill) hoặc **giữ** (an toàn publish). Nguyên tắc: **user-in-the-loop redaction** — không tự động xoá, mà user quyết định từng chủ đề. Khác US corpus-scrubbing (auto regex) — UU **human-judgment selective** (chủ đề phức tạp, không regex được).

## Mô tả

mya selective self-disclosure: (1) **Detect topics**: scan corpus → đề xuất chủ đề (trade secret, weakness, personal). (2) **AskUser**: trình chủ đề → user chọn loại bỏ/giữ. (3) **Redact**: chủ đề loại bỏ → remove/redact khỏi skill. (4) **Disclose log**: ghi chủ đề đã loại (audit, không lộ giá trị). mya có secrets + HITL — UU thêm **topic detector** + **disclosure selector** + **topic-redactor**.

## Kiến trúc

```
  SELF-DISTILL: user corpus (experience/knowledge của user)
        │
        ▼
  ┌─── DETECT TOPICS (potential sensitive) ───────────────┐
  │  T1: "thuật toán ranking nội bộ" → trade secret        │
  │  T2: "server hay crash lúc 3h sáng" → điểm yếu         │
  │  T3: "sếp Nguyễn quyết định X" → ranh giới cá nhân     │
  │  T4: "cách debug parser" → an toàn (giữ)               │
  └───────────────────────┬─────────────────────────────┘
                          │ (AskUser — user chọn)
                          ▼
  ┌─── DISCLOSURE SELECTOR (user-in-the-loop) ───────────┐
  │  T1 trade secret → user: REMOVE (không publish)        │
  │  T2 điểm yếu → user: REMOVE                            │
  │  T3 cá nhân → user: REMOVE                             │
  │  T4 an toàn → user: KEEP                               │
  └───────────────────────┬─────────────────────────────┘
                          │ (redact removed topics)
                          ▼
  SKILL an toàn publish (T4 only) — disclose-log: removed T1,T2,T3
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/secrets — secret handling (nền — UU trade secret)
// ✅ 132 human-in-the-loop — AskUser (nền — UU selector gate)
// ✅ 124 dynamic-permissions — consent (nền — UU user consent)

// ❌ THIẾU: topic detector (scan corpus → sensitive topics)
// ❌ THIẾU: disclosure selector (AskUser per-topic: remove/keep)
// ❌ THIẾU: topic-redactor (remove chủ đề khỏi skill)
// ❌ THIẾU: disclose-log (audit, không lộ giá trị)
```

## Implementation

```typescript
// packages/secrets/src/selective-disclosure.ts (MỚI)
interface Topic { id: string; label: string; category: 'trade-secret' | 'weakness' | 'personal' | 'safe'; evidence: string; decision: 'remove' | 'keep' | null }

class SelectiveDisclosure {
  constructor(
    private detect: (corpus: string) => Promise<Topic[]>, // LLM detect topics
    private askUser: (msg: string, opts: string[]) => Promise<string>,
  ) {}

  // Phase 1: detect topics
  async detectTopics(corpus: string): Promise<Topic[]> {
    return (await this.detect(corpus)).map(t => ({ ...t, decision: null }));
  }

  // Phase 2: user selects remove/keep per topic
  async select(topics: Topic[]): Promise<Topic[]> {
    for (const t of topics) {
      if (t.category === 'safe') { t.decision = 'keep'; continue; }
      const verdict = await this.askUser(
        `Topic "${t.label}" (${t.category}):\n  evidence: ${t.evidence.slice(0, 80)}\nRemove (không publish) hay Keep?`,
        ['remove', 'keep'],
      );
      t.decision = verdict as Topic['decision'];
    }
    return topics;
  }

  // Phase 3: redact removed topics from skill
  redact(corpus: string, topics: Topic[]): { clean: string; removed: string[] } {
    let clean = corpus;
    const removed: string[] = [];
    for (const t of topics) {
      if (t.decision === 'remove') {
        // remove evidence spans referencing this topic
        clean = clean.replace(t.evidence, '[REDACTED-by-author]');
        removed.push(t.label);
      }
    }
    return { clean, removed };
  }

  // disclose-log (audit — không lộ giá trị, chỉ label)
  log(topics: Topic[]): string {
    const removed = topics.filter(t => t.decision === 'remove').map(t => `- ${t.label} (${t.category})`);
    return `# Disclose Log\n\nAuthor selectively removed topics:\n${removed.join('\n') || 'none'}`;
  }
}

// Usage:
// const sd = new SelectiveDisclosure(detectLLM, askUserTool);
// const { clean } = sd.redact(corpus, await sd.select(await sd.detectTopics(corpus)));
// distill(clean); // an toàn publish
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Author control (user quyết định từng chủ đề) | ❌ Detect miss (topic nhạy cảm không detect được) |
| ✅ No accidental leak (trade secret/weakness removed) | ❌ User fatigue (nhiều topic → chán chọn) |
| ✅ Audit (disclose-log rõ) | ❌ Redaction incomplete (evidence lọt ở chỗ khác) |
| ✅ Human judgment (không auto-sai) | ❌ Detect cost (LLM scan toàn corpus) |

## Khác các hướng gần

| | US Corpus-PII-Scrub | 124 Dynamic-Perms | UU: Selective-Disclosure |
|---|---|---|---|
| Cái gì | Auto regex PII | Consent gate | **User chọn topic loại bỏ** |
| Detect | Regex | ❌ | **LLM topic detect** |
| Decision | Auto | Yes/No | **Per-topic remove/keep** |

## Khi nào chọn

- Self-distillation (user chưng cất kiến thức chính mình)
- Corpus có chủ đề nhạy cảm (trade secret, weakness, personal)
- Muốn author control (user quyết định, không auto)
- Nối packages/secrets + 132 human-in-the-loop + 124 dynamic-permissions; guard detect recall (LLM detect đủ topic), redaction completeness (evidence ở nhiều chỗ → xoá hết), và user UX (group topic, default safe); UU = selective self-disclosure, chạy trước UV bundled-example-corpus (ví dụ sẵn phải disclosure-safe) — kết hợp US corpus-PII-scrubbing (auto PII) làm 2 lớp: auto (regex) + human (topic)
