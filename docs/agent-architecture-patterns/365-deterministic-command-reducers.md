# Hướng NA: Deterministic Command Reducers — reducer per-lệnh (git/npm/docker) giảm ~90% token

> **Nguồn gốc:** "Output reduction"; per-command reducer; "deterministic summarization"; command output parsing; git/npm/docker log compression; rtk (reducer toolkit); hypa (hyper-aggressive parser); "structured extraction from CLI"
> **Coupling:** 🟢 — thêm command reducer registry vào tool output pipeline
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (218 tool-output-compression sẵn — chưa có per-command deterministic reducer)
> **Effort:** 1.5-2 tuần

## Nguồn gốc

**CLI output dài**: `npm install` in 200 dòng, `git log` in 500 commit, `docker build` in 1000 bước. **Đa phần là noise** đối với agent — agent chỉ cần **kết quả chính** (success/fail, key fact, error). **Deterministic reducer**: mỗi lệnh có **reducer chuyên dụng** parse output theo cấu trúc đã biết → giữ **vài dòng thiết yếu**. VD `git log` reducer → "30 commit, latest: abc1234 'fix login'"; `npm install` reducer → "✅ 142 packages, 3 vulnerabilities"; `docker build` reducer → "✅ built image, 8 layers, 2.3GB". **Deterministic** (không LLM) → nhanh, rẻ, tái lặp. Giảm ~90% token. Khác **218 HJ tool-output-compression** (generic entropy compressor) — NA **per-command structured parser**; khác **359 MU content-type-aware** (type-level) — NA **command-level** (git/npm/docker cụ thể).

## Mô tả

mya deterministic command reducers: registry reducer theo lệnh — `git`, `npm`, `docker`, `cargo`, `kubectl`, ... Khi tool shell chạy xong, **reducer tương ứng** parse stdout/stderr → rút **tóm tắt có cấu trúc** (status + key facts + error nếu có). Nếu không có reducer → fallback generic (218 HJ). Kết quả: output dài 1000 dòng → 3 dòng, agent vẫn có thông tin quyết định.

## Kiến trúc

```
  TOOL: shell("npm install")
       │
       ▼  raw stdout (200 dòng)
  ┌─── REDUCER ROUTER ───────────────────────────┐
  │  detect command: "npm" → npmReducer           │
  │              "git"  → gitReducer              │
  │              "docker" → dockerReducer         │
  │              unknown → fallback (218 HJ)      │
  └──┬────────────────────────────────────────────┘
     ▼
  ┌─── gitReducer("git log --oneline") ──────────┐
  │  parse 500 dòng:                              │
  │   → "30 commits since main"                   │
  │   → latest: abc1234 'fix login'               │
  │   → top author: alice (12)                    │
  └──┬────────────────────────────────────────────┘
     ▼
  CONTEXT chỉ nhận: "30 commits... latest: abc1234 'fix login'"  (3 dòng, ~90% giảm)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 218 HJ tool-output-compression — generic nén (nền — NA per-command)
// ✅ 359 MU content-type-aware — type-level (nền — NA command-level)
// ✅ 318 LF token-trace-visual — token tracking (feedback)
// ✅ 320 LH cost-per-step — cost (feedback)

// ❌ THIẾU: command reducer registry (git/npm/docker/...)
// ❌ THIẾU: command detector (parse argv → reducer key)
// ❌ THIẾU: per-command reducer impl (structured parse rules)
```

## Implementation

```typescript
// packages/agent/src/command-reducer.ts (NEW)
interface Reducer { match(cmd: string): boolean; reduce(stdout: string, stderr: string): string; }

class CommandReducerRegistry {
  constructor(private reducers: Reducer[], private fallback: (s: string) => string) {}

  reduce(cmd: string, stdout: string, stderr: string): string {
    const r = this.reducers.find(x => x.match(cmd));
    if (!r) return this.fallback(stdout || stderr); // 218 HJ generic
    const reduced = r.reduce(stdout, stderr);
    // Nếu có error trong stderr → giữ nguyên (không nén mất error)
    return stderr && /error|fatal/i.test(stderr) ? `${reduced}\n[stderr] ${stderr.slice(-500)}` : reduced;
  }
}

// — Reducer per-lệnh (deterministic, không LLM) —

const gitReducer: Reducer = {
  match: (c) => /^git\b/.test(c),
  reduce(stdout) {
    const lines = stdout.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return '(no git output)';
    const latest = lines[0]?.slice(0, 80) ?? '';
    return `${lines.length} lines | latest: ${latest}`;
  },
};

const npmReducer: Reducer = {
  match: (c) => /^npm\b/.test(c),
  reduce(stdout, stderr) {
    const added = (stdout.match(/added \d+ package/gi) || [''])[0];
    const vuln = (stdout.match(/\d+ vulnerabilit/gi) || [''])[0];
    const ok = /up to date|added/i.test(stdout) && !/npm err/i.test(stderr);
    return `${ok ? '✅' : '❌'} ${added || 'up to date'}${vuln ? ` | ${vuln}` : ''}`;
  },
};

const dockerReducer: Reducer = {
  match: (c) => /^docker\b/.test(c),
  reduce(stdout) {
    const steps = (stdout.match(/^Step \d+/gm) || []).length;
    const ok = /successfully (built|tagged)/i.test(stdout);
    return `${ok ? '✅' : '❌'} ${steps} steps | ${ok ? 'built' : 'incomplete'}`;
  },
};

// Usage:
// registry = new CommandReducerRegistry([gitReducer, npmReducer, dockerReducer], genericCompress);
// const summary = registry.reduce('npm install', rawStdout, rawStderr);
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Giảm ~90% token (deterministic, không LLM) | ❌ Phải viết reducer mỗi lệnh mới |
| ✅ Nhanh + rẻ (regex parse) | ❌ Reducer sai format → mất thông tin |
| ✅ Tái lặp (cùng output → cùng summary) | ❌ Output format đổi (version CLI) → reducer hỏng |
| ✅ Giữ error (stderr priority) | ❌ Edge case output (progress bar) parse khó |

## Khác các hướng gần

| | 218 Tool-Output Compress | 359 Content-Type-Aware | 363 Programmatic Mining | NA: Command Reducers |
|---|---|---|---|---|
| Cái gì | Generic entropy nén | Router theo type | Script compute | **Reducer per-lệnh** |
| Deterministic | ❌ (entropy) | ❌ (summarize) | ✅ | ✅ (regex parse) |
| Per-command | ❌ | ❌ | ❌ | ✅ (git/npm/docker) |
| ~90% giảm | ❌ | ❌ | ❌ | ✅ |

## Khi nào chọn

- Agent chạy nhiều CLI (git/npm/docker/cargo) với output dài
- Muốn giảm token output tool mạnh (~90%)
- Cần deterministic (tái lặp, không LLM cost)
- Kết hợp NA (per-command reducer) + 218 HJ (generic fallback) + 359 MU (type-level); guard reducer correctness (regression test theo CLI version) + stderr priority (giữ error)
