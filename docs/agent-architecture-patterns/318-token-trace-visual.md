# Hướng LF: Token-Level Trace Visual — trace từng token/step LLM, visualize debug

> **Nguồn gốc:** OpenAI token logprobs; "LLM observability" (LangSmith/Helicone); OpenTelemetry traces; "attention visualization"; step-by-step debuggers; "Inspect AI" (UK AISI); capture-replay
> **Coupling:** 🟡 — chạm provider + agent-loop instrumentation
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (provider + agent-loop + tool-call sẵn — thiếu token-level capture + span trace + visual)
> **Effort:** 3-4 tuần

## Nguồn gốc

Token-level: API trả **logprob** per token — thấy confidence của model ở từng token. LLM observability (LangSmith, Helicone, Arize): trace mỗi LLM call — prompt, response, latency, cost, tool-call. OpenTelemetry (OTel): **span**-based tracing — mỗi operation = span (name, start, end, attributes), nested thành trace tree. Attention visualization (TransformerLens): thấy model "nhìn" đâu. Inspect AI (UK AISI): agent eval with sample-level trace. Capture-replay: record full turn (prompt+response) → replay để debug. Cốt lõi: **đừng chỉ thấy final answer** — trace từng token + step + tool → debug hallucination, latency, cost.

## Mô tả

mya token trace: mỗi agent turn → capture (1) **LLM call** — prompt, response, **logprob per token** (confidence), latency, cost; (2) **tool-call** — input, output, latency; (3) **span** — nested tree (turn → LLM → tool → sub-LLM). Visualize: trace tree (OTel-style) + token heatmap (logprob low = uncertain → highlight). Nối 319 latency-breakdown (span timing), 320 cost-per-step (span cost), JE (265) hallucination-detection (low logprob = suspect).

## Kiến trúc

```
  AGENT TURN (span: "turn")
   │
   ├── span: "llm.generate" (latency: 1.2s, cost: $0.04)
   │     │  prompt: "fix the bug"
   │     │  response tokens (with logprob):
   │     │    "The"  -0.01  ✓ (confident)
   │     │    "bug"  -0.02  ✓
   │     │    "is"   -3.40  ⚠ LOW (uncertain!)
   │     │    "in"   -0.05  ✓
   │     └── logprob heatmap: ⬛⬛🟥⬛  (token 3 = uncertain)
   │
   ├── span: "tool.read" (latency: 20ms)
   │     └── read file.ts → 200 lines
   │
   └── span: "llm.generate" (latency: 0.8s, cost: $0.03)
         └── response: "applied fix"

  VISUAL:
  ┌──────────────────────────────────────┐
  │ turn ████████████████████  2.02s     │
  │  ├ llm ████████████ 1.2s  $0.04      │
  │  ├ tool ██ 20ms                     │
  │  └ llm ████████ 0.8s  $0.03         │
  │ token heatmap: ⬛⬛🟥⬛ (uncertain)   │
  └──────────────────────────────────────┘
```

```
mya: provider + agent-loop + tool-call sẵn — thiếu token logprob capture + span trace + visual render
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/agent — agent-loop (sẵn)
// ✅ 2-providers — LLM call (sẵn, may expose logprobs)
// ✅ 3-tools — tool-call (sẵn)
// ✅ 320 cost-per-step — cost concept (documented)

// ❌ THIẾU: token logprob capture (per-token confidence)
// ❌ THIẾU: span-based trace (OTel-style nested tree)
// ❌ THIẾU: trace visual render (heatmap + span bar)
// ❌ THIẾU: capture-replay (record turn → replay debug)
```

## Implementation

```typescript
// packages/agent/src/trace.ts (NEW)
interface Span {
  name: string;
  parentId: string | null;
  start: number; end: number;
  attributes: Record<string, unknown>;
  children: Span[];
}
interface TokenInfo { token: string; logprob: number; }

export class TraceCollector {
  private spans: Span[] = [];
  private stack: string[] = [];

  startSpan(name: string, attrs: Record<string, unknown> = {}): string {
    const id = cryptoId();
    const parentId = this.stack[this.stack.length - 1] ?? null;
    const span: Span = { name, parentId, start: Date.now(), end: 0, attributes: attrs, children: [] };
    this.spans.push(span);
    this.stack.push(id);
    if (parentId) this.find(parentId)?.children.push(span);
    return id;
  }

  endSpan(id: string, extra: Record<string, unknown> = {}): void {
    const span = this.find(id);
    if (span) { span.end = Date.now(); Object.assign(span.attributes, extra); }
    this.stack.pop();
  }

  // Capture token-level info (logprob from API)
  recordTokens(spanId: string, tokens: TokenInfo[]): void {
    const span = this.find(spanId);
    if (span) span.attributes.tokens = tokens;
  }

  // Flag uncertain tokens (low logprob → hallucination suspect — JE 265)
  suspectTokens(spanId: string, threshold = -2): TokenInfo[] {
    const span = this.find(spanId);
    const tokens = (span?.attributes.tokens as TokenInfo[]) ?? [];
    return tokens.filter((t) => t.logprob < threshold);
  }

  private find(id: string): Span | undefined {
    return this.spans.find((s) => s.name === id || s.parentId === id);
  }
}

// Render: span bar (name + duration) + token heatmap (⬛ confident / 🟥 uncertain)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Debug từng token (logprob — LangSmith) | ❌ Storage cost (trace data lớn) |
| ✅ Span tree — thấy bottleneck (OTel) | ❌ Latency overhead (instrumentation) |
| ✅ Hallucination detect (low logprob — JE 265) | ❌ Not all providers expose logprobs |
| ✅ Capture-replay — reproduce bug | ❌ Visual render effort (UI) |

## Khác các hướng gần

| | 319 Latency | 320 Cost-Per-Step | LF: Token Trace |
|---|---|---|---|
| Tracing | Timing | Cost | **Token logprob + span tree** |
| Visual | ❌ | ❌ | **✅ heatmap + span bar** |
| Debug | Timing | FinOps | **Hallucination + replay** |

## Khi nào chọn

- Debug agent output sai — cần thấy từng token + step
- Hallucination investigation (JE 265 — low logprob)
- Obs cần (LangSmith-style trace) — production observability
- Nối 319 latency-breakdown + 320 cost-per-step + JE (265) hallucination
