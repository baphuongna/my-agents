# Hướng TP: Skill Policy Boundary — skill chỉ sở hữu workflow; red-line ở system prompt/harness ngoài skill

> **Nguồn gốc:** ClaudeSkills `docs/policy-boundary.md`, `harness/policy-gate.ts`; "skills own workflow only — never policy"; "PII, compliance, permission are red-lines"; "red-lines live in system prompt + harness, NOT in skill body"; "skill cannot override policy" | **Coupling:** 🟢 — policy gate ở harness layer, skill layer không có policy | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (threat-scan + redact sẵn — chưa có explicit skill-policy boundary + harness gate) | **Effort:** 1-2 tuần

## Nguồn gốc

**ClaudeSkills** tách biệt rõ **workflow** (skill sở hữu — "làm gì, theo thứ tự nào") vs **policy** (red-line — PII, compliance, permission). Skill **không** được chứa policy — mọi red-line sống ở **system prompt** (hard rule, model thấy) + **harness** (enforcement gate, code-level). Lý do: skill **có thể bị override** (user edit, hub install, agent create) — nếu policy nằm trong skill → policy bị override theo → **security hole**. Policy ở system prompt + harness → **không phụ thuộc skill** → skill nào cũng chịu cùng policy. Nguyên tắc: **skill = what to do, policy = what NOT to do** — tách biệt hoàn toàn.

## Mô tả

mya skill policy boundary: (1) **Skill = workflow**: SKILL.md chỉ chứa workflow (steps, tools, triggers) — không policy. (2) **Policy = system prompt + harness**: red-line (PII redaction, compliance check, permission gate) ở system prompt (model thấy) + harness gate (code-level enforce). (3) **Gate enforcement**: trước khi skill chạy → harness check policy (PII scan? permission? compliance?) → pass thì chạy, fail thì block. (4) **Skill can't override**: skill body không có cơ chế skip policy — policy gate ở layer ngoài. mya có threat-scan + redact — TP thêm **explicit boundary** (skill ≠ policy) + **harness policy gate**.

## Kiến trúc

```
  ┌─── SYSTEM PROMPT (policy — model thấy) ──────────────┐
  │  RED-LINES (hard rules):                                 │
  │  - Never output PII (names, emails, SSN)                 │
  │  - Never bypass permission checks                        │
  │  - Comply with data residency (EU only)                   │
  │  (áp dụng cho TẤT CẢ skill — không phụ thuộc skill body) │
  └───────────────────────────────────────────────────────┘
  ┌─── HARNESS POLICY GATE (code-level, trước skill run) ─┐
  │  skill "deploy-prod" sắp chạy                           │
  │  → gate check: PII scan? ✅ permission? ✅ compliance? ✅│
  │  → PASS → cho chạy                                       │
  │  → FAIL → block + log (không phụ thuộc skill nói gì)   │
  └───────────┬───────────────────────────────────────────┘
              │ (gate pass)
              ▼
  ┌─── SKILL BODY (workflow only — KHÔNG policy) ─────────┐
  │  SKILL.md:                                               │
  │  - steps: build → test → deploy                          │
  │  - tools: bash, read, write                              │
  │  - triggers: "deploy to prod"                            │
  │  (KHÔNG có: "skip PII check" / "bypass permission")     │
  │  → skill không thể override policy (gate ở ngoài)       │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core threat-scan — threat scanning (nền — TP PII/compliance gate)
// ✅ packages/secrets redact — secret redaction (nền — TP PII redaction)
// ✅ packages/skills SkillStore — skill loading (nền — TP skill = workflow only)
// ✅ packages/prompts stable tier — system prompt (nền — TP red-lines in prompt)

// ❌ THIẾU: explicit policy boundary (skill ≠ policy — convention + lint)
// ❌ THIẾU: harness policy gate (check PII/permission/compliance trước skill run)
// ❌ THIẾU: skill-body policy lint (reject SKILL.md chứa policy override)
```

## Implementation

```typescript
// packages/skills/src/policy-gate.ts (MỚI)
import { scan as scanContent } from "@my-agent/prompts";

interface PolicyCheck { name: string; passed: boolean; reason?: string }

class SkillPolicyGate {
  // check policy BEFORE skill runs (harness-level, không phụ thuộc skill body)
  async check(skillName: string, input: string): Promise<{ allowed: boolean; checks: PolicyCheck[] }> {
    const checks: PolicyCheck[] = [];

    // PII scan (redact secrets + PII)
    const piiFound = scanContent(input); // threat-scan
    checks.push({ name: "pii-scan", passed: !piiFound, reason: piiFound ? "PII detected" : undefined });

    // permission check (skill allowed for this user?)
    checks.push({ name: "permission", passed: true }); // placeholder — real perm check

    // compliance check (data residency, export control)
    checks.push({ name: "compliance", passed: true }); // placeholder — real compliance

    const allowed = checks.every(c => c.passed);
    return { allowed, checks };
  }
}

// lint: reject SKILL.md that tries to embed policy overrides
const POLICY_OVERRIDE_PATTERNS = [/skip.{0,10}pii/i, /bypass.{0,10}permission/i, /ignore.{0,10}compliance/i];

function lintSkillBody(body: string): string[] {
  return POLICY_OVERRIDE_PATTERNS
    .filter(p => p.test(body))
    .map(p => `policy override detected: ${p.source} — policy belongs in harness, not skill`);
}

// Usage:
// const gate = new SkillPolicyGate();
// const { allowed } = await gate.check("deploy-prod", userInput);
// if (!allowed) block + log;  // gate ở ngoài skill — skill không thể skip
```

## Được

- ✅ Policy tamper-proof (skill override không ảnh hưởng policy — gate ở ngoài)
- ✅ Consistent (tất cả skill chịu cùng policy)
- ✅ Separation of concerns (skill = workflow, harness = policy)
- ✅ Audit (policy check logged — không phụ thuộc skill)

## Mất

- ❌ Gate overhead (check policy mỗi skill run — latency)
- ❌ False positive (PII scan sai → block hợp lệ)
- ❌ Convention enforcement (dev viết policy vào skill body → cần lint catch)
- ❌ Policy duplication (system prompt + harness — 2 nơi, cần sync)

## Khác

Khác **threat-scan** (scan content cho threat) — TP là **boundary convention** (skill ≠ policy) + **harness gate** (enforce). Khác **secrets redact** (redact secret trong output) — TP là **policy boundary** (PII/compliance/permission). Khác **TU request-scoped-secrets** (bind secret vào env) — TP là **policy gate** (check trước skill run).

## Khi nào chọn

- Skill từ nhiều nguồn (hub, user, agent-created) — policy cần tamper-proof
- Có red-line rõ (PII, compliance, permission) — cần enforce consistent
- Muốn separation (skill = workflow, harness = policy)
- Nối packages/core threat-scan + packages/secrets redact + packages/prompts stable tier + packages/skills SkillStore; guard gate completeness (check hết red-line), lint enforcement (reject skill body chứa override), và false-positive mitigation (PII scan chính xác); TP = skill policy boundary, kết hợp TU request-scoped-secrets (secret binding) + TN run-summary-observability (track policy check per run)
