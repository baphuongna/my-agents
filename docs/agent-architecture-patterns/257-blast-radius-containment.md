# Hướng IW: Blast Radius Containment — cô lập hậu quả lỗi trong namespace

> **Nguồn gốc:** Kubernetes namespaces + Pod Security; Netflix "Chaos Monkey" blast radius; AWS blast-radius isolation; "Failure Domains"; Rust panic-catch_unwind; Erlang process isolation
> **Coupling:** 🟡 — chạm agent runtime + resource isolation
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (sandbox + permission scope sẵn — thiếu fault-domain boundary)
> **Effort:** 2-3 tuần

## Nguồn gốc

Blast radius: **giới hạn vùng ảnh hưởng khi lỗi xảy ra** — không để 1 component fail kéo theo toàn hệ thống. Netflix: Chaos Monkey proactively kill instance để verify blast radius nhỏ. AWS: "blast radius = scope of impact when something fails" — isolate qua VPC, AZ, account. Kubernetes: namespace + RBAC + resource quota — pod trong namespace A không crash namespace B. Erlang: process isolation — 1 process crash, supervisor restart (HX 232), hệ vẫn chạy. Rust: `catch_unwind` — panic trong thread không hạ process. Failure domain: nhóm resource mà fail cùng nhau — thiết kế sao domain nhỏ, độc lập.

## Mô tả

mya blast radius: mỗi agent/subagent chạy trong **namespace** (cửa sổ tài nguyên cô lập) — file access, tool call, memory scoped. Khi agent fail (OOM, infinite loop JF 266, tool crash) → chỉ namespace đó affected, không lan. Nối HX (232) supervision: namespace = child trong supervision tree. Nối HW (231) DLQ: task fail cô lập trong namespace. Nối 42 circuit-breaker: trip ở scope namespace (không global). Permission scope (GGGG least-privilege) = blast radius limiter — agent chỉ có quyền trong namespace.

## Kiến trúc

```
  ┌──────────────────────────────────────────────────────────────┐
  │  GATEWAY (chịu toàn — không fail theo child)                  │
  │                                                              │
  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
  │  │ NAMESPACE A  │  │ NAMESPACE B  │  │ NAMESPACE C  │        │
  │  │ (coder)      │  │ (reviewer)   │  │ (test-run)   │        │
  │  │              │  │              │  │              │        │
  │  │ fs: ./projA  │  │ fs: ./projB  │  │ fs: sandbox  │        │
  │  │ tools: [edit]│  │ tools: [read]│  │ tools: [exec]│        │
  │  │ mem: isol.   │  │ mem: isol.   │  │ mem: isol.   │        │
  │  │ quota: 1GB   │  │ quota: 512M  │  │ quota: 2GB   │        │
  │  │              │  │              │  │              │        │
  │  │  CRASH! 💥   │  │  vẫn chạy ✓  │  │  vẫn chạy ✓  │        │
  │  │  (OOM / loop)│  │  (isolation) │  │  (isolation) │        │
  │  └──────┬───────┘  └──────────────┘  └──────────────┘        │
  │         │                                                     │
  │  ┌──────▼───────┐  supervisor (HX 232) restart A only        │
  │  │ RESTART A    │  → B, C unaffected                          │
  │  └──────────────┘                                             │
  └──────────────────────────────────────────────────────────────┘
```

```
mya: permission scope + sandbox sẵn — thiếu: formal namespace boundary + per-namespace quota + fault-domain routing
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ permission scope / least-privilege (GGGG) — quyền giới hạn (sẵn)
// ✅ HX (232) actor-supervision — restart on crash (documented)
// ✅ HW (231) dead-letter-queue — isolate fail (documented)
// ✅ 42 circuit-breaker — stop on failure (sẵn)
// ✅ subagent isolation — separate session (sẵn)

// ❌ THIẾU: formal namespace (fs + tool + memory boundary)
// ❌ THIẾU: per-namespace resource quota (memory/CPU/time)
// ❌ THIẾU: fault-domain routing (task → domain, not random)
// ❌ THIẾU: namespace GC (clean up on exit — no leak)
```

## Implementation

```typescript
// packages/runtime/src/namespace.ts (NEW)
interface Namespace {
  id: string;
  fsRoot: string;           // isolated filesystem
  allowedTools: string[];   // tool scope
  memoryBytes: number;      // quota
  timeBudgetMs: number;     // deadline
}

export class BlastRadiusManager {
  private active = new Map<string, { ns: Namespace; proc: AgentProc }>();

  async spawn(ns: Namespace): Promise<AgentProc> {
    // Enforce quota before spawn (reject if over)
    if (this.totalMemory() + ns.memoryBytes > this.maxMemory) {
      throw new Error("namespace quota exceeded");
    }
    const proc = await this.runtime.fork({
      fs: ns.fsRoot,           // chroot-like isolation
      tools: ns.allowedTools,  // tool allowlist
      memoryLimit: ns.memoryBytes,
      timeout: ns.timeBudgetMs, // deadline (215)
    });
    proc.onExit = (code) => {
      this.active.delete(ns.id); // GC namespace
      if (code !== 0) this.alert(ns.id); // 227 — blast contained but flagged
    };
    this.active.set(ns.id, { ns, proc });
    return proc;
  }

  async kill(nsId: string): Promise<void> {
    // Kill 1 namespace — others unaffected
    const entry = this.active.get(nsId);
    if (entry) { await entry.proc.kill(); this.active.delete(nsId); }
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ 1 agent fail không hạ toàn hệ (Netflix/Erlang) | ❌ Isolation overhead (fork per namespace) |
| ✅ Fault domain rõ (Kubernetes namespace-style) | ❌ Resource quota tuning |
| ✅ Permission = blast limiter (GGGG least-priv) | ❌ Cross-namespace comm harder |
| ✅ Nối HX (232) supervision + 42 circuit-breaker | ❌ Namespace leak risk (GC must be robust) |

## Khác các hướng gần

| | HX (232) Supervision | 42 Circuit-Breaker | IW: Blast Radius |
|---|---|---|---|
| Mục | Restart khi crash | Stop khi fail nhiều | **Cô lập vùng ảnh hưởng** |
| Scope | Per-child | Per-circuit | **Per-namespace (fs+tool+mem)** |
| Khi | Sau crash | Khi lỗi lặp | **Thiết kế trước (boundary)** |

## Khi nào chọn

- Agent chạy code/tool rủi ro (exec, shell, file edit)
- Cần 1 agent fail không lan (multi-tenant)
- Đã có supervision (HX 232) — muốn boundary mạnh hơn
- Nối GGGG scope + HW (231) DLQ + 215 deadline
