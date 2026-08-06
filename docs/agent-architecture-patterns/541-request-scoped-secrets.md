# Hướng TU: Request-Scoped Secrets — skill khai báo required-secrets; caller gửi qua context.secrets, bind vào env bash subprocess — không lọt prompt/trace/checkpoint

> **Nguồn gốc:** deer-flow `src/skills/secret_binding.py` (`required-secrets` frontmatter), `context.secrets`; "skill declares required-secrets; caller provides via context.secrets"; "bind to env of bash subprocess only — never prompt/trace/checkpoint"; "request-scoped secret injection" | **Coupling:** 🟡 — thêm secret-declaration in skill + request-scoped binding vào tool executor | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (SecretStore + redact sẵn — chưa có skill required-secrets + request-scoped env binding) | **Effort:** 2-3 tuần

## Nguồn gốc

**deer-flow** skill khai báo `required-secrets` trong frontmatter (ví dụ `required-secrets: [GITHUB_TOKEN, npm_token]`). Khi skill chạy: (1) **Caller provides**: caller gửi secret qua `context.secrets` (không hardcode trong skill, không trong prompt). (2) **Bind to env**: secret **chỉ bind vào env của bash subprocess** (tool `bash` thấy `GITHUB_TOKEN` trong env) — **không lọt** vào model prompt, trace log, hay checkpoint. (3) **Request-scoped**: secret sống trong **scope request đó** (không leak ra session, không persist). Nguyên tắc: **secret never in prompt** — model không thấy secret value, chỉ bash subprocess thấy qua env; checkpoint/trace redact.

## Mô tả

mya request-scoped secrets: (1) **Skill declares**: SKILL.md frontmatter `required-secrets: [TOKEN_X, TOKEN_Y]`. (2) **Caller provides**: caller (agent/user) gửi `context.secrets = { TOKEN_X: "...", TOKEN_Y: "..." }`. (3) **Bind env**: khi skill chạy tool `bash` → secret inject vào **process.env** của subprocess đó **only** (không global env). (4) **Never in prompt**: secret không xuất hiện trong model prompt (model chỉ thấy skill cần secret, không thấy value). (5) **Redact trace**: trace log / checkpoint redact secret (thay bằng `***`). mya có SecretStore + redact — TU thêm **skill required-secrets declaration** + **request-scoped env binding**.

## Kiến trúc

```
  SKILL.md frontmatter:
  ┌─── required-secrets: [GITHUB_TOKEN, npm_token] ───────┐
  │  skill khai báo CẦN secret (không hardcode value)      │
  └───────────┬───────────────────────────────────────────┘
              │
              ▼
  ┌─── CALLER provides context.secrets ───────────────────┐
  │  context.secrets = {                                    │
  │    GITHUB_TOKEN: "ghp_xxx...",  (value — caller gửi)   │
  │    npm_token: "npm_yyy..."                             │
  │  }                                                      │
  │  → secret ở context, KHÔNG trong prompt                 │
  └───────────┬───────────────────────────────────────────┘
              │
              ▼
  ┌─── BIND to bash subprocess env ONLY ──────────────────┐
  │  bash subprocess:                                       │
  │    env = { ...process.env, GITHUB_TOKEN, npm_token }    │
  │    → `git push` thấy GITHUB_TOKEN (authenticate OK)     │
  │  MODEL PROMPT: ❌ KHÔNG có secret value                 │
  │  TRACE LOG: GITHUB_TOKEN=*** (redacted)                 │
  │  CHECKPOINT: GITHUB_TOKEN=*** (redacted)                │
  └───────────┬───────────────────────────────────────────┘
              │ (request kết thúc)
              ▼
  ┌─── REQUEST-SCOPED (cleanup) ──────────────────────────┐
  │  secret ra khỏi scope — không persist, không leak       │
  │  → next request: caller provides lại context.secrets    │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/secrets SecretStore — secret store (nền — TU caller reads from here)
// ✅ packages/secrets redact — secret redaction (nền — TU redact trace/checkpoint)
// ✅ packages/skills SkillFrontmatter — frontmatter (nền — TU thêm required-secrets field)
// ✅ packages/tools bash — bash tool (nền — TU bind env vào subprocess)

// ❌ THIẾU: required-secrets frontmatter field (skill khai báo cần secret gì)
// ❌ THIẾU: request-scoped env binding (inject secret vào subprocess env only)
// ❌ THIẾU: prompt-exclusion guarantee (secret không bao giờ trong prompt)
// ❌ THIẾU: trace/checkpoint redaction enforcement (redact secret trong trace)
```

## Implementation

```typescript
// packages/secrets/src/request-scoped.ts (MỚI)
import { spawn } from "node:child_process";

interface SkillSecretBinding {
  requiredSecrets: string[];      // skill frontmatter declaration
  providedSecrets: Record<string, string>;  // caller context.secrets
}

class RequestScopedSecrets {
  // validate: caller provided all required secrets?
  validate(binding: SkillSecretBinding): { ok: boolean; missing: string[] } {
    const missing = binding.requiredSecrets.filter(s => !(s in binding.providedSecrets));
    return { ok: missing.length === 0, missing };
  }

  // bind secrets to bash subprocess env ONLY (not global, not prompt)
  runBashWithSecrets(command: string, binding: SkillSecretBinding): Promise<string> {
    const { ok, missing } = this.validate(binding);
    if (!ok) throw new Error(`missing required secrets: ${missing.join(", ")}`);

    // subprocess env: base env + secrets (scoped to THIS subprocess only)
    const env = { ...process.env, ...binding.providedSecrets };

    return new Promise((resolve, reject) => {
      const proc = spawn(command, { env, shell: true });
      let stdout = "";
      proc.stdout.on("data", d => stdout += d);
      proc.on("close", code => code === 0 ? resolve(stdout) : reject(new Error(`exit ${code}`)));
    });
  }

  // redact secrets from trace/checkpoint (enforce — never leak)
  redactTrace(trace: string, secretNames: string[]): string {
    let redacted = trace;
    for (const name of secretNames) {
      // redact any occurrence of secret value
      redacted = redacted.replace(new RegExp(this.providedSecrets?.[name] ?? "__never__", "g"), "***");
    }
    return redacted;
  }
}

// Usage:
// const binding = { requiredSecrets: skill.frontmatter.requiredSecrets, providedSecrets: context.secrets };
// const result = await secrets.runBashWithSecrets("git push", binding);
// → subprocess sees GITHUB_TOKEN in env, model prompt does NOT
```

## Được

- ✅ Secret never in prompt (model không thấy value — không leak qua generation)
- ✅ Request-scoped (secret sống trong request — không persist/leak)
- ✅ Subprocess env binding (bash authenticate OK — secret qua env, đúng cách)
- ✅ Trace/checkpoint redact (log/checkpoint không chứa secret)

## Mất

- ❌ Caller burden (caller phải provide context.secrets mỗi request)
- ❌ Missing-secret UX (thiếu secret → skill fail — cần rõ error)
- ❌ Env-binding complexity (inject vào subprocess env cần care — không leak global)
- ❌ Redaction false-negative (redact miss pattern → secret lọt trace)

## Khác

Khác **secrets redact** (redact secret trong output) — TU là **request-scoped binding** (inject vào subprocess env, không global). Khác **TP skill-policy-boundary** (policy gate trước skill run) — TU là **secret provisioning** (cấp secret cho skill subprocess). Khác **SecretStore** (store secret) — TU là **transport secret to subprocess** (request-scoped, không persist).

## Khi nào chọn

- Skill cần secret (API token, credentials) cho bash subprocess (deploy, publish, git push)
- Bảo mật cao (secret không bao giờ trong prompt — model không generate leak)
- Muốn request-scoped (secret không persist trong session — fresh mỗi request)
- Nối packages/secrets SecretStore + redact + packages/skills SkillFrontmatter + packages/tools bash; guard prompt-exclusion (verify secret không trong prompt — test), redaction completeness (redact hết pattern — test trace), và missing-secret error (rõ message — skill nào cần secret nào); TU = request-scoped secrets, kết hợp TP skill-policy-boundary (policy gate) + TN run-summary-observability (track secret usage redacted)
