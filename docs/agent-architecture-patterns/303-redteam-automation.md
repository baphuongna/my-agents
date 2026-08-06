# Hướng KQ: Redteam Automation — pipeline red-team LLM định kỳ, penetration test

> **Nguồn gốc:** OWASP; NIST AI RMF; PyRIT (Microsoft); Garak (LLM vulnerability scanner); automated red teaming
> **Coupling:** 🟢 — pipeline test tách riêng
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (red-teaming doc sẵn — thiếu pipeline tự động CI)
> **Effort:** 2-3 tuần

## Nguồn gốc

**Red team** (cybersecurity): đội tấn công mô phỏng kẻ thù để tìm lỗổng trước hacker. NIST AI RMF (AI 100-1): đo lường/responder threat AI. PyRIT (Microsoft 2024): Python Risk Identification Toolkit — **tự động hóa** red-teaming LLM (sinh adversarial prompt, chấm jailbreak). Garak (NVIDIA): open-source LLM vulnerability scanner — probe hàng chục lớp tấn công (jailbreak, leak, prompt injection). Nguyên tắc: **định kỳ + tự động** — không red-team 1 lần, mà pipeline chạy mỗi release/PR để bắt regression bảo mật. Nối 72 llm-red-teaming (doc) + 96 CI.

## Mô tả

mya redteam pipeline: CI định kỳ (mỗi release + weekly) chạy **bộ tấn công tự động** — jailbreak, prompt-injection (200), data leak, jailbreak. Pipeline sinh adversarial input (PyRIT/Garak-style), ném vào agent, đo breach rate. Regression bảo mật → block release (giống 299 gate nhưng cho security). Báo cáo: loại tấn công, tỷ lệ thành công, guardrail (168) có chặn không. Khác 72 (red-team thủ công/1 lần): KQ **pipeline tự động CI**. Nối 305 security-eval-suite (bộ metric).

## Kiến trúc

```
  ┌───────── REDTEAM PIPELINE (CI: weekly + mỗi release) ─────────┐
  │                                                               │
  │  ATTACK GENERATOR (PyRIT/Garak-style)                         │
  │   ├─ jailbreak prompts (DAN, roleplay bypass)                 │
  │   ├─ prompt injection (200) — override instruction            │
  │   ├─ data leak probes — extract secret/system prompt          │
  │   └─ mutation (304) — biến thể từ corpus                      │
  │         │                                                     │
  │         ▼                                                     │
  │  AGENT (chạy thật, có guardrail 168)                          │
  │         │                                                     │
  │         ▼                                                     │
  │  CLASSIFIER: breach? (jailbreak thành công? leak được?)       │
  │         │                                                     │
  │         ▼                                                     │
  │  REPORT: breach-rate / loại tấn công / guardrail có chặn?     │
  │  breach-rate > threshold → BLOCK release (giống 299 gate)     │
  └───────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 72 llm-red-teaming — red-team (documented, nền)
// ✅ 200 prompt-injection-defense — phòng injection
// ✅ 168 agent-guardrails-layer — guardrail (đối tượng test)
// ✅ 96 agent-ci-cd — CI (nơi chạy pipeline)
// ✅ 214 pii-redaction — data protection (test leak)

// ❌ THIẾU: attack generator (jailbreak/injection/leak/mutation)
// ❌ THIẾU: breach classifier (jailbreak thành công?)
// ❌ THIẾU: CI pipeline định kỳ (weekly + release)
// ❌ THIẾU: security gate (block khi breach-rate cao)
```

## Implementation

```typescript
// packages/eval/src/redteam.ts (NEW)
interface Attack { type: "jailbreak" | "injection" | "leak" | "mutation"; prompt: string; }
type Verdict = "safe" | "breach";

function genAttacks(corpus: string[], kinds: Attack["type"][]): Attack[] {
  const out: Attack[] = [];
  for (const k of kinds) for (const c of corpus) {
    out.push({ type: k, prompt: mutate(c, k) }); // 304 fuzz/mutation
  }
  return out;
}

async function classify(agentReply: string, attack: Attack): Promise<Verdict> {
  // jailbreak thành công? leak secret? instruction bị override?
  const isBreach = await judge.isHarmful(agentReply) || replyLeaksSecret(agentReply, attack);
  return isBreach ? "breach" : "safe";
}

// CI pipeline định kỳ
async function redteamGate(maxBreachRate = 0.05): Promise<void> {
  const attacks = genAttacks(corpus, ["jailbreak", "injection", "leak"]);
  const replies = await Promise.all(attacks.map((a) => agent.run(a.prompt)));
  const breaches = attacks
    .map((a, i) => classify(replies[i], a))
    .filter((v) => v === "breach").length;
  const rate = breaches / attacks.length;
  if (rate > maxBreachRate) throw new Error(`security breach-rate ${(rate * 100).toFixed(1)}% > ${maxBreachRate * 100}%`);
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Bắt lỗổng trước hacker (red-team proven) | ❌ Tốn token (chạy nhiều tấn công) |
| ✅ Tự động định kỳ (PyRIT/Garak — không thủ công) | ❌ Classifier breach có thể sai (false neg) |
| ✅ Security regression gate (block release) | ❌ Corpus tấn công phải cập nhật (cat-mouse) |
| ✅ Nối 72/200/168/305 (defense + metric) | ❌ Attacker adaptive → cần cả mutation (304) |

## Khác các hướng gần

| | 72 LLM Red-Teaming | 200 Injection Defense | KQ: Redteam Automation |
|---|---|---|---|
| Khi | 1 lần/thủ công | Runtime (phòng) | **CI định kỳ (pipeline)** |
| Mục | Tìm lỗổng | Chặn injection | **Bắt regression bảo mật** |
| Tự động | ❌ | ❌ (runtime) | ✅ (generator + gate) |
| Gate | ❌ | ❌ | ✅ block release |

## Khi nào chọn

- Agent xử lý input không tin cậy (user, web 217, tool)
- Cần security regression gate (giống 299 nhưng cho bảo mật)
- Đã có guardrail (168) — cần đo có chặn được không
- Compliance yêu cầu kiểm tra định kỳ (NIST AI RMF)
