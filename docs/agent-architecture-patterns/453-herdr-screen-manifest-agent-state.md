# Hướng QK: Screen Manifest Agent State — TOML-manifest + regex scan terminal phát hiện agent state

> **Nguồn gốc:** herdr (screen manifest agent state); "TOML manifest for terminal patterns"; "regex-based terminal state scraping"; "agent state detection via output patterns"; "declarative screen state machine"
> **Coupling:** 🟡 — cần terminal scraper + TOML manifest engine + state matcher
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (terminal/PTY + regex sẵn — chưa có TOML manifest + state detection engine)
> **Effort:** 2-3 tuần

## Nguồn gốc

**herdr** phát hiện **agent state** bằng cách **regex scan terminal output**. **TOML manifest** khai báo declarative: mỗi **state** (idle, working, waiting-input, error) có **regex pattern** → scanner quét terminal → match pattern → state detected. Giống **terminal multiplexer status** (tmux status line) nhưng **declarative** (TOML config, không hardcode). Lợi thế: **external observation** — không cần agent API, chỉ cần terminal output → works với bất kỳ CLI agent. Nguyên tắc: **agent state = observable pattern** — manifest maps pattern → state. Khác **401 observability** (internal harness) — QK là **external scraping**; khác **453** (itself) — khác **454 QL stream-abort** (inject) — QK là **detect**.

## Mô tả

mya screen manifest agent state: **TOML manifest** (`screen.toml`) khai báo state + regex. **Terminal scanner** đọc output (PTY capture), match regex → detect state. States: `idle` (prompt ready), `working` (spinner/progress), `waiting-input` (prompt for confirm), `error` (error message). External observer (herdr/orchestrator) biết agent state → react (waiting-input → send approval, error → notify). Nối terminal/PTY + 401 observability + 445 approval-pipeline.

## Kiến trúc

```
  TERMINAL OUTPUT (agent CLI):
  ┌──────────────────────────────────────────────────────┐
  │  mya> fixing auth.ts...                               │
  │  ⠋ Working... (step 2/5)                              │
  │  ✅ Fixed. Run tests? [y/n]                           │
  └──────────────────────────────────────────────────────┘

  TOML MANIFEST (screen.toml):
  ┌──────────────────────────────────────────────────────┐
  │  [state.idle]                                         │
  │  pattern = '^mya>\s*$'                                │
  │                                                        │
  │  [state.working]                                       │
  │  pattern = '[⠋⠙⠹⠸] Working'                          │
  │                                                        │
  │  [state.waiting-input]                                │
  │  pattern = '\[y/n\]\s*$'                              │
  │                                                        │
  │  [state.error]                                         │
  │  pattern = '(ERROR|Error|FAILED)'                     │
  └──────────────────────────┬───────────────────────────┘
                             │
                             ▼
  ┌─── TERMINAL SCANNER ──────────────────────────────────┐
  │                                                        │
  │  Read terminal output (PTY capture)                    │
  │  → Match each state's regex against latest lines       │
  │  → State detected: waiting-input ("[y/n]")             │
  │                                                        │
  │  → External observer reacts:                           │
  │    waiting-input → send approval ("y")                 │
  │    error         → notify orchestrator                 │
  │    working       → wait                                │
  │                                                        │
  └────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ terminal/PTY — terminal capture (nền — QK = regex scan trên output)
// ✅ regex — pattern matching (nền — QK = TOML-declared patterns)
// ✅ 401 observability-driven-harness — state observation (relate — QK = external)
// ✅ 445 approval-pipeline — approval gate (relate — QK = detect waiting-input)

// ❌ THIẾU: TOML manifest parser (declarative state + regex config)
// ❌ THIẾU: terminal scanner (read output → match regex → detect state)
// ❌ THIẾU: state machine (idle → working → waiting-input → idle)
// ❌ THIẾU: external observer reaction (state → action: approve/notify/wait)
```

## Implementation

```typescript
// packages/agent/src/screen-manifest.ts (NEW)
import { readFileSync } from 'node:fs';

interface StatePattern {
  name: string;
  pattern: string;      // regex string
  compiled?: RegExp;
}

interface ScreenManifest {
  states: StatePattern[];
}

class ScreenManifestScanner {
  private manifest: ScreenManifest;
  private currentState: string | null = null;

  constructor(manifestPath: string) {
    this.manifest = this.parseToml(readFileSync(manifestPath, 'utf-8'));
    // Pre-compile regexes
    this.manifest.states.forEach((s) => { s.compiled = new RegExp(s.pattern); });
  }

  // Scan terminal output → detect current state
  scan(terminalOutput: string): string | null {
    // Check last N lines against each state pattern
    const lines = terminalOutput.split('\n').slice(-10); // last 10 lines
    const recent = lines.join('\n');
    for (const state of this.manifest.states) {
      if (state.compiled?.test(recent)) {
        if (this.currentState !== state.name) {
          this.currentState = state.name;
          this.onStateChange(state.name);
        }
        return state.name;
      }
    }
    return this.currentState;
  }

  // React to state change (external observer)
  private onStateChange(newState: string): void {
    switch (newState) {
      case 'waiting-input':
        // Trigger approval flow (445 QC approval-pipeline)
        break;
      case 'error':
        // Notify orchestrator
        break;
      case 'idle':
        // Agent ready for next task
        break;
    }
  }

  private parseToml(content: string): ScreenManifest {
    // Minimal TOML parser for [state.NAME] sections
    const states: StatePattern[] = [];
    const lines = content.split('\n');
    let currentName = '';
    for (const line of lines) {
      const stateMatch = line.match(/^\[state\.(\w+)\]/);
      if (stateMatch) { currentName = stateMatch[1]!; continue; }
      const patternMatch = line.match(/^pattern\s*=\s*"(.*)"/);
      if (patternMatch && currentName) {
        states.push({ name: currentName, pattern: patternMatch[1]! });
      }
    }
    return { states };
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ External observation (không cần agent API, chỉ cần terminal) | ❌ Fragile (regex break khi output format đổi) |
| ✅ Declarative (TOML config, không hardcode) | ❌ Regex maintenance (output thay đổi → cập nhật manifest) |
| ✅ Works với bất kỳ CLI agent (generic) | ❌ False positive (regex match nhầm → wrong state) |
| ✅ No instrumentation (agent không cần modify) | ❌ Latency (scan periodic, không real-time) |

## Khác các hướng gần

| | 401 Observability | 445 Approval-Pipeline | 454 Stream-Abort | QK: Screen-Manifest |
|---|---|---|---|---|
| Trọng tâm | Internal harness | Pipeline gate | Mid-stream inject | **External scraping** |
| Cơ chế | Instrumentation | Checkpoint | Cookie regex | **TOML manifest + regex** |
| Cần API? | ✅ (internal) | ✅ (internal) | ✅ (stream) | **❌ (terminal only)** |

## Khi nào chọn

- Cần observe agent state externally (không có API/instrumentation)
- Agent là CLI (terminal output =唯一 observable)
- Muốn declarative config (TOML manifest, không hardcode regex)
- Nối terminal/PTY + 401 observability-driven-harness + 445 approval-pipeline
