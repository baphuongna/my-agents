# Hướng AHA: Provider Registry Factory — provider registry dùng factory map name→instance; hasProviderCredentials quyết định enable mặc định, provider detection từ model id

> **Nguồn gốc:** pi-sub | **Coupling:** 🟡 — bind vào provider/model layer | **Agent-agnostic:** ❌ (cốt lõi provider) | **Code sẵn:** ✅ (mya có ai/registry.ts ProviderRegistry + provider-discovery.ts) | **Effort:** 1 tuần

## Nguồn gốc

**pi-sub** provider registry dùng **factory map** `name → instance` (Anthropic, Copilot, Gemini, Codex, Kiro, Zai...). **`hasProviderCredentials`** quyết định provider nào **enable mặc định** (có key → bật). **Provider detection từ model id** — parse model string (vd `claude-sonnet-4` → Anthropic, `gpt-4o` → OpenAI/Copilot) để route đúng factory. Triết lý: registry **mở rộng bằng registration** (thêm provider = thêm entry map), **auto-enable theo credential**, **detect từ model id** (không cần khai báo tường minh).

Nguyên tắc: **factory map** (name→instance, dễ thêm provider); **credential-gated enable** (có key mới bật); **model-id detection** (route theo prefix/pattern); **registry mở rộng** (registration thay vì hardcode switch).

## Mô tả

Với mya, pattern này **đã có nền vững**: packages/ai `registry.ts` (`ProviderRegistry` — register/all/taint/cooldown) + `provider-discovery.ts` (detect provider) + `fallback.ts` (streamWithFallback thử profile order). mya dùng `ProviderProfile` list + taint, nhưng **chưa có rõ**: (1) **factory map** thuần (name→factory instance), (2) **`hasProviderCredentials`** auto-enable mặc định. Pattern gần như đã implement — chỉ thiếu credential-gated auto-enable layer rõ ràng.

## Kiến trúc (ASCII)

```
  PROVIDER FACTORY MAP
   name → factory()
   ├─ anthropic  ─► hasProviderCredentials? → enable mặc định
   ├─ copilot    ─► hasProviderCredentials? → enable mặc định
   ├─ gemini     ─► ...
   └─ ...
        │
        ▼
  provider detection từ model id:
    "claude-sonnet-4" → anthropic
    "gpt-4o"          → copilot/openai
        │
        ▼
  route → factory.create() → provider instance
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/ai/src/registry.ts — ProviderRegistry (register/all/taint/cooldown)
// ✅ packages/ai/src/provider-discovery.ts — detect provider (test: provider-discovery.test.ts)
// ✅ packages/ai/src/fallback.ts — streamWithFallback (try profile order, skip tainted)
// ✅ packages/ai/src/key-rotation.ts — key management
// ⚠️ CHƯA rõ hasProviderCredentials auto-enable mặc định (gate theo credential)
// ⚠️ CHƯA rõ factory map thuần (name→factory, hiện dùng ProviderProfile list)
```

## Implementation

```typescript
// packages/ai/src/provider-factory.ts (NEW) — bổ sung layer factory + credential-gate
import { ProviderRegistry } from "./registry.js";
import type { ProviderProfile } from "@my-agent/core";

export type ProviderFactory = () => ProviderProfile;
export type CredentialProbe = () => boolean;

const FACTORY_MAP = new Map<string, { factory: ProviderFactory; hasCreds: CredentialProbe }>();

/** Đăng ký provider: factory + credential probe. Mở rộng bằng registration. */
export function registerProvider(name: string, factory: ProviderFactory, hasCreds: CredentialProbe): void {
  FACTORY_MAP.set(name, { factory, hasCreds });
}

/** Auto-enable mặc định theo credential — có key mới register vào registry. */
export function autoEnableProviders(registry: ProviderRegistry): string[] {
  const enabled: string[] = [];
  for (const [name, { factory, hasCreds }] of FACTORY_MAP) {
    if (hasCreds()) { registry.register(factory()); enabled.push(name); }  // credential-gated
  }
  return enabled;
}

/** Detect provider từ model id (prefix/pattern). */
export function detectProvider(modelId: string): string | undefined {
  const id = modelId.toLowerCase();
  if (id.startsWith("claude")) return "anthropic";
  if (id.startsWith("gpt") || id.startsWith("o1")) return "copilot";   // hoặc openai
  if (id.startsWith("gemini")) return "gemini";
  return undefined;
}

// Boot: registerProvider("anthropic", () => makeAnthropic(), () => !!process.env.ANTHROPIC_API_KEY);
//       autoEnableProviders(registry);  // chỉ provider có key mới vào fallback chain
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Thêm provider = thêm entry map (mở rộng dễ) | ❌ Credential probe phải đúng (sai → enable nhầm) |
| ✅ Auto-enable theo credential (không bật provider không key) | ❌ Detection từ model id cần maintain pattern map |
| ✅ Detection route đúng factory | ❌ Factory map lớn → boot scan tất cả probe |

## Khác các hướng gần

| | AHA Provider Factory | AGR SDK Fallback | ai/registry.ts |
|---|---|---|---|
| Trọng tâm | Factory map + credential-gate | Degrade khi thiếu dep | Provider list + taint |
| Cơ chế | name→factory, hasCreds auto-enable | isAvailable → SDK | register/all/taint/cooldown |
| Quan hệ | Nối provider bootstrap | Nối robustness | Nối provider lifecycle |

## Khi nào chọn

- Nhiều provider (Anthropic/Copilot/Gemini...) — cần registry mở rộng
- Muốn auto-enable theo credential (có key mới bật)
- Cần detect provider từ model id (route đúng factory)
- Guard: factory map registration, credential probe đúng, detection pattern maintain
