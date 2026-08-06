# Hướng QL: Stream Abort Rule Injection — cookie regex mid-stream abort, tiêm rule vào system-reminder

> **Nguồn gốc:** oh-my-pi (stream abort rule injection); "mid-stream response interception"; "cookie-regex pattern detection in streaming"; "system-reminder rule injection after abort"; "streaming guardrail with corrective re-prompt"
> **Coupling:** 🟡 — cần stream interceptor + cookie-regex matcher + system-reminder injector
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (streaming + system-reminder sẵn — chưa có cookie-regex abort + rule injection)
> **Effort:** 2-3 tuần

## Nguồn gốc

**oh-my-pi** can thiệp **giữa stream** (response đang sinh token-by-token). **Cookie regex** quét stream real-time → phát hiện pattern cấm (PII leak, dangerous code, off-topic). Khi match → **abort** stream (ngắt ngay) → **inject rule** vào **system-reminder** cho turn kế tiếp ("KHÔNG lặp pattern X, thay vào làm Y"). Giống **content filter** (guardrail) nhưng **mid-stream** (không đợi response xong) + **corrective** (inject rule sửa hành vi, không chỉ block). **Cookie regex**: regex được "đặt" (cookie) vào stream matcher, linh hoạt cập nhật. Nguyên tắc: **phát hiện sớm + sửa ngay** — abort sớm tiết kiệm token, rule injection sửa root cause. Khác **394 safeguard-tiering** (pre-response filter) — QL là **mid-stream**; khác **446 QD subconscious** (background) — QL là **real-time**.

## Mô tả

mya stream abort rule injection: **stream interceptor** sits giữa LLM stream và user. Mỗi token chunk → **cookie-regex matcher** check. Nếu match → (1) **abort** (ngắt stream, discard partial), (2) **inject rule** vào system-reminder ("Rule: avoid pattern X. Instead, do Y"), (3) **re-dispatch** turn với rule. Cookie regex = dynamic (có thể cập nhật runtime). Nối streaming + 394 safeguard-tiering + system-reminder + 446 subconscious-steering.

## Kiến trúc

```
  LLM STREAM (token-by-token):
  "Here's how to disable the firewall: sudo ufw..."
       │  ← cookie-regex scanning each chunk
       ▼
  ┌─── COOKIE-REGEX MATCHER (real-time) ──────────────────┐
  │                                                        │
  │  cookies (active regex patterns):                      │
  │  ① /disable.*firewall|ufw deny/i  → security-violation │
  │  ② /\bSSN\b.*\d{3}-\d{2}/        → PII-leak           │
  │  ③ /rm\s+-rf\s+\//               → destructive-cmd    │
  │                                                        │
  │  chunk "sudo ufw..." → MATCHES cookie ①               │
  │  → ABORT stream immediately                            │
  │                                                        │
  └────────────────────────┬───────────────────────────────┘
                           │ (abort)
                           ▼
  ┌─── RULE INJECTION (system-reminder) ──────────────────┐
  │                                                        │
  │  Inject rule into system-reminder for next turn:       │
  │  [system-reminder]                                     │
  │  ⚠️ Your previous response was aborted (security-     │
  │  violation: disabling firewall). RULE: Do NOT provide  │
  │  instructions to disable security controls. Instead,   │
  │  explain the risks and suggest safer alternatives.     │
  │                                                        │
  │  → RE-DISPATCH turn with corrective rule               │
  │  → agent generates safe response                       │
  │                                                        │
  └────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ streaming — token streaming (nền — QL = intercept mid-stream)
// ✅ system-reminder — system reminder injection (nền — QL = rule carrier)
// ✅ 394 safeguard-model-tiering — pre-response filter (relate — QL = mid-stream)
// ✅ 446 subconscious-steering — background nudge (relate — QL = real-time)

// ❌ THIẾU: stream interceptor (sit between LLM stream and user)
// ❌ THIẾU: cookie-regex matcher (real-time pattern detection on stream)
// ❌ THIẾU: mid-stream abort (discard partial response on match)
// ❌ THIếU: corrective rule injection (system-reminder after abort)
```

## Implementation

```typescript
// packages/agent/src/stream-abort.ts (NEW)
interface CookieRegex {
  id: string;
  pattern: RegExp;
  rule: string;        // corrective rule to inject on match
  severity: 'warn' | 'block';
}

class StreamAbortInjector {
  private cookies: CookieRegex[] = [];
  private buffer = '';

  // Register a cookie regex (can be updated at runtime)
  addCookie(cookie: CookieRegex): void {
    this.cookies.push(cookie);
  }
  removeCookie(id: string): void {
    this.cookies = this.cookies.filter((c) => c.id !== id);
  }

  // Process each stream chunk — returns abort signal if pattern matched
  processChunk(chunk: string): { abort: boolean; cookie?: CookieRegex } {
    this.buffer += chunk;
    for (const cookie of this.cookies) {
      if (cookie.pattern.test(this.buffer)) {
        return { abort: true, cookie };
      }
    }
    return { abort: false };
  }

  // Build corrective system-reminder after abort
  buildRuleInjection(cookie: CookieRegex): string {
    return (
      `⚠️ Your previous response was aborted (${cookie.id}). ` +
      `RULE: ${cookie.rule} ` +
      `Do not repeat the aborted pattern. Generate a compliant response instead.`
    );
  }

  // Reset buffer for new stream
  reset(): void {
    this.buffer = '';
  }
}

// Integration with agent-loop stream handling
async function streamWithAbort(
  stream: AsyncIterable<string>,
  injector: StreamAbortInjector,
  reinject: (rule: string) => Promise<void>,
): Promise<void> {
  injector.reset();
  for await (const chunk of stream) {
    const { abort, cookie } = injector.processChunk(chunk);
    if (abort && cookie) {
      // Abort: discard partial, inject corrective rule, re-dispatch
      const rule = injector.buildRuleInjection(cookie);
      await reinject(rule);
      return; // stop processing this stream
    }
    // Forward chunk to user (no abort)
    process.stdout.write(chunk);
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Phát hiện sớm (mid-stream, không đợi xong) | ❌ Stream complexity (interceptor thêm layer) |
| ✅ Tiết kiệm token (abort sớm = không sinh tiếp) | ❌ False positive (match nhầm → abort không cần) |
| ✅ Corrective (inject rule sửa root cause, không chỉ block) | ❌ Re-dispatch cost (abort → re-generate = 2x token) |
| ✅ Dynamic cookies (regex cập nhật runtime) | ❌ Buffer management (regex trên partial = tricky) |

## Khác các hướng gần

| | 394 Safeguard-Tiering | 446 Subconscious | 449 Command-Class-Gate | QL: Stream-Abort |
|---|---|---|---|---|
| Khi | Pre-response | Background | Pre-dispatch | **Mid-stream** |
| Cơ chế | Model filter | System nudge | Regex classify | **Cookie-regex + abort** |
| Sửa? | ❌ (block) | ✅ (nudge) | ❌ (deny) | **✅ (rule injection)** |

## Khi nào chọn

- Cần can thiệp mid-stream (không đợi response xong)
- Pattern cấm cần phát hiện sớm (PII, dangerous code, off-topic)
- Muốn corrective (inject rule sửa hành vi, không chỉ block)
- Cần dynamic cookies (regex cập nhật runtime)
- Nối streaming + 394 safeguard-model-tiering + system-reminder + 446 subconscious-steering
