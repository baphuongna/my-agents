# Hướng PY: Dreaming Sleep Phases — pha ngủ light/REM/deep nén trí nhớ theo tầng

> **Nguồn gốc:** OpenClaw (dreaming sleep phases); "memory consolidation during idle"; "sleep-time computing"; "spaced repetition consolidation"; "biological sleep cycle analog: NREM-light → REM → NREM-deep"
> **Coupling:** 🟡 — cần idle-detector + multi-tier consolidation pipeline
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (memory-consolidation sẵn — chưa có sleep-phase scheduler + tiered compression)
> **Effort:** 3-4 tuần

## Nguồn gốc

**OpenClaw** mô phỏng **chu kỳ ngủ sinh học** cho agent: khi idle (không user message), agent vào **sleep phases** nén trí nhớ theo tầng. **Light sleep** (NREM-1/2): recent working memory → episodic memory (gần đây → lưu nhanh). **REM sleep**: pattern extraction — quét episodic, rút pattern/insight → semantic memory (giống mơ = kết nối ý). **Deep sleep** (NREM-3): deep compression — semantic cũ → archival storage, xóa noise (giống sóng chậm = consolidation sâu). Mỗi phase có **budget** khác nhau (light rẻ/thường xuyên, deep đắt/hiếm). Giống **sleep-time computing** (compute khi rảnh). Khác **82 memory-consolidation** (single pass) — PY là **phased cycle**; khác **90 prompt-caching** (cache cho latency) — PY là **memory compression cho capacity**.

## Mô tả

mya dreaming sleep phases: **idle-detector** phát hiện agent rảnh →调度 **sleep cycle**. Cycle gồm 3 phase luân phiên: (1) **light** (~30s): commit working memory → episodic (session events → memories). (2) **REM** (~2min): extract patterns từ episodic → semantic (insight, preference). (3) **deep** (~5min): compress semantic cũ → archival, xóa noise/duplicate. Phase chạy **background** (không block user). Khi user quay lại → **wake** (ngắt cycle, load working memory). Nối 82 memory-consolidation + 165 hierarchical-memory + 88 hybrid-graph-vector.

## Kiến trúc

```
  IDLE DETECTOR (no user msg > 5 min):
        │
        ▼
  ┌─── SLEEP CYCLE (background, non-blocking) ───────────┐
  │                                                       │
  │  ┌─ LIGHT (NREM-1/2) ─ ~30s ── every cycle ──────┐   │
  │  │  working memory → episodic memory               │   │
  │  │  (recent session events → stored memories)      │   │
  │  │  budget: nhỏ, thường xuyên                      │   │
  │  └────────────────────┬─────────────────────────────┘   │
  │                       ▼                                │
  │  ┌─ REM ───────────── ~2min ── every 3rd cycle ────┐   │
  │  │  episodic → semantic memory                      │   │
  │  │  pattern extraction: "user hay yêu cầu test"     │   │
  │  │  insight: "auth module hay bug ở token refresh"  │   │
  │  │  budget: vừa, định kỳ                            │   │
  │  └────────────────────┬─────────────────────────────┘   │
  │                       ▼                                │
  │  ┌─ DEEP (NREM-3) ─── ~5min ── every 10th cycle ───┐   │
  │  │  semantic → archival (deep compression)          │   │
  │  │  xóa noise, duplicate, merge similar             │   │
  │  │  budget: lớn, hiếm                               │   │
  │  └────────────────────┬─────────────────────────────┘   │
  │                       │ (loop back to light)            │
  └───────────────────────┴───────────────────────────────┘
                          │
  USER RETURNS → WAKE: ngắt cycle, load working memory
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 82 memory-consolidation — session → memory (nền — PY = phased version)
// ✅ 165 hierarchical-memory — multi-level memory (tier targets)
// ✅ 88 hybrid-graph-vector-memory — vector + graph (storage backend)
// ✅ agent-loop idle — agent rảnh giữa turn (nền — PY adds sleep scheduler)

// ❌ THIẾU: idle-detector (trigger sleep khi rảnh > threshold)
// ❌ THIẾU: sleep-phase scheduler (light/REM/deep cycle)
// ❌ THIẾU: tiered compression (working → episodic → semantic → archival)
// ❌ THIẾU: pattern extraction in REM (insight/preference mining)
// ❌ THIẾU: wake protocol (ngắt cycle, restore working memory)
```

## Implementation

```typescript
// packages/agent/src/sleep-phases.ts (NEW)
type SleepPhase = 'light' | 'rem' | 'deep';

interface PhaseConfig {
  duration: number;       // ms
  interval: number;       // run every Nth cycle
  budget: { maxTokens: number; maxItems: number };
}

const PHASE_CONFIG: Record<SleepPhase, PhaseConfig> = {
  light: { duration: 30_000,  interval: 1,  budget: { maxTokens: 2000, maxItems: 50 } },
  rem:   { duration: 120_000, interval: 3,  budget: { maxTokens: 4000, maxItems: 30 } },
  deep:  { duration: 300_000, interval: 10, budget: { maxTokens: 8000, maxItems: 20 } },
};

class SleepScheduler {
  private cycle = 0;
  private sleeping = false;

  onIdle(): void {
    if (this.sleeping) return;
    this.sleeping = true;
    void this.runCycle();
  }

  onWake(): void {
    this.sleeping = false; // signal cycle loop to stop
    // Restore working memory from latest episodic snapshot
  }

  private async runCycle(): Promise<void> {
    while (this.sleeping) {
      this.cycle++;
      // Light: every cycle
      await this.lightSleep();
      // REM: every 3rd cycle
      if (this.cycle % PHASE_CONFIG.rem.interval === 0) await this.remSleep();
      // Deep: every 10th cycle
      if (this.cycle % PHASE_CONFIG.deep.interval === 0) await this.deepSleep();
    }
  }

  private async lightSleep(): Promise<void> {
    // working memory → episodic (recent session events → stored memories)
  }
  private async remSleep(): Promise<void> {
    // episodic → semantic (pattern extraction, insight mining)
  }
  private async deepSleep(): Promise<void> {
    // semantic → archival (deep compression, dedup, noise removal)
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tận dụng idle time (compute khi rảnh, không lãng phí) | ❌ Resource cost (background compute tốn CPU/token) |
| ✅ Tiered compression (gần → xa, rẻ → đắt) | ❌ Phức tạp scheduler (3 phase, interval khác nhau) |
| ✅ Pattern extraction (REM = insight mining tự động) | ❌ Race condition (user quay lại giữa deep sleep) |
| ✅ Memory tự tối ưu (xóa noise/dup khi idle) | ❌ Cold start (cycle đầu chỉ light, chưa có deep) |

## Khác các hướng gần

| | 82 Memory-Consolidation | 165 Hierarchical-Memory | 90 Prompt-Caching | PY: Sleep-Phases |
|---|---|---|---|---|
| Trọng tâm | Session → memory | Multi-level store | Cache cho latency | **Phased consolidation khi idle** |
| Khi | End of session | Luôn | Mỗi turn | **Khi agent rảnh** |
| Phase | Single pass | Static tiers | Cache hit | **Light/REM/deep cycle** |

## Khi nào chọn

- Agent có nhiều idle time (user vắng, background agent)
- Cần memory tự tối ưu (compress, dedup, extract pattern khi rảnh)
- Muốn tận dụng idle compute (sleep-time computing)
- Nối 82 memory-consolidation + 165 hierarchical-memory + 88 hybrid-graph-vector-memory
