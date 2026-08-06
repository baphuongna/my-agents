# Hướng TI: Cheap Model Delegation — ủy thác việc menial cho subagent headless model rẻ, parent tự verify trước khi báo thành công

> **Nguồn gốc:** 9arm-skills `skills/` (skill `delegate-to-cheap-model`, `claude -p` headless), `allowedTools` restriction; "delegate menial tasks to subagent with cheaper model"; "parent verifies result before reporting success"; "bounded tools — only allow what's needed" | **Coupling:** 🟢 — dùng subagent pool sẵn, thêm model-tier routing + verify gate | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (subagent pool + spawnSubagent sẵn — chưa có model-tier delegation + verify gate) | **Effort:** 1-2 tuần

## Nguồn gốc

**9arm-skills** khi agent chính gặp việc **menial** (format JSON, generate boilerplate, lint-fix, rename biến) — không cần model đắt — nó **delegate** cho subagent chạy **headless** (`claude -p` CLI với `--model` rẻ hơn) và `allowedTools` **giới hạn** (chỉ cho tool cần thiết, ví dụ `read` + `edit`, không `bash`). Subagent chạy xong → **trả kết quả** → agent chính **verify** (kiểm output có đúng format không, có side-effect ngoài scope không) → **chỉ báo thành công khi verify pass**. Nguyên tắc: **model đắt làm việc khó, model rẻ làm việc dễ** —省钱 không hy sinh chất lượng vì có verify gate. Khác subagent thuần (chạy model giống parent) — TI **tier model** + **verify-first**.

## Mô tả

mya cheap model delegation: (1) **Task classify**: agent chính phân loại task — menial (formatting, boilerplate, rename) vs hard (reasoning, design). (2) **Delegate cheap**: menial → spawn subagent với model rẻ (tier-2 / tier-3 provider) + `allowedTools` giới hạn. (3) **Subagent run**: subagent headless chạy task, chỉ truy cập tool được phép. (4) **Verify gate**: subagent trả output → agent chính **verify** (output format đúng? diff hợp lý? side-effect trong scope?). (5) **Accept/Reject**: verify pass → accept (báo thành công); fail → reject + retry hoặc tự làm. mya có `spawnSubagent` + `allowedTools` — TI thêm **model-tier router** + **verify gate**.

## Kiến trúc

```
  AGENT (model đắt: GPT-4 / Claude-Opus)
        │
        │  task: "format all .json files in src/"
        │  classify: MENIAL (formatting, không cần reasoning)
        ▼
  ┌─── DELEGATE (cheap model, bounded tools) ───────────┐
  │  spawnSubagent("format all .json in src/")            │
  │    model: tier-2 (Haiku / GPT-4o-mini)                │
  │    allowedTools: ["read", "write"]  (không bash)     │
  │  → subagent headless chạy, format, trả diff           │
  └───────────────────────┬─────────────────────────────┘
                          │ (subagent output)
                          ▼
  ┌─── VERIFY GATE (agent chính kiểm) ───────────────────┐
  │  check 1: format đúng? (valid JSON, indent 2)         │
  │  check 2: diff hợp lý? (chỉ format, không đổi logic)  │
  │  check 3: side-effect? (không đụng file ngoài src/)   │
  │  → PASS → accept (báo thành công)                     │
  │  → FAIL → reject + retry / tự làm                     │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/agent spawnSubagent — subagent lifecycle (nền — TI delegate ở đây)
// ✅ packages/agent allowedTools — tool restriction per subagent (nền — TI bound tools)
// ✅ packages/ai ProviderRegistry — multi-provider (nền — TI chọn model rẻ)
// ✅ packages/core budget — cost tracking (nền — TI track tiết kiệm)

// ❌ THIẾU: model-tier router (classify menial → chọn tier-2 model)
// ❌ THIẾU: verify gate (check subagent output trước accept)
// ❌ THIẾU: retry-on-verify-fail (reject → retry cheap hoặc fallback parent)
```

## Implementation

```typescript
// packages/agent/src/cheap-delegation.ts (MỚI)
type TaskTier = "menial" | "hard";

interface DelegateOpts {
  task: string;
  allowedTools: string[];   // bounded — chỉ tool cần
  cheapModel: string;       // tier-2 model id
  verify: (output: string) => Promise<boolean>; // verify gate
}

class CheapModelDelegation {
  constructor(private spawn: (goal: string, opts?: { allowedTools?: string[]; model?: string }) => SubagentHandle) {}

  async delegate(opts: DelegateOpts): Promise<{ ok: boolean; output: string; verified: boolean }> {
    const sub = this.spawn(opts.task, { allowedTools: opts.allowedTools, model: opts.cheapModel });
    const output = await sub.wait();
    // VERIFY GATE — agent chính kiểm trước khi accept
    const verified = await opts.verify(output);
    if (!verified) {
      // reject: subagent output không pass verify → không báo thành công
      return { ok: false, output, verified: false };
    }
    return { ok: true, output, verified: true };
  }
}

// Usage:
// const r = await delegation.delegate({
//   task: "format all .json files in src/",
//   allowedTools: ["read", "write"],          // bounded — không bash
//   cheapModel: "haiku-3.5",                  // tier-2 rẻ
//   verify: async (out) => out.includes("formatted"),  // verify gate
// });
// → r.ok = true chỉ khi verify pass
```

## Được

- ✅ Tiết kiệm cost (model rẻ làm việc menial, model đắt làm việc khó)
- ✅ Verify gate (chấp nhận output chất lượng, reject output sai)
- ✅ Bounded tools (subagent chỉ truy cập tool cần — giảm blast radius)
- ✅ Parallel menial (delegate nhiều task menial song song)

## Mất

- ❌ Verify overhead (mỗi delegate → 1 verify pass, có thể tốn reasoning)
- ❌ Falsify risk (verify pass nhưng output sai — verify không hoàn hảo)
- ❌ Retry cost (verify fail → retry hoặc fallback parent, tốn thêm)
- ❌ Latency (delegate + wait + verify ≥ tự làm nếu task nhỏ)

## Khác

Khác **subagent thuần** (chạy model giống parent, không verify) — TI **tier model** (rẻ cho menial) + **verify-first** (không tin mù). Khác **batch tool** (gộp tool call) — TI là **delegation to cheaper agent**. Khác **TO degraded-mode-shrink** (thu hẹp khi thiếu resource) — TI là **cost optimization khi đủ resource nhưng muốn rẻ**.

## Khi nào chọn

- Agent chính dùng model đắt, nhiều task menial không cần reasoning
- Muốn tiết kiệm cost (delegate menial → model rẻ, parent chỉ verify)
- Verify gate đáng tin (output check được — format, diff, side-effect)
- Nối packages/agent spawnSubagent + allowedTools + packages/ai ProviderRegistry (multi-tier model); guard verify quality (check thật, không chỉ "output non-empty"), retry policy (verify fail → retry N lần rồi fallback parent), và tool bounding (chỉ cho tool tối thiểu — blast radius nhỏ); TI = cheap model delegation, kết hợp TJ clean-handoff-ritual (delegate xong → handoff artifact) + TN run-summary-observability (track tiết kiệm cost)
