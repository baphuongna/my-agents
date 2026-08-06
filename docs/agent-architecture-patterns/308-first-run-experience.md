# Hướng KV: First-Run Experience — onboarding có hướng dẫn, setup lần đầu

> **Nguồn gốc:** Onboarding flows (Slack/Notion); first-run wizards; progressive onboarding; "aha moment"
> **Coupling:** 🟡 — cần tầng CLI/UX onboarding
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (onboarding doc sẵn — thiếu guided flow)
> **Effort:** 2 tuần

## Nguồn gốc

**First-run experience / onboarding**: trải nghiệm lần đầu dùng sản phẩm — Slack/Notion wizards hướng dẫn từng bước đến "aha moment". Nguyên tắc UX: lần đầu user **chưa biết gì** → hướng dẫn setup (API key, config) + hướng dẫn dùng (làm gì đầu tiên). Progressive onboarding: không dump hết, phơi dần (99 progressive-disclosure). Empty-state guidance: khi chưa có gì, cho gợi ý ("thử hỏi agent điều gì"). Mục tiêu: user setup xong, biết dùng, không bỏ cuộc ở bước 1.

## Mô tả

mya first-run: lần đầu `mya` chạy → wizard: (1) **setup** — xin API key (62 credential), chọn model (178), config cơ bản (293 hermetic); (2) **guided first task** — gợi ý thử ("hỏi agent tóm tắt repo này"); (3) **progressive tips** — sau khi quen, phơi tính năng nâng cao (99). Detect first-run (chưa có config) → wizard; đã có config → bỏ qua. Nối 153 agent-onboarding (doc) + 99 progressive-disclosure. Khác doc tĩnh: KV **wizard tương tác** — hỏi từng bước, validate.

## Kiến trúc

```
  $ mya  (lần đầu — chưa có config)
        │
        ▼ detect first-run
  ┌─────────── ONBOARDING WIZARD ───────────┐
  │                                         │
  │  1. SETUP                               │
  │     • API key? (62 credential)          │
  │     • model mặc định? (178)             │
  │     • hermetic config? (293)            │
  │     → validate mỗi bước                 │
  │                                         │
  │  2. GUIDED FIRST TASK                   │
  │     "Thử hỏi agent: tóm tắt repo này"   │
  │     → user chạy → thấy giá trị (aha)    │
  │                                         │
  │  3. PROGRESSIVE TIPS (99)               │
  │     sau khi quen → phơi: subagent,      │
  │     multi-window (KT), redteam (303)    │
  └─────────────────────────────────────────┘
        │ lưu config → lần sau bỏ qua wizard
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 153 agent-onboarding — onboarding (documented, nền)
// ✅ 99 progressive-disclosure — phơi dần (nền tips)
// ✅ 62 credential-broker — credential (bước setup)
// ✅ 226 human-approval-gates — approval (confirm setup)
// ✅ packages/agent/src/config.ts — config (wizard ghi)

// ❌ THIẾU: interactive wizard (hỏi từng bước)
// ❌ THIẾU: first-run detection (chưa có config)
// ❌ THIẾU: per-step validation (API key hợp lệ?)
// ❌ THIẾU: guided first-task (gợi ý aha-moment)
```

## Implementation

```typescript
// packages/agent/src/first-run.ts (NEW)
import { existsSync } from "node:fs";

function isFirstRun(): boolean { return !existsSync(configPath); }

async function wizard(): Promise<Config> {
  // 1. SETUP — hỏi + validate từng bước
  const apiKey = await prompt("API key (sk-...): ");
  if (!apiKey.startsWith("sk-")) throw new Error("key không hợp lệ"); // validate
  const model = await choose(["gpt-4o", "claude", "local-211"]);
  const cfg = { apiKey, model, hermetic: true }; // 293

  await save(cfg); // lưu → lần sau bỏ qua
  return cfg;
}

async function guidedFirstTask(): Promise<void> {
  // 2. aha-moment — gợi ý thử
  const ok = await confirm("Thử hỏi agent: 'Tóm tắt repo này'? (y/n)");
  if (ok) await agent.run("Tóm tắt repo này");
  // 3. progressive tips phơi dần (99) khi user đã quen
  print("Sau khi quen: thử subagent, multi-window (KT), eval (41)...");
}

export async function maybeOnboard(): Promise<Config | null> {
  if (!isFirstRun()) return null; // đã setup → bỏ qua
  const cfg = await wizard();
  await guidedFirstTask();
  return cfg;
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ User setup xong, biết dùng (onboarding proven) | ❌ Wizard có thể chậm người dùng nâng cao |
| ✅ Giảm friction lần đầu (không stuck bước 1) | ❌ Cần detect first-run chính xác |
| ✅ aha-moment sớm (thấy giá trị ngay) | ❌ Gợi ý có thể không hợp user |
| ✅ Nối 153 + 99 (doc → wizard tương tác) | ❌ Maintain wizard khi config đổi |

## Khác các hướng gần

| | 153 Agent Onboarding | 99 Progressive Disclosure | KV: First-Run Experience |
|---|---|---|---|
| Dạng | Doc/concept | Phơi dần tính năng | **Wizard tương tác lần đầu** |
| Khi | Bất cứ lúc | Khi cần | **Chỉ lần đầu** |
| Validate | ❌ | ❌ | ✅ per-step |
| aha-moment | ❌ | ❌ | ✅ guided first task |

## Khi nào chọn

- Agent mới dùng cần setup (API key, model) + hướng dẫn
- Muốn giảm friction lần đầu (không stuck)
- Cần aha-moment sớm (user thấy giá trị ngay)
- Bổ sung 153 (doc) bằng wizard tương tác
