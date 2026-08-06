# Hướng QG: Command Class Gate — phân loại shell Read/Write/Network/Install/Destructive, Allow/Prompt/Block

> **Nguồn gốc:** OpenHuman (command class gate); "shell command classification"; "capability-based command gating"; "action taxonomy for shell"; "risk-tiered command authorization"
> **Coupling:** 🟢 — thêm command classifier + risk-tier gate trước bash dispatch
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (permission-prompt + dynamic-permissions sẵn — chưa có command classifier + 5-class taxonomy)
> **Effort:** 2-3 tuần

## Nguồn gốc

**OpenHuman** phân loại mỗi shell command thành **5 class**: (1) **Read** (`ls`, `cat`, `grep`, `find` — read-only, safe), (2) **Write** (`echo >`, `sed -i`, `mkdir` — filesystem write), (3) **Network** (`curl`, `wget`, `ssh` — external communication), (4) **Install** (`npm install`, `pip install`, `apt` — side-effect install), (5) **Destructive** (`rm -rf`, `git push --force`, `DROP TABLE` — irreversible). Mỗi class có **policy**: Allow (auto), Prompt (confirm), Block (deny). Lợi thế so với **per-command whitelist**: classify **bằng pattern**, không phải liệt kê từng command. Khác **124 dynamic-permissions** (per-tool auth) — QG là **per-command-class**; khác **402 OL request-type** (intent-level) — QG là **command-level**.

## Mô tả

mya command class gate: trước khi dispatch bash command → **classifier** parse command → classify thành 1/5 class. **Gate** check policy: Read → Allow (auto), Write → Allow/Prompt (tùy config), Network → Prompt, Install → Prompt, Destructive → Prompt/Block. Nếu Prompt → permission-prompt (124). Nếu Block → deny + explain. Classifier dùng **regex + heuristic** (không phải LLM — fast, deterministic). Nối 124 dynamic-permissions + 402 request-type-authorization + bash tool.

## Kiến trúc

```
  AGENT → bash("rm -rf node_modules && npm install")
        │
        ▼
  ┌─── COMMAND CLASSIFIER (regex + heuristic, fast) ────────┐
  │                                                           │
  │  "rm -rf node_modules"  → matches rm + -rf → DESTRUCTIVE │
  │  "npm install"          → matches npm install → INSTALL  │
  │                                                           │
  └───────────────────────┬───────────────────────────────────┘
                          │ (classes: [DESTRUCTIVE, INSTALL])
                          ▼
  ┌─── RISK-TIER GATE ──────────────────────────────────────┐
  │                                                           │
  │  ┌──────────────┬─────────┬───────────┬───────────────┐ │
  │  │ CLASS        │ POLICY  │ ACTION    │ EXAMPLE       │ │
  │  ├──────────────┼─────────┼───────────┼───────────────┤ │
  │  │ Read         │ ALLOW   │ auto-run  │ ls, cat, grep │ │
  │  │ Write        │ PROMPT  │ confirm   │ echo >, mkdir │ │
  │  │ Network      │ PROMPT  │ confirm   │ curl, wget    │ │
  │  │ Install      │ PROMPT  │ confirm   │ npm install   │ │
  │  │ Destructive  │ BLOCK   │ deny+explain│ rm -rf      │ │
  │  └──────────────┴─────────┴───────────┴───────────────┘ │
  │                                                           │
  │  → "rm -rf" = BLOCK (deny: irreversible, ask user)      │
  │  → "npm install" = PROMPT (confirm before install)       │
  └───────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 124 dynamic-permissions — per-tool auth (nền — QG = per-command-class)
// ✅ permission-prompt — confirm UI (nền — QG uses for Prompt class)
// ✅ 402 request-type-authorization — intent-level auth (relate — QG = command-level)
// ✅ bash tool — shell dispatch (nền — QG = gate before bash)

// ❌ THIẾU: command classifier (regex + heuristic → 5-class)
// ❌ THIẾU: risk-tier gate (class → policy: Allow/Prompt/Block)
// ❌ THIẾU: command class taxonomy (Read/Write/Network/Install/Destructive)
// ❌ THIẾU: compound command split (&& → classify each sub-command)
```

## Implementation

```typescript
// packages/agent/src/command-class-gate.ts (NEW)
type CommandClass = 'read' | 'write' | 'network' | 'install' | 'destructive';
type GatePolicy = 'allow' | 'prompt' | 'block';

// Regex patterns per class (deterministic, fast — not LLM)
const CLASS_PATTERNS: Record<CommandClass, RegExp[]> = {
  destructive: [/\brm\s+(-rf|--force)\b/, /\bgit\s+push\s+--force\b/, /\bDROP\s+TABLE\b/i, /\bmkfs\b/, /\bdd\b.*\bof=/],
  install:     [/\bnpm\s+(install|i|ci)\b/, /\bpip\s+install\b/, /\bapt(-get)?\s+install\b/, /\bbrew\s+install\b/, /\byarn\s+add\b/],
  network:     [/\bcurl\b/, /\bwget\b/, /\bssh\b/, /\bscp\b/, /\bnc\b/, /\bftp\b/],
  write:       [/>\s*\/.*$/, /\becho\s+.*>\s*\//, /\bsed\s+-i\b/, /\bmkdir\b/, /\btouch\b/, /\bcp\b/, /\bmv\b/],
  read:        [/\bls\b/, /\bcat\b/, /\bgrep\b/, /\bfind\b/, /\bhead\b/, /\btail\b/, /\bwc\b/, /\bfile\b/],
};

const DEFAULT_POLICY: Record<CommandClass, GatePolicy> = {
  read: 'allow', write: 'prompt', network: 'prompt', install: 'prompt', destructive: 'block',
};

class CommandClassGate {
  constructor(private policy: Record<CommandClass, GatePolicy> = DEFAULT_POLICY) {}

  classify(command: string): CommandClass[] {
    // Split compound commands (&&, ;, |) → classify each
    const subCommands = command.split(/&&|;|\|/).map((s) => s.trim()).filter(Boolean);
    return subCommands.map((sub) => this.classifySingle(sub));
  }

  gate(command: string): { allowed: boolean; policy: GatePolicy; classes: CommandClass[]; reason: string } {
    const classes = this.classify(command);
    // Worst class wins (if any sub-command is destructive → whole command destructive)
    const worst = this.worstClass(classes);
    const policy = this.policy[worst];
    return {
      allowed: policy === 'allow',
      policy,
      classes,
      reason: policy === 'block'
        ? `Command classified as ${worst.toUpperCase()} → blocked (irreversible). Ask user to run manually.`
        : policy === 'prompt'
          ? `Command classified as ${worst.toUpperCase()} → requires confirmation.`
          : 'Command classified as READ → auto-allowed.',
    };
  }

  private classifySingle(sub: string): CommandClass {
    // Check in order: destructive → install → network → write → read
    for (const cls of ['destructive', 'install', 'network', 'write', 'read'] as CommandClass[]) {
      if (CLASS_PATTERNS[cls].some((re) => re.test(sub))) return cls;
    }
    return 'write'; // unknown → treat as write (conservative)
  }

  private worstClass(classes: CommandClass[]): CommandClass {
    const order: CommandClass[] = ['read', 'write', 'network', 'install', 'destructive'];
    return classes.reduce((worst, cls) =>
      order.indexOf(cls) > order.indexOf(worst) ? cls : worst, 'read');
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Phân loại bằng pattern (fast, deterministic, không LLM) | ❌ False positive (classify sai nếu command phức tạp) |
| ✅ Risk-tiered (Read auto, Destructive block) | ❌ Evasion risk (obfuscated command bypass regex) |
| ✅ Không cần whitelist từng command (classify bằng class) | ❌ Compound command complexity (&& → split + worst-wins) |
| ✅ Clear UX (user biết class + policy) | ❌ Maintenance (regex cần cập nhật khi tool mới) |

## Khác các hướng gần

| | 124 Dynamic-Permissions | 402 Request-Type-Auth | permission-prompt | QG: Command-Class-Gate |
|---|---|---|---|---|
| Trọng tâm | Per-tool auth | Intent-level auth | Confirm UI | **Per-command-class** |
| Cấp | Tool | Intent | UI | **Command (5-class)** |
| Classify | ❌ (manual) | LLM intent | ❌ | **Regex + heuristic** |

## Khi nào chọn

- Agent chạy nhiều shell command (cần gate per-command, không chỉ per-tool)
- Cần risk-tiered (Read auto, Destructive block)
- Muốn classify bằng pattern (fast, không LLM)
- Nối 124 dynamic-permissions + 402 request-type-authorization + bash tool
