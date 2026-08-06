# Hướng NV: Privacy Mode Enforcement — 1 switch: không inference rời máy, enforced core

> **Nguồn gốc:** On-device inference (Apple Intelligence, Gemini Nano); "privacy mode"; "local-first"; hardware-enforced privacy; "no cloud egress"; openhuman; TEE (trusted execution environment)
> **Coupling:** 🟡 — core enforcement gate + local model fallback
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (privacy-budget + data-minimization sẵn — chưa có hard switch + local inference fallback)
> **Effort:** 3-4 tuần

## Nguồn gốc

**On-device inference** (Apple Intelligence, Gemini Nano, llama.cpp local): model chạy **trên thiết bị** — data không rời máy. **Privacy mode** (iOS "Lockdown Mode", browser private mode): 1 switch → hệ thống chuyển sang chế độ hạn chế (no cloud, no telemetry). **Hardware-enforced**: privacy không dựa vào "lời hứa" mà **enforced ở core** (gate chặn mọi egress). **Data minimization** (284): chỉ gửi tối thiểu. Nguyên tắc: **1 switch** bật privacy mode → **mọi** inference chuyển local (không egress), **enforced** (không thể bypass). Khác **347 privacy-budget** (track ε) — NV là **hard on/off** (không gửi gì ra ngoài); khác **284 minimization** (giảm) — NV **loại bỏ hẳn** egress.

## Mô tả

mya privacy mode enforcement: 1 switch (config / env / runtime flag) bật **privacy mode** → **mọi** LLM inference phải chạy local (llama.cpp / Ollama / on-device model), **không** egress ra cloud (no OpenAI/Anthropic API). Enforcement ở **core** (gate kiểm tra mọi outbound request — nếu privacy mode + target không phải local → deny). Nếu không có local model → agent **fail-safe** (từ chối thay vì leak). mya có `347 privacy-budget` + `284 data-minimization` + `282 encrypted-memory` — NV thêm **hard switch** + **local inference routing** + **egress enforcement gate**.

## Kiến trúc

```
   PRIVACY MODE SWITCH: ON / OFF
        │
        ▼ (ON)
   ┌── EGRESS GATE (core enforcement) ───────────────┐
   │                                                  │
   │  Agent muốn gọi LLM:                             │
   │    · target = cloud (api.openai.com)?            │
   │    · privacy mode ON → DENY ❌                   │
   │    · target = local (localhost:11434)?           │
   │    · privacy mode ON → ALLOW ✅                  │
   │                                                  │
   │  → route inference → LOCAL MODEL (Ollama/llama)  │
   │  → data KHÔNG rời máy                            │
   └──────┬───────────────────────────────────────────┘
          │
   ┌── FAIL-SAFE ─────────────────────────────────────┐
   │  · no local model available?                     │
   │  · privacy mode ON → DENY (không leak)           │
   │  · agent trả "privacy mode: local model offline" │
   └──────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 347 MI privacy-budget — track ε (nền — NV hard switch)
// ✅ 284 data-minimization — strip unnecessary (nền)
// ✅ 283 data-classification — classify PII (nền)
// ✅ 282 encrypted-memory-at-rest — encrypt (nền)
// ✅ 332 LT policy-enforcement — deny (gate outcome)

// ❌ THIẾU: privacy mode switch (hard on/off)
// ❌ THIẾU: egress enforcement gate (block cloud khi ON)
// ❌ THIẾU: local inference routing (route → Ollama/llama.cpp)
// ❌ THIẾU: fail-safe (no local model → deny, không leak)
```

## Implementation

```typescript
// packages/privacy/src/privacy-mode.ts (MỚI)
class PrivacyMode {
  private enabled: boolean;

  constructor(enabled = false) {
    this.enabled = enabled;
  }

  // Hard switch
  setOn(): void { this.enabled = true; }
  setOff(): void { this.enabled = false; }
  isOn(): boolean { return this.enabled; }

  // Egress gate — kiểm tra mọi LLM call
  assertAllowed(endpoint: string): void {
    if (!this.enabled) return; // OFF → cho phép tất cả
    // ON → chỉ cho phép local
    if (!this.isLocal(endpoint)) {
      throw new PrivacyError(
        `privacy mode ON: blocked egress to ${endpoint} (local-only)`,
      );
    }
  }

  private isLocal(endpoint: string): boolean {
    return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?/.test(endpoint);
  }
}

// Wire vào provider router
function resolveEndpoint(target: string, mode: PrivacyMode): string {
  mode.assertAllowed(target); // throw nếu vi phạm
  return target;
}

// Fail-safe khi không có local model
async function infer(prompt: string, mode: PrivacyMode): Promise<string> {
  const endpoint = mode.isOn() ? LOCAL_OLLAMA : CLOUD_API;
  try {
    return await llm.complete(prompt, { endpoint });
  } catch {
    if (mode.isOn()) {
      // Không fallback ra cloud — fail-safe
      return '[privacy mode: local model unavailable — refused to egress]';
    }
    throw e;
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Data không rời máy (on-device inference) | ❌ Local model chậm/yếu hơn cloud |
| ✅ Hard switch (đơn giản, rõ ràng) | ❌ Cài local model (Ollama/llama — RAM/GPU) |
| ✅ Enforced core (không bypass được) | ❌ Fail-safe = deny (agent không làm được) |
| ✅ Privacy guarantee mạnh (no egress) | ❌ Không dùng được model mạnh (GPT/Claude) |

## Khác các hướng gần

| | 347 Privacy Budget | 284 Data Minimization | 282 Encrypted Mem | NV: Privacy Mode |
|---|---|---|---|---|
| Cái gì | Track ε budget | Strip fields | Encrypt at rest | **Hard switch no-egress** |
| Switch | ❌ | ❌ | ❌ | ✅ on/off |
| Local-only | ❌ | ❌ | ❌ | ✅ enforced |
| Egress | Cho phép (limited) | Cho phép | Cho phép | **Block hoàn toàn** |

## Khi nào chọn

- Data cực nhạy cảm (health, financial, legal) — không được rời máy
- Compliance strict (on-prem, air-gapped)
- Có local model (Ollama/llama.cpp/Apple Intelligence)
- Kết hợp 347 privacy-budget (track ε) + 284 minimization + 282 encryption; NV là **outermost hard switch** (bật → mọi thứ local); design fail-safe (no local → deny, không leak)
