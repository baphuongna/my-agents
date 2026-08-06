# Hướng KU: Output Verbosity Adapt — LLM điều chỉnh độ dài câu trả lời theo ngữ cảnh

> **Nguồn gốc:** Adaptive interfaces; verbosity control (ChatGPT/Gemini "concise" toggle); context-aware UX; adaptive response length
> **Coupling:** 🟢 — pre/post-processing layer
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (config sẵn — thiếu adaptive logic)
> **Effort:** 1 tuần

## Nguồn gốc

**Adaptive verbosity**: LLM/chatbot điều độ dài câu trả lời theo ngữ cảnh — ChatGPT "concise/verbose" toggle, Gemini "response length". Nguyên tắc UX: câu trả lời phù hợp **ngữ cảnh** — expert muốn ngắn (cứ vào việc), newbie muốn dài (giải thích); user đang gấp muốn 1 dòng, user đang khám phá muốn chi tiết. Adaptive: hệ thống đo ngữ cảnh (ai, đang gì, gấp không) → chọn verbosity phù hợp. Khác verbosity cố định: adaptive **theo ngữ cảnh** — cá nhân hóa (140 personalization), tiết kiệm token (192).

## Mô tả

mya adaptive verbosity: agent đo ngữ cảnh → điều độ dài output. Tín hiệu: **người dùng** (expert/newbie — từ profile 140), **nhiệm vụ** (gấp vs khám phá), **lịch sử** (hỏi lại nhiều = cần rõ hơn), **thiết bị** (mobile = ngắn). Agent nhận token budget cho output (ngắn = ít token = rẻ nhanh 192) + system-prompt chỉ độ dài. Nối 140 personalization + 80 context-engineering. Khác verbosity config tĩnh: KU **động theo ngữ cảnh** — mỗi câu hỏi verbosity khác.

## Kiến trúc

```
  USER MESSAGE
        │
        ▼
  ┌─────── VERBOSITY SIGNALS ───────┐
  │  profile (140): expert/newbie    │
  │  urgency: deadline sắp hết?      │
  │  device: mobile → ngắn           │
  │  history: hỏi lại → rõ hơn       │
  │  query type: facts=ngắn, learn=dài│
  └───────────────┬──────────────────┘
                  ▼ quyết
  ┌──────────────────────────────────┐
  │ verbosity = "terse" | "normal"   │
  │            | "detailed"          │
  │ token-budget: 50 | 200 | 800     │
  └───────────────┬──────────────────┘
                  ▼ inject vào prompt
  AGENT (max_tokens = budget, "be terse/detailed")
                  ▼
  output phù hợp ngữ cảnh (tiết kiệm token + nhanh)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 140 agent-personalization — profile (nguồn tín hiệu)
// ✅ 80 context-engineering — context (đo ngữ cảnh)
// ✅ 192 token-economics — token (verbosity = tiết kiệm)
// ✅ 173 prompt-versioning — prompt (chỉ verbosity)
// ✅ packages/agent/src/config.ts — config (verbosity setting)

// ❌ THIẾU: adaptive verbosity logic (đo ngữ cảnh → độ dài)
// ❌ THIẾU: token-budget theo verbosity
// ❌ THIẾU: signal collector (profile/urgency/device/history)
// ❌ THIẾU: verbosity → max_tokens mapping
```

## Implementation

```typescript
// packages/agent/src/verbosity.ts (NEW)
type Verbosity = "terse" | "normal" | "detailed";
const TOKEN_BUDGET: Record<Verbosity, number> = { terse: 50, normal: 200, detailed: 800 };

interface Signals { expert: boolean; urgent: boolean; mobile: boolean; askedAgain: boolean; queryType: "fact" | "learn"; }

function decideVerbosity(s: Signals): Verbosity {
  if (s.urgent || s.mobile || s.queryType === "fact") return "terse";   // gấp/mobile/fact → ngắn
  if (s.askedAgain || s.queryType === "learn") return "detailed";       // hỏi lại/học → dài
  return s.expert ? "terse" : "normal";                                  // expert ngắn, newbie vừa
}

async function runAdaptive(prompt: string, sig: Signals): Promise<string> {
  const verbosity = decideVerbosity(sig);
  return llm.complete({
    prompt: `${prompt}\n[style: respond ${verbosity}]`,
    maxTokens: TOKEN_BUDGET[verbosity], // ngắn = ít token = rẻ + nhanh
  });
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Phù hợp ngữ cảnh (UX adaptive proven) | ❌ Tín hiệu có thể đo sai (guess newbie/expert) |
| ✅ Tiết kiệm token (terse = ít — 192) | ❌ Terse có thể thiếu thông tin user cần |
| ✅ Nhanh hơn (output ngắn — KO latency) | ❌ Logic adaptive thêm phức tạp |
| ✅ Nối 140 personalization (cá nhân) | ❌ User có thể muốn override (cần toggle) |

## Khác các hướng gần

| | 140 Personalization | 80 Context Engineering | KU: Verbosity Adapt |
|---|---|---|---|
| Thay đổi | Hành vi agent | Input context | **Độ dài output** |
| Theo | User profile | Context window | **Ngữ cảnh + urgency** |
| Token | ❌ | ❌ | ✅ budget theo verbosity |
| Override | ❌ | ❌ | cần toggle thủ công |

## Khi nào chọn

- User đa dạng (expert/newbie, gấp/khám phá) — output nên khác độ dài
- Muốn tiết kiệm token (192) — terse khi phù hợp
- Mobile/terminal nhỏ → output ngắn dễ đọc
- Cần cá nhân hóa (140) thêm chiều độ dài
