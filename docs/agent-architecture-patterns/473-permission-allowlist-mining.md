# Hướng RE: Permission Allowlist Mining — /allowlist từ transcripts tìm lệnh lặp tự sinh

> **Nguồn gốc:** Leaks Claude Code (`fewer-permission-prompts`); "scan your transcripts for common read-only Bash and MCP tool calls"; "auto-generate prioritized allowlist to .claude/settings.json"; "reduce permission prompts by mining recurring approved commands"; "permission allowlist from approval history"
> **Coupling:** 🟢 — thêm transcript-mining layer vào permission manager (mine → suggest allowlist)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (124 dynamic-permissions + trajectory sẵn — chưa có transcript mining + allowlist generator)
> **Effort:** 2-3 tuần

## Nguồn gốc

**Leaks Claude Code** (`fewer-permission-prompts`) mô tả: **scan transcripts** (lịch sử session) tìm **common read-only Bash + MCP tool calls** → **auto-generate prioritized allowlist** vào `.claude/settings.json` → **giảm permission prompts**. Ý tưởng: nếu agent đã được user **approve** `git status`, `ls`, `rg` nhiều lần → đó là **safe recurring command** → tự thêm vào allowlist (lần sau không cần prompt). **Prioritized**: command lặp nhiều + read-only = ưu tiên cao. Nguyên tắc: **allowlist từ hành vi thực** (transcript mining), không user config thủ công — agent tự học lệnh an toàn lặp lại. Khác **124 dynamic-permissions** (per-tool rule) — RE là **mining→suggest**; khác **402 request-type-auth** (intent) — RE là **command-frequency**.

## Mô tả

mya permission allowlist mining: (1) **Scan transcripts**: phân tích lịch sử tool-call (bash commands, MCP calls) đã được **approved**. (2) **Classify**: mỗi command → read-only (safe: `ls`, `git status`, `rg`) vs mutating (risky: `rm`, `git push`). (3) **Frequency**: đếm lặp — command lặp nhiều + read-only = candidate allowlist. (4) **Generate**: suggest allowlist rules (command pattern) → user confirm → ghi vào settings. (5) **Prioritize**: sort theo frequency × safety (read-only recurring lên đầu). mya có `124 dynamic-permissions` + trajectory — RE thêm **transcript scanner** + **command classifier** (read-only/mutating) + **allowlist generator** + **suggest-then-confirm**.

## Kiến trúc

```
  TRANSCRIPTS (lịch sử tool-call đã approved):
  ┌─────────────────────────────────────────────────────┐
  │  session 1: git status (✓approved), ls (✓), rg (✓)   │
  │  session 2: git status (✓), rm tmp (✓), ls (✓)       │
  │  session 3: git status (✓), ls (✓), rg parser (✓)    │
  └───────────────────────┬─────────────────────────────┘
                          │ (scan + classify + frequency)
                          ▼
  ┌─── COMMAND CLASSIFIER + FREQUENCY ───────────────────┐
  │  git status  → read-only, freq=3   ← SAFE recurring   │
  │  ls          → read-only, freq=3   ← SAFE recurring   │
  │  rg          → read-only, freq=2   ← SAFE             │
  │  rm tmp      → MUTATING,  freq=1   ← RISKY (skip)     │
  └───────────────────────┬─────────────────────────────┘
                          │ (prioritized candidates)
                          ▼
  ┌─── ALLOWLIST GENERATOR (suggest) ────────────────────┐
  │  suggest (prioritized, read-only only):              │
  │  1. "git status" (freq 3)        → allow              │
  │  2. "ls"          (freq 3)       → allow              │
  │  3. "rg *"        (freq 2)       → allow              │
  │  → user confirm → ghi .claude/settings.json           │
  └───────────────────────┬─────────────────────────────┘
                          │ (next session)
                          ▼
  ┌─── FEWER PROMPTS ────────────────────────────────────┐
  │  agent runs "git status" → ALLOWED (no prompt)        │
  │  (đã trong allowlist từ mining)                       │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 124 dynamic-permissions — per-tool auth (nền — RE = mining→suggest lên đây)
// ✅ trajectory / rollout — session history (nền — RE scan cái này)
// ✅ permission-prompt — confirm dialog (nền — RE reduce cái này)

// ❌ THIẾU: transcript scanner (parse approved tool-calls từ history)
// ❌ THIẾU: command classifier (read-only vs mutating safety)
// ❌ THIẾU: allowlist generator (freq × safety → prioritized rules)
// ❌ THIẾU: suggest-then-confirm UX (propose → user accept/reject)
```

## Implementation

```typescript
// packages/agent/src/allowlist-mining.ts (MỚI)
interface CommandRecord { command: string; approved: boolean; count: number }

const READ_ONLY = /^(git status|git log|git diff|ls|cat|rg|grep|find|head|tail|wc|test)\b/;
const MUTATING = /^(rm|mv|git push|git commit|git reset|chmod|curl|wget|npm install)\b/;

class AllowlistMiner {
  // scan transcripts → frequency map of approved commands
  scan(transcripts: Trajectory[]): Map<string, CommandRecord> {
    const freq = new Map<string, CommandRecord>();
    for (const t of transcripts) {
      for (const call of t.toolCalls) {
        if (call.tool !== 'bash' || !call.approved) continue;
        const cmd = normalizeCommand(call.input);  // "git status src/" → "git status"
        const r = freq.get(cmd) ?? { command: cmd, approved: true, count: 0 };
        r.count++;
        freq.set(cmd, r);
      }
    }
    return freq;
  }

  // generate prioritized allowlist (read-only recurring only)
  generate(freq: Map<string, CommandRecord>, minFreq = 2): { pattern: string; priority: number }[] {
    return [...freq.values()]
      .filter(r => r.count >= minFreq && READ_ONLY.test(r.command) && !MUTATING.test(r.command))
      .sort((a, b) => b.count - a.count)  // prioritize by frequency
      .map(r => ({ pattern: r.command, priority: r.count }));
  }

  // suggest → user confirm → persist
  async suggestAndApply(
    candidates: { pattern: string; priority: number }[],
    settings: { allowlist: string[] },
    confirm: (pattern: string) => Promise<boolean>,
  ): Promise<number> {
    let added = 0;
    for (const c of candidates) {
      if (settings.allowlist.includes(c.pattern)) continue;
      if (await confirm(`Allow "${c.pattern}" automatically? (seen ${c.priority}×, read-only)`)) {
        settings.allowlist.push(c.pattern);
        added++;
      }
    }
    return added;
  }
}

// Usage:
// const freq = miner.scan(allTranscripts);
// const candidates = miner.generate(freq);            // ["git status", "ls", "rg"]
// await miner.suggestAndApply(candidates, settings, prompt.confirm);
// → next "git status" runs without prompt
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Ít permission prompt (lệnh lặp tự allow) | ❌ Classifier sai (mutating lọt read-only → unsafe allow) |
| ✅ Học từ hành vi thực (transcript, không config thủ công) | ❌ Over-permissive (allow quá nhiều → blast radius) |
| ✅ Prioritized (read-only recurring lên đầu) | ❌ Cold-start (session đầu chưa có data) |
| ✅ User confirm (suggest, không tự áp mù) | ❌ Pattern quá rộng ("rg *" → cho phép mọi rg) |

## Khác các hướng gần

| | 124 Dynamic-Permissions | 402 Request-Type-Auth | RE: Allowlist-Mining |
|---|---|---|---|
| Cái gì | Per-tool rule | Per-intent auth | **Mine recurring → suggest allowlist** |
| Nguồn | User config | Intent classify | **Transcript history** |
| Auto | ❌ (manual rule) | ✅ (classify) | **✅ (mining → suggest)** |

## Khi nào chọn

- Agent chạy nhiều session (có transcript data)
- Lệnh lặp (git status, ls, rg — prompt nhiều lần phiền)
- Muốn giảm friction (auto-allow safe recurring)
- Nối 124 dynamic-permissions (allowlist target) + trajectory (mining source) + permission-prompt (reduce); guard classifier accuracy (read-only whitelist nghiêm ngặt, mutating deny), pattern precision (không quá rộng), và suggest-then-confirm (user duyệt, không tự áp); RE = transcript-driven allowlist, kết hợp 402 intent-auth cho intent-level control
