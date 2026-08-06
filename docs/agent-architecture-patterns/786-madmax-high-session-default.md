# Hướng ADF: Madmax High Session Default — wrapper khởi động Codex mạnh hơn mặc định, giữ execution engine và thêm workflow layer

> **Nguồn gốc:** oh-my-codex | **Coupling:** 🟡 — lớp wrapper quanh CLI ngoài, đổi model flags nhưng giữ engine | **Agent-agnostic:** ⚠️ — hướng tới Codex CLI, cấu hình theo model cụ thể | **Code sẵn:** ⚠️ (sẵn profile + workflow layer; thiếu cơ chế omx tổng quát) | **Effort:** 1-2 tuần

## Nguồn gốc

**oh-my-codex** là shell plugin nâng cấp trải nghiệm **Codex CLI**. Pattern **ADF** lấy ý tưởng: `omx --madmax --high` bọc Codex bằng flags mạnh hơn mặc định — **madmax** kích hoạt mọi capability có thể (tool use rộng, context lớn, tự do hành động), **high** nâng nhiệt độ/effort của model. Codex vẫn là **execution engine** — không thay thế model hay loop bên trong.

Phần quan trọng nhất là **workflow layer** phía trên: deep-interview → ralplan → ralph → team. Mỗi stage là một skill/convention riêng: deep-interview thu thập yêu cầu chi tiết, ralplan (Ralph's plan) tạo kế hoạch triển khai, ralph là execution agent, team mở rộng sang nhiều worker. Durable state `.omx/` lưu plans/logs/memory/mode tracking — agent chết giữa chừng vẫn resume được.

## Mô tả

mya có thể học pattern này ở hai tầng: (1) **profile layer** — định nghĩa "session profile" (madmax/high/normal/cautious) như một tập flags + tool permissions + context budget áp dụng khi khởi tạo Session; (2) **workflow layer** — chuỗi stage có trạng thái (interview → plan → execute → team) lưu durable, mỗi stage gọi provider bình thường. Điểm mấu chốt: profile chỉ đổi **cách gọi LLM** (temperature, effort, tool set), còn **loop + memory + audit** của mya giữ nguyên — đúng tinh thần "giữ execution engine, thêm workflow".

## Kiến trúc (ASCII)

```
  USER ── omx --madmax --high <prompt>
            │
            ▼
  WORKFLOW LAYER (durable .omx/)
    ├─ deep-interview ──► thu thập yêu cầu (Q&A, notes)
    ├─ ralplan        ──► kế hoạch triển khai (PLAN.md)
    ├─ ralph          ──► execution agent (chạy plan)
    └─ team           ──► mở rộng worker song song
            │
            ▼
  CODEX CLI (execution engine, flags madmax+high)
    └─ LLM call (effort cao, tool use rộng)
            │
            ▼
  .omx/  plans · logs · memory · mode tracking (resume)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/ai — ProviderRegistry + OpenAIAdapter + streamWithFallback
//   (nơi gắn profile flags: temperature/effort/tool set)
// ✅ packages/core — Session + runTurn + TurnHandle (loop giữ nguyên)
// ✅ packages/workflows — WorkflowContext + rhai-runner (stage scripting)
// ✅ packages/memory — Brain SQLite + FileBackend (nền .omx/ durable state)
// ✅ packages/agent — createAgent assembly (nơi chèn session profile)

// ❌ THIẾU: session profile registry (madmax/high/normal/cautious)
// ❌ THIẾU: workflow stage state machine (interview→plan→execute→team)
// ❌ THIẾU: mode tracking durable (đang ở stage nào, resume được)
```

## Implementation

```typescript
// packages/ai/src/session-profile.ts (NEW)
export type SessionProfileName = "madmax" | "high" | "normal" | "cautious";

export interface SessionProfile {
  effort: number;             // 0..1 — mức tự do hành động của model
  allowedTools: string[];     // madmax: mọi tool; cautious: read-only
  contextBudget: number;      // token tối đa cho session
  sticky: boolean;            // giữ conversation ổn định (cache prefix)
}

const PROFILES: Record<SessionProfileName, SessionProfile> = {
  madmax:   { effort: 1.0, allowedTools: ["*"],  contextBudget: 256_000, sticky: true },
  high:     { effort: 0.8, allowedTools: ["*"],  contextBudget: 128_000, sticky: true },
  normal:   { effort: 0.5, allowedTools: ["*"],  contextBudget: 64_000,  sticky: false },
  cautious: { effort: 0.2, allowedTools: ["read", "grep", "find"], contextBudget: 32_000, sticky: false },
};

export function resolveProfile(name: SessionProfileName): SessionProfile {
  return PROFILES[name];
}

// packages/workflows/src/stages.ts (NEW)
export type Stage = "interview" | "plan" | "execute" | "team";
export async function runStagedWorkflow(ctx: WorkflowContext): Promise<void> {
  // mỗi stage đọc/write durable state, resume được khi chết giữa chừng
  await ctx.run("interview", collectRequirements);
  await ctx.run("plan", createPlan);
  await ctx.run("execute", executePlan);
  if (ctx.state.mode === "team") await ctx.run("team", spawnWorkers);
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Codex mạnh hơn ngay, không đổi engine | ❌ Flags hardcode theo model — kém tổng quát |
| ✅ Workflow layer có trạng thái, resume được | ❌ Session profile phức tạp hóa config |
| ✅ Mode tracking biết đang ở stage nào | ❌ Madmax tốn token/tiền khi task nhỏ |
| ✅ Layer tách bạch: profile vs loop vs memory | ❌ Profile sai ngưỡng → agent hành động quá tay |

## Khác các hướng gần

| | ADF Madmax Profile | ADG tmux Team | ADH Acceptance Criteria |
|---|---|---|---|
| Trọng tâm | Mạnh execution qua flags | Nhiều worker ngoài | Gate trước khi chạy |
| Durable state | `.omx/` plans/logs/mode | `.omx/state/team/` | Criterion list |
| Đổi engine | Không (Codex giữ) | Có (Codex/Claude) | Không |

## Khi nào chọn

- Muốn agent mạnh hơn mà không viết lại execution engine
- Task cần nhiều stage (interview → plan → execute) với state durable
- Đã có workflow runner + memory — chỉ thêm profile + stage machine
- Team muốn convention "mode" rõ ràng (madmax cho task lớn, cautious cho task nhạy cảm)