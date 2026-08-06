# Hướng UZ: Triple-Verified Mental Model — ý kiến phải qua 3 tầng verify (cross-domain reproduce / generative / exclusivity) mới thành mental model

> **Nguồn gốc:** nuwa-skill `verify/` (`triple_verify.py`, `cross_domain.py`, `generative.py`, `exclusivity.py`); "opinion must pass 3-tier verify"; "cross-domain reproduce / generative / exclusivity"; "evidence-backed mental model"; "no unverified belief" | **Coupling:** 🟢 — thêm triple-verify gate vào mental-model layer (claim → 3 test → accept/reject) | **Agent-agnostic:** ✅ | **Code sẵn:** ❌ (chưa có 3-tier verify pipeline) | **Effort:** 3-4 tuần

## Nguồn gốc

**nuwa-skill** khi chưng cất **mental model** (layer 1 trong UY) không tin mọi ý kiến expert nói — vì expert có **bias, over-generalization, hoặc sai**. Giải pháp: **triple-verify** — mỗi claim phải qua 3 tầng: (1) **Cross-domain reproduce** — claim đúng trong ≥ 2 domain khác nhau (không phải fluke 1 domain). (2) **Generative** — claim có thể **sinh ra** dự đoán đúng (không chỉ mô tả quá khứ). (3) **Exclusivity** — claim **đặc trưng** cho persona này (không generic ai cũng nói). Chỉ claim qua cả 3 → vào mental model. Nguyên tắc: **no unverified belief** — mental model phải evidence-backed.

## Mô tả

mya triple-verified mental model: (1) **Claim extract**: từ corpus → claim list. (2) **Cross-domain reproduce**: test claim ở ≥ 2 domain → pass/fail. (3) **Generative**: claim sinh dự đoán đúng → pass/fail. (4) **Exclusivity**: claim đặc trưng (không generic) → pass/fail. (5) **Accept gate**: claim qua cả 3 → mental model; fail 1 → reject/demote. mya có memory + eval — UZ thêm **3-tier verifier** + **accept gate** + **evidence trail**.

## Kiến trúc

```
  CLAIM: "nhàm chán là dấu hiệu model over-fit"
        │ (triple-verify — 3 tầng)
        ▼
  ┌─── TẦNG 1: CROSS-DOMAIN REPRODUCE ───────────────────┐
  │  test ở domain A (NLP): over-fit → nhàm ✓             │
  │  test ở domain B (vision): over-fit → nhàm ✓           │
  │  → PASS (đúng ≥ 2 domain, không fluke)                 │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── TẦNG 2: GENERATIVE ───────────────────────────────┐
  │  claim sinh dự đoán: "model X nhàm → over-fit"         │
  │  dự đoán đúng? ✓ → PASS (không chỉ mô tả quá khứ)      │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── TẦNG 3: EXCLUSIVITY ──────────────────────────────┐
  │  claim đặc trưng persona? ✓ (không generic ai cũng nói)│
  │  → PASS                                                  │
  └───────────────────────┬─────────────────────────────┘
                          │ (qua cả 3)
                          ▼
  ACCEPT vào mental model (evidence trail: 3 test pass)
  (fail 1 → REJECT / demote → không thành belief)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/memory — claim store (nền — UZ claim persist)
// ✅ packages/eval — test harness (nền — UZ verify test)
// ✅ 84 llm-as-judge — judge (nền — UZ exclusivity judge)

// ❌ THIẾU: cross-domain reproducer (test claim ≥ 2 domain)
// ❌ THIẾU: generative tester (claim → predict → verify)
// ❌ THIẾU: exclusivity judge (đặc trưng vs generic)
// ❌ THIẾU: accept gate + evidence trail (3-pass → accept)
```

## Implementation

```typescript
// packages/skills/src/triple-verify.ts (MỚI)
interface Claim { id: string; text: string }
interface VerifyResult { tier: 'cross-domain' | 'generative' | 'exclusivity'; pass: boolean; evidence: string }
interface VerifiedClaim { claim: Claim; results: VerifyResult[]; accepted: boolean }

class TripleVerify {
  constructor(
    private crossDomain: (claim: string, domains: string[]) => Promise<VerifyResult>,
    private generative: (claim: string) => Promise<VerifyResult>,
    private exclusivity: (claim: string) => Promise<VerifyResult>,
    private domains: string[],
  ) {}

  // verify 1 claim qua 3 tầng
  async verify(claim: Claim): Promise<VerifiedClaim> {
    const r1 = await this.crossDomain(claim.text, this.domains);
    const r2 = await this.generative(claim.text);
    const r3 = await this.exclusivity(claim.text);
    const results = [r1, r2, r3];
    return { claim, results, accepted: results.every(r => r.pass) }; // qua cả 3 → accept
  }

  // batch verify claim list → accept set + reject set
  async verifyAll(claims: Claim[]): Promise<{ accepted: VerifiedClaim[]; rejected: VerifiedClaim[] }> {
    const out = await Promise.all(claims.map(c => this.verify(c)));
    return {
      accepted: out.filter(v => v.accepted),
      rejected: out.filter(v => !v.accepted),
    };
  }

  // evidence trail (audit — claim + 3 test evidence)
  trail(v: VerifiedClaim): string {
    return `Claim: "${v.claim.text}" → ${v.accepted ? 'ACCEPTED ✓' : 'REJECTED ✗'}\n` +
      v.results.map(r => `  [${r.tier}] ${r.pass ? 'PASS' : 'FAIL'}: ${r.evidence}`).join('\n');
  }
}

// Usage:
// const tv = new TripleVerify(crossDomainFn, generativeFn, exclusivityFn, ['nlp','vision','rl']);
// const { accepted } = await tv.verifyAll(claims);
// accepted → vào mental model (evidence trail kèm)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Mental model evidence-backed (không tin mù) | ❌ Verify cost (3 LLM call mỗi claim) |
| ✅ Reject bias/over-generalization (cross-domain test) | ❌ False-reject (claim đúng nhưng fail 1 tier) |
| ✅ Generative (claim dự đoán được, không chỉ mô tả) | ❌ Domain coverage (thiếu domain → cross-domain yếu) |
| ✅ Exclusivity (mental model đặc trưng, không generic) | ❌ Exclusivity subjectivity (generic vs đặc trưng chủ quan) |

## Khác các hướng gần

| | 84 LLM-as-Judge | 102 Reward-Hacking | UZ: Triple-Verify |
|---|---|---|---|
| Cái gì | Chấm output | Phát cheat | **3-tier claim verify** |
| Tầng | 1 | 1 | **3 (cross/gen/excl)** |
| Evidence | ❌ | ❌ | **✅ trail** |

## Khi nào chọn

- Mental model cần evidence-backed (không tin expert mù)
- Nguy cơ bias/over-generalization (expert nói quá rộng)
- Muốn claim đặc trưng (mental model phân biệt được persona)
- Nối packages/memory + packages/eval + 84 llm-as-judge; guard false-reject (claim đúng fail 1 tier → re-test/demote không discard), domain breadth (cross-domain đủ đa dạng), và exclusivity calibration (generic threshold hợp lý); UZ = triple-verified mental model, là **verify gate cho layer 1 (mental-model) của UY cognitive-OS** — kết hợp 134 multi-agent-consensus (cross-domain = nhiều agent đồng ý)
