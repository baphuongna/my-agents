# Hướng PM: Warm-Fresh Dual Analysis Server — hai nhánh: warm LSP server + worker fresh đọc code mới

> **Nguồn gốc:** pi-lens (warm-attach.ts — incumbent LSP server attach, diagnostics IPC; lens-diagnostics.ts — warm/cold runner extraction); "warm server reuse"; "fresh worker for new code"; "LSP incumbent attach"; "warm diagnostics IPC"
> **Coupling:** 🟡 — thêm warm-server + fresh-worker dual branch vào analysis/diagnostics layer
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (pi-lens warm-attach + cold/warm runner sẵn — chưa có trong mya LSP integration)
> **Effort:** 2-2.5 tuần

## Nguồn gốc

**pi-lens** (`warm-attach.ts`, `lens-diagnostics.ts`) chạy analysis theo mô hình **warm-fresh dual** — hai nhánh song song: (1) **Warm branch**: attach vào **incumbent LSP server** (server đã chạy, đã index project — "warm"). `selectWarmAttachIncumbent()` tìm LSP server đang chạy cho cwd → attach → query diagnostics qua **IPC** (`requestWarmDiagnostics`, `requestWarmCodeActions`). Warm server có full project context (đã index) → diagnostics chính xác (biết cross-file references). (2) **Fresh branch**: **worker mới** đọc code mới (edit vừa rồi) → chạy analysis local (no LSP — hoặc cold runner). Fresh worker nhanh (không cần index toàn project) nhưng chỉ thấy file hiện tại (no cross-file). `lens-diagnostics.ts` extract `warm` (runners đã warm) vs `cold` (runners chưa warm) — báo "cold (not applicable): tsserver — would warm if you edit a .ts file". Nguyên tắc: **warm cho accuracy (full context), fresh cho speed (new code ngay)**. Khác **430 PN side-channel** (routing IPC) — PM là **dual analysis branch** (warm vs fresh).

## Mô tả

mya warm-fresh dual analysis server: khi agent edit code → **2 nhánh analysis song song** — (1) **Warm LSP server**: attach vào incumbent server (đã index project) → query diagnostics qua IPC → chính xác (cross-file, full context). (2) **Fresh worker**: đọc code mới (edit vừa rồi) → analysis local (regex/AST/pattern — no LSP) → nhanh (no index cost). Merge kết quả: warm cho **accuracy** (type errors, cross-file references), fresh cho **speed** (syntactic, pattern match). Nếu warm server không sẵn (cold — chưa index) → chỉ fresh (cold note: "would warm if you edit .ts"). Agent nhận diagnostics **nhanh** (fresh) + **chính xác** (warm) — không phải chờ warm server index xong. mya có LSP/diagnostics layer — PM thêm **warm-attach + fresh-worker dual branch**.

## Kiến trúc

```
  AGENT EDITS CODE (file.ts changed)
        │
        ├──► WARM BRANCH (incumbent LSP server) ──────────┐
        │   • selectWarmAttachIncumbent(cwd)               │
        │   • attach to running LSP server (already warm)   │
        │   • IPC: requestWarmDiagnostics(file.ts)          │
        │   • FULL CONTEXT: cross-file references,          │
        │     type inference, import resolution             │
        │   • SLOWER (IPC round-trip + server query)        │
        │   • ACCURATE (knows entire project)               │
        │                                    findings (warm) │
        ├──► FRESH BRANCH (new worker, local) ─────────────┤
        │   • read edited code (just now)                   │
        │   • local analysis: regex / AST / pattern match   │
        │   • NO LSP (no project index needed)              │
        │   • FAST (no IPC, no server query)                │
        │   • LOCAL (only sees current file)                │
        │                                   findings (fresh) │
        ▼                                                    ▼
  ┌─── MERGE ──────────────────────────────────────────────┐
  │  warm findings (accurate, cross-file)                   │
  │  + fresh findings (fast, local pattern)                 │
  │  dedup (same finding from both → 1)                     │
  │  → agent gets FAST + ACCURATE diagnostics               │
  │                                                         │
  │  COLD NOTE (if warm server unavailable):                │
  │  "cold: tsserver — would warm if you edit a .ts file"   │
  └─────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ LSP / diagnostics layer (packages/core or pi-lens integration) — nền
// ✅ 430 PN cold-warm-ipc-sidechannel — IPC routing (nền — PM = analysis dual branch)
// ✅ pi-lens warm-attach + cold/warm runner (source/ — reference impl)

// ❌ THIẾU: warm LSP server attach (incumbent server detection + attach)
// ❌ THIẾU: warm diagnostics IPC (requestWarmDiagnostics)
// ❌ THIẾU: fresh worker (local analysis, no LSP — regex/AST)
// ❌ THIẾU: cold/warm extraction (which runners are warm vs cold)
```

## Implementation

```typescript
// packages/agent/src/warm-fresh-analysis.ts (MỘI — port từ pi-lens warm-attach pattern)
interface Diagnostic {
  file: string;
  line: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  source: 'warm' | 'fresh';
}

interface WarmAttachState {
  cwd: string;
  incumbentPid?: number;
  local: boolean;
}

// Warm branch: attach to incumbent LSP server, query via IPC
async function warmDiagnostics(
  filePath: string,
  state: WarmAttachState,
): Promise<Diagnostic[]> {
  const incumbent = selectWarmAttachIncumbent(state.cwd);
  if (!incumbent) return []; // cold — no warm server available

  // IPC request to warm LSP server
  const result = await requestWarmDiagnostics({
    cwd: state.cwd,
    filePath,
    schemaVersion: 1,
  });

  return result.diagnostics.map((d) => ({
    file: filePath,
    line: d.line,
    message: d.message,
    severity: d.severity,
    source: 'warm' as const,
  }));
}

// Fresh branch: local analysis (no LSP — regex/AST/pattern)
async function freshDiagnostics(filePath: string, content: string): Promise<Diagnostic[]> {
  const findings: Diagnostic[] = [];
  // Syntactic checks (fast, local, no project context)
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    if (/console\.log\(/.test(line)) {
      findings.push({ file: filePath, line: i + 1, message: 'console.log left in code',
        severity: 'warning', source: 'fresh' });
    }
    if (/TODO|FIXME|HACK/.test(line)) {
      findings.push({ file: filePath, line: i + 1, message: 'Unresolved TODO/FIXME',
        severity: 'info', source: 'fresh' });
    }
  });
  return findings;
}

// Dual analysis: warm + fresh in parallel
async function analyzeDual(
  filePath: string,
  content: string,
  state: WarmAttachState,
): Promise<{ warm: Diagnostic[]; fresh: Diagnostic[]; coldRunners: string[] }> {
  const [warm, fresh] = await Promise.all([
    warmDiagnostics(filePath, state),
    freshDiagnostics(filePath, content),
  ]);

  const coldRunners: string[] = [];
  if (warm.length === 0 && !selectWarmAttachIncumbent(state.cwd)) {
    coldRunners.push('tsserver — would warm if you edit a .ts file');
  }

  return { warm, fresh, coldRunners };
}

// Usage:
// const { warm, fresh, coldRunners } = await analyzeDual(file, content, state);
// → warm: accurate cross-file diagnostics
// → fresh: fast local pattern checks
// → coldRunners: note if warm server unavailable
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Fast + accurate (fresh nhanh, warm chính xác — best of both) | ❌ Warm server lifecycle (phải keep-alive, reaper cho stale) |
| ✅ Cross-file (warm LSP biết project context) | ❌ IPC overhead (warm branch cần IPC round-trip) |
| ✅ Cold fallback (warm không sẵn → fresh vẫn chạy) | ❌ Merge dedup (same finding từ 2 branch → cần dedup) |
| ✅ Cold note (agent biết runner nào chưa warm → hint) | ❌ Fresh false positive (local pattern không có type info) |

## Khác các hướng gần

| | 430 PN Sidechannel-Routing | PM: Warm-Fresh-Dual |
|---|---|---|
| Cái gì | IPC routing 2 kênh | **2 analysis branch (warm vs fresh)** |
| Warm | ✅ (IPC channel) | ✅ (LSP server attach) |
| Fresh | ❌ | ✅ (local worker, no LSP) |
| Mục đích | Routing | **Analysis accuracy + speed** |

## Khi nào chọn

- Analysis cần vừa nhanh vừa chính xác (fresh speed + warm accuracy)
- Có LSP server warm (incumbent running — attach reuse)
- Muốn cold fallback (warm không sẵn → fresh vẫn hoạt động)
- Nối 430 PN cold-warm-ipc-sidechannel (PM = analysis logic, PN = IPC routing cho warm branch) + pi-lens (reference impl); guard warm server lifecycle (stale server → reaper, re-attach)
