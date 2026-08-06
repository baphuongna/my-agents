# Hướng KG: Hermetic Config — config hermetic, rebuild deterministic, reproduce được

> **Nguồn gốc:** Bazel hermetic builds; Nix reproducible builds; 12-factor config (env vars); DORA SRE; content-addressed deps
> **Coupling:** 🟢 — config layer tách riêng
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (config sẵn — thiếu pinning + hashing)
> **Effort:** 1 tuần

## Nguồn gốc

**Hermetic build** (Bazel): "all inputs are fully known" — không phụ thuộc môi trường ngoài, cùng input → cùng output (deterministic). Nix: pure functional package manager — hash tất cả dependency, rebuild reproduce được trên máy khác. 12-factor (Heroku): config tách khỏi code (env vars), không hardcode. Nguyên tắc hermetic: (1) **mọi input được pin** (version chính xác, không `latest`), (2) **không network random** (pin API, cache), (3) **config hashable** (đầu ra xác định bởi hash config). Kết quả: cùng agent-config → cùng hành vi, mọi nơi, mọi lúc.

## Mô tả

mya hermetic config: agent config (model version, prompt 173, tool 40, temperature) được **pin + hash**. Một config = 1 hash; cùng hash → cùng output (với cùng seed). Không đọc "latest" (model đổi version → drift 103). Mọi thứ có version: model `gpt-4-0613` không `gpt-4`, prompt pin commit hash, tool pin schema hash (97). Reproduce: cho config hash → rebuild agent y hệt → replay session (94) cho cùng kết quả. Khác config thường: hermetic **không phụ thuộc ngoài** — deterministic, audit được.

## Kiến trúc

```
  ┌──────────────── HERMETIC AGENT CONFIG ─────────────────┐
  │                                                        │
  │  inputs:                                               │
  │    model:    "gpt-4-0613"   (pinned — NOT "latest")    │
  │    prompt:   commit:abc123  (pinned git ref)           │
  │    tools:    schema-hash:7f... (pinned, 97)            │
  │    temp:     0.0            (deterministic)            │
  │    seed:     42                                          │
  │         │                                              │
  │         ▼   SHA-256                                     │
  │    CONFIG HASH: 9a3f...   ← identity của config        │
  │         │                                              │
  │         ▼                                              │
  │  ┌─────────────┐     same hash    ┌─────────────┐      │
  │  │ Agent build │ ──────────────►  │ Agent build │      │
  │  │ (machine A) │  = same output   │ (machine B) │      │
  │  └─────────────┘                  └─────────────┘      │
  │                                                        │
  │  Reproduce: config-hash 9a3f... → rebuild y hệt →     │
  │  replay session (94) → cùng kết quả                    │
  └────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/agent/src/config.ts — config loader
// ✅ 173 prompt-versioning — prompt pin commit (tiền đề hermetic)
// ✅ 135 agent-versioning — version agent
// ✅ 122 agent-reproducibility — reproduce (mục tiêu hermetic)
// ✅ 97 tool-schema-drift — schema hash (pin tool)

// ❌ THIẾU: config hash (SHA-256 trên mọi input)
// ❌ THIẾU: strict pinning (cấm "latest", cấm network random)
// ❌ THIẾU: hermetic gate trong CI (reject non-pinned config)
// ❌ THIẾU: reproduce-from-hash (rebuild + replay)
```

## Implementation

```typescript
// packages/agent/src/hermetic.ts (NEW)
import { createHash } from "node:crypto";

interface HermeticConfig {
  model: string;      // phải pin version: "gpt-4-0613"
  promptRef: string;  // git commit hash
  toolSchemaHash: string;
  temperature: number; // 0.0 cho deterministic
  seed: number;
}

function hashConfig(c: HermeticConfig): string {
  // Hash theo thứ tự cố định — deterministic
  const stable = JSON.stringify(
    { m: c.model, p: c.promptRef, t: c.toolSchemaHash, temp: c.temperature, s: c.seed },
    Object.keys({ m: 0, p: 0, t: 0, temp: 0, s: 0 }).sort(),
  );
  return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

function assertPinned(c: HermeticConfig): void { // hermetic gate
  if (!/\d{4}-\d{2}-\d{2}$/.test(c.model) && !/\d+$/.test(c.model)) {
    throw new Error(`model không pin version: ${c.model} — hermetic vi phạm`);
  }
}

// Reproduce: cho config-hash → load config y hệt → rebuild
function reproduce(configHash: string): HermeticConfig {
  return registry.getByHash(configHash); // load config đã pin
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Deterministic — cùng config → cùng output (Bazel/Nix) | ❌ Mọi input phải pin (boilerplate) |
| ✅ Reproduce session trên máy khác (audit) | ❌ Không dùng "latest" → update thủ công |
| ✅ Chặn drift (103) — model đổi version bị phát hiện | ❌ Config hash phức tạp khi input sâu |
| ✅ Debug: reproduce bug từ config-hash | ❌ Temperature ≠ 0 → vẫn random (cần seed + API hỗ trợ) |

## Khác các hướng gần

| | 173 Prompt Versioning | 122 Reproducibility | KG: Hermetic Config |
|---|---|---|---|
| Pin gì | Prompt (commit) | Toàn session | **Mọi input + hash** |
| Mục | A/B test, rollback | Replay kết quả | **Rebuild deterministic** |
| Gate | ❌ | ❌ | ✅ CI reject non-pinned |
| Hash | ❌ | session-id | **config-hash (identity)** |

## Khi nào chọn

- Cần reproduce agent trên máy khác (debug, audit, compliance)
- Muốn chặn drift (103) khi model/tool đổi version
- Cùng config → cùng output (eval, regression 297)
- Build/deploy cần deterministic (CI reproducible)
