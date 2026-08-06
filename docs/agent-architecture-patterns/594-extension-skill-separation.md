# Hướng VV: Extension Skill Separation — extension=domain-agnostic infrastructure (timing/logging/dashboard); skill=domain knowledge (commands/metrics)

> **Nguồn gốc:** pi-autoresearch (extension skill separation); "extension = domain-agnostic infrastructure (timing, logging, dashboard)"; "skill = domain knowledge (commands, metrics, domain logic)"; "infrastructure vs knowledge split" | **Coupling:** 🟢 — tách extension (infra) khỏi skill (domain) trong plugin layer | **Agent-agnostic:** ✅ | **Code sẵn:** ✅ (skills package sẵn — chỉ cần extension layer bên trên) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-autoresearch** phân biệt rõ **2 layer plugin**: (1) **Extension** — **domain-agnostic infrastructure**: timing, logging, dashboard, experiment runner. Extension không biết gì về domain cụ thể (không biết benchmark đo gì, chỉ biết đo + log + hiển thị). (2) **Skill** — **domain knowledge**: commands cụ thể (`run_bench.sh`), metrics định nghĩa (`latency_ms`), domain logic ("caching reduces latency"). Nguyên tắc: **infra reusable across domains, knowledge domain-specific**. Extension cung cấp "cái móc" (timing/logging), skill móc "thứ đo" (command/metric) vào. Khác monolithic plugin (trộn infra + domain) — VV **clean separation**; khác skill-only (mọi thứ là skill) — VV **infra layer riêng**.

## Mô tả

mya extension skill separation: (1) **Extension layer**: domain-agnostic — `timing-extension` (đo thời gian bất kỳ command), `logging-extension` (log structured), `dashboard-extension` (hiển thị metrics). Extension không hardcode domain. (2) **Skill layer**: domain-specific — `benchmark-skill` (định nghĩa `run_bench.sh`, metric `latency_ms`, target `90ms`). Skill móc vào extension. (3) **Composition**: extension + skill = full pipeline (timing-extension đo run_bench.sh của benchmark-skill). (4) **Reuse**: cùng timing-extension dùng cho nhiều skill khác nhau. mya có skills package — VV thêm **extension layer** (infra) tách khỏi **skill** (domain).

## Kiến trúc

```
  ┌─── EXTENSION LAYER (domain-agnostic infrastructure) ────┐
  │  timing-extension:    measure duration of any command     │
  │  logging-extension:   structured append-only log          │
  │  dashboard-extension: render metrics to TUI/HTML          │
  │  → KHÔNG biết domain (chỉ biết đo/log/render chung)       │
  └───────────────────────┬───────────────────────────────────┘
                          │ (skill móc vào extension)
                          ▼
  ┌─── SKILL LAYER (domain knowledge) ──────────────────────┐
  │  benchmark-skill:                                         │
  │    command: .auto/run_bench.sh   (domain-specific)       │
  │    metric:  latency_ms           (domain-defined)        │
  │    target:  90ms                 (domain goal)           │
  │  → móc vào timing-extension (đo run_bench.sh)             │
  │  → móc vào logging-extension (ghi latency_ms)            │
  │  → móc vào dashboard-extension (hiển thị trend)          │
  └───────────────────────────────────────────────────────────┘

  COMPOSITION: timing-extension + benchmark-skill = benchmark pipeline
  REUSE: timing-extension + render-skill = rendering benchmark (khác domain)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/skills — skill system (nền — VV skill layer = đây)
// ✅ packages/tools — tool dispatch (nền — VV extension = tool infra)
// ✅ packages/core telemetry.ts — timing/metrics (nền — VV timing-extension relate)
// ✅ packages/audit — logging (nền — VV logging-extension relate)

// ❌ THIẾU: extension layer (domain-agnostic infra, tách khỏi skill)
// ❌ THIẾU: extension-skill composition (skill móc vào extension)
// ❌ THIẾU: extension registry (timing/logging/dashboard reusable)
```

## Implementation

```typescript
// packages/skills/src/extension-skill-separation.ts (MỚI)

// EXTENSION: domain-agnostic infrastructure (không biết domain)
interface Extension {
  name: string;
  kind: 'timing' | 'logging' | 'dashboard';
  run: (command: string, opts: Record<string, unknown>) => Promise<unknown>;
}

class TimingExtension implements Extension {
  name = 'timing'; kind = 'timing' as const;
  async run(command: string): Promise<{ durationMs: number; stdout: string }> {
    const start = Date.now();
    // exec command → capture time
    const { durationMs } = { durationMs: Date.now() - start };  // simplified
    return { durationMs, stdout: '' };
  }
}

// SKILL: domain knowledge (biết domain, móc vào extension)
interface Skill {
  name: string; extensions: string[]; command: string; metricName: string; target: number;
}

class BenchmarkSkill implements Skill {
  name = 'benchmark'; extensions = ['timing', 'logging', 'dashboard'];
  command = '.auto/run_bench.sh'; metricName = 'latency_ms'; target = 90;
}

// REGISTRY: compose extension + skill
class ExtensionSkillRegistry {
  private extensions = new Map<string, Extension>();
  private skills = new Map<string, Skill>();
  registerExtension(ext: Extension): void { this.extensions.set(ext.name, ext); }
  registerSkill(skill: Skill): void { this.skills.set(skill.name, skill); }

  // compose: chạy skill command qua extension
  async runSkill(skillName: string): Promise<Record<string, unknown>> {
    const skill = this.skills.get(skillName);
    if (!skill) throw new Error(`unknown skill: ${skillName}`);
    const timing = this.extensions.get('timing') as TimingExtension;
    const result = await timing.run(skill.command);
    return { [skill.metricName]: result.durationMs, target: skill.target };
  }
}

// Usage:
// reg.registerExtension(new TimingExtension());
// reg.registerSkill(new BenchmarkSkill());
// const m = await reg.runSkill('benchmark');  // → { latency_ms: 108, target: 90 }
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Infra reuse (timing-extension dùng cho mọi skill) | ❌ Abstraction overhead (2 layer thay vì 1) |
| ✅ Clean separation (infra không lẫn domain) | ❌ Interface contract (extension ↔ skill phải khớp) |
| ✅ Testable (extension test độc lập domain) | ❌ Discovery complexity (agent phải biết skill+extension) |
| ✅ Extensible (thêm skill mới, reuse extension) | ❌ Over-engineering risk (domain đơn giản thì 1 layer đủ) |

## Khác các hướng gần

| | Monolithic plugin | Skill-only | VV: Extension-Skill-Separation |
|---|---|---|---|
| Layer | 1 (trộn) | 1 (skill) | **2 (extension infra + skill domain)** |
| Reuse | ❌ (trộn domain) | ⚠ (skill reuse khó) | **✅ extension reusable** |
| Domain | Hardcoded | Per-skill | **Skill (skill biết, extension không)** |

## Khi nào chọn

- Cần infrastructure reusable (timing/logging/dashboard dùng cho nhiều domain)
- Muốn tách infra khỏi domain knowledge (clean architecture)
- Nhiều skill chia sẻ cùng infra (vd mọi benchmark đều cần timing)
- Nối packages/skills + packages/tools + packages/core telemetry.ts; guard interface-stability (extension API ổn để skill móc), discovery-clarity (agent biết skill cần extension nào), và avoid-over-abstraction (domain đơn giản → 1 layer đủ, không ép 2); VV = extension skill separation, kết hợp 589 VQ experiment-loop (extension = experiment infra, skill = benchmark domain) + packages/skills (skill layer sẵn có)
