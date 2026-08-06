# Hướng TK: Debug Mantra Discipline — 4 bước: reproduce → trace fail path → falsify hypothesis → cross-reference breadcrumbs

> **Nguồn gốc:** 9arm-skills `skills/debug-mantra/SKILL.md` (mantra text, 4-step protocol); "read the debug mantra at the start of every debugging session"; "reproduce first — pass/fail signal in 1-5s"; "trace the fail path, not the happy path"; "falsify hypotheses, don't confirm them"; "cross-reference breadcrumbs — don't assume" | **Coupling:** 🟢 — prompt-skill / system-prompt injection, không cần code mới | **Agent-agnostic:** ✅ | **Code sẵn:** ✅ (skill system + system prompt sẵn — mantra chỉ là nội dung skill) | **Effort:** 0.5-1 tuần

## Nguồn gốc

**9arm-skills** khi agent debug, lỗi phổ biến nhất là **suy đoán** (đoán nguyên nhân, fix theo đoán, không verify). Debug mantra là **kỷ luật 4 bước** agent đọc thuộc lòng đầu phiên debug: (1) **Reproduce** — tạo tín hiệu pass/fail lặp lại được, **nhanh** (1-5s, không chờ 5 phút). (2) **Trace fail path** — đi theo đường code THẤT BẠI (không phải happy path — fail path mới có bug). (3) **Falsify hypothesis** — thay vì confirm "có thể bug ở đây?", **falsify** "chứng minh giả thuyết SAI" (nếu không falsify được → gần đúng hơn). (4) **Cross-reference breadcrumbs** — đọc log/trace/breadcrumbs từ nhiều nguồn, **không assume** (stack trace, diff, git log, test output). Nguyên tắc: **debug có kỷ luật**, không đoán mò.

## Mô tả

mya debug mantra discipline: (1) **Mantra inject**: đầu phiên debug (khi user nói "fix bug" / test fail), inject mantra vào context (system prompt skill block hoặc user-facing reminder). (2) **4-step enforcement**: mantra yêu cầu agent theo 4 bước, không skip. (3) **Fast reproduce**: mantra nhấn mạnh "reproduce 1-5s" — nếu reproduce chậm (build 10 phút) → agent phải rút ngắn trước (unit test isolate, mock). (4) **Falsify-first**: thay vì confirm hypothesis, agent **falsify** — "giả thuyết: bug ở function X. Falsify: nếu bỏ X, bug còn không? Nếu còn → X không phải nguyên nhân." mya có skill system + system prompt — TK chỉ là **nội dung skill** (debug-mantra SKILL.md) + **trigger phrase**.

## Kiến trúc

```
  DEBUG SESSION (user: "fix bug — test fail")
        │
        │  trigger: debug session detected
        ▼
  ┌─── MANTRA INJECT (đầu phiên) ─────────────────────────┐
  │  ## Debug Mantra (read aloud):                          │
  │  1. REPRODUCE: create pass/fail signal, 1-5s, lặp lại   │
  │  2. TRACE FAIL PATH: đi theo đường FAIL (không happy)   │
  │  3. FALSIFY: chứng minh hypothesis SAI (không confirm)  │
  │  4. CROSS-REFERENCE: đọc breadcrumbs, KHÔNG assume      │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── STEP 1: REPRODUCE (fast, lặp lại) ─────────────────┐
  │  run test → FAIL (1-5s, xác nhận)                      │
  │  nếu chậm → isolate (unit test, mock, skip slow build)  │
  └───────────┬───────────────────────────────────────────┘
              ▼
  ┌─── STEP 2: TRACE FAIL PATH ───────────────────────────┐
  │  read stack trace → đi theo đường code FAIL             │
  │  (không trace happy path — fail path mới có bug)        │
  └───────────┬───────────────────────────────────────────┘
              ▼
  ┌─── STEP 3: FALSIFY HYPOTHESIS ────────────────────────┐
  │  hypothesis: "bug ở parseToken()"                       │
  │  FALSIFY: "nếu bỏ parseToken, bug còn không?"           │
  │  → còn → hypothesis SAI → tìm lại                       │
  └───────────┬───────────────────────────────────────────┘
              ▼
  ┌─── STEP 4: CROSS-REFERENCE BREADCRUMBS ───────────────┐
  │  stack trace + git diff + test output + log            │
  │  → KHÔNG assume, đọc tất cả nguồn                       │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills SkillStore — skill loading + progressive disclosure (nền — TK là nội dung skill)
// ✅ packages/prompts stable tier — system prompt (nền — TK inject mantra block)
// ✅ packages/tools bash — run test / build (nền — TK reproduce)
// ✅ packages/agent loop — agent loop (nền — TK enforcement trong loop)

// ❌ THIẾU: debug-mantra SKILL.md (nội dung mantra — chỉ là text)
// ❌ THIẾU: trigger phrase routing ("fix bug" / "test fail" → inject mantra)
// ❌ THIẾU: fast-reproduce guidance (isolate, mock, skip slow build)
```

## Implementation

```typescript
// .mya/skills/debug-mantra/SKILL.md (NỘI DUNG — không cần code)
// --- frontmatter ---
// name: debug-mantra
// description: 4-step debug discipline — reproduce, trace, falsify, cross-ref
// triggers: ["fix bug", "test fail", "debug", "not working", "broken"]
// allowedTools: ["bash", "read", "edit", "grep"]
// --- body ---
// ## Debug Mantra — read before debugging:
// 1. REPRODUCE: create pass/fail signal. Must repeat in 1-5s.
//    If slow → isolate (unit test, mock, skip build).
// 2. TRACE FAIL PATH: follow the FAILING code path (not happy path).
// 3. FALSIFY: try to PROVE your hypothesis WRONG.
//    If you can't falsify it → it's closer to truth.
// 4. CROSS-REFERENCE: read ALL breadcrumbs (stack trace, git diff, log).
//    NEVER assume — verify from multiple sources.

// packages/agent/src/debug-mantra-trigger.ts (optional — auto-inject)
const DEBUG_TRIGGERS = ["fix bug", "test fail", "debug", "not working", "broken"];

function shouldInjectMantra(userMessage: string): boolean {
  return DEBUG_TRIGGERS.some(t => userMessage.toLowerCase().includes(t));
}

// Usage trong agent loop:
// if (shouldInjectMantra(userMessage)) {
//   const mantraBody = skillStore.loadBody("debug-mantra");
//   inject as system prompt block for this turn;
// }
```

## Được

- ✅ Kỷ luật debug (4 bước, không đoán mò)
- ✅ Fast reproduce (tín hiệu 1-5s → iterate nhanh)
- ✅ Falsify-first (gần nguyên nhân thật hơn confirm-bias)
- ✅ Cross-reference (không assume — đọc đa nguồn)

## Mất

- ❌ Mantra noise (inject mỗi debug session → context tốn)
- ❌ Agent không tuân thủ (mantra là text — model có thể skip)
- ❌ Overhead nhỏ (đọc mantra đầu phiên)
- ❌ Không enforceable hard (không phải code gate — prompt nudge)

## Khác

Khác **TD failure-derived-instruction-learning** (fail → lesson bền vững) — TK là **kỷ luật per-session** (mantra mỗi phiên debug). Khác **tool-based debugging** (DAP debugger, breakpoint) — TK là **methodology prompt** (cách tiếp cận). Khác **117 toolchain-feedback** (exec feedback) — TK là **meta-discipline** (cách debug, không phải tool debug).

## Khi nào chọn

- Agent hay đoán mò khi debug (skip reproduce, fix theo hypothesis không verify)
- Debug session dài, iterate chậm (reproduce chậm → mantra nhấn fast-reproduce)
- Muốn confirm-bias reduction (falsify-first thay vì confirm)
- Nối packages/skills SkillStore + packages/prompts stable tier + packages/tools bash (reproduce); guard mantra brevity (ngắn gọn — 4 dòng, không dài lê thê), trigger precision (chỉ inject khi thật sự debug — không false positive), và enforcement (mantra là nudge, kết hợp TN run-summary-observability track có theo mantra không); TK = debug mantra discipline, kết hợp TD failure-derived-instruction-learning (mantra → lesson) + 117 toolchain-feedback (reproduce feedback)
