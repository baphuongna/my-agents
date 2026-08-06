# Hướng ZZ: Pressure-Field Coordination — gradient chất lượng, temporal decay

> **Nguồn gốc:** Rodriguez, "Emergent Coordination via Pressure Fields and Temporal Decay" (arXiv:2601.08129, 2026)
> **Coupling:** 🟢 — không có orchestration trung tâm
> **Agent-agnostic:** ✅ — agent chỉ đọc shared artifact
> **Code sẵn:** ❌ build mới (kanban + event ledger làm nền)
> **Effort:** 2-3 tuần

## Nguồn gốc

Rodriguez (2026): các framework multi-agent hiện tại vay mượn *cơ cấu tổ chức con người* — planner delegate, manager-worker, hierarchical control. Bài báo đề xuất paradigm khác: **agents vận hành cục bộ trên 1 artifact chung, chỉ bị dẫn dắt bởi pressure gradient** sinh từ tín hiệu chất lượng đo được, với **temporal decay** chống hội tụ sớm. Kết quả (1.350 trials, meeting-room scheduling): **48.5% solve rate** vs 12.6% conversation, **1.5% hierarchical**, 0.4% sequential/random (p<0.001). Tắt temporal decay → giảm 10 điểm phần trăm.

## Lưu ý khi đọc số liệu (đọc full paper, arXiv:2601.08129v3)

- **Miền duy nhất là scheduling** — chưa có thí nghiệm nào trên code. Mục "áp dụng cho code refactoring/config management" nằm ở *future work*, không phải kết quả.
- **Model yếu cố ý** (qwen2.5 0.5b/1.5b/3b) — để cô lập giá trị của cơ chế phối hợp; số tuyệt đối không phải benchmark model mạnh.
- **Ablation decay không có ý nghĩa thống kê** (n=30, p=0.35) — "decay giảm 10pp" chỉ là gợi ý, không phải kết luận.
- **Cơ chế đáng giá**: separable per-region pressure (ε=0, verify 9.873 transitions: 0 degradation) + fork-validated parallel greedy patches + inhibition + escalation ladder (temperature/model tăng khi pressure velocity = 0). Chứng minh hội tụ là potential game (Thm 5.1: δ_min > (n−1)ε).
- **Bài học âm**: "always pick highest-pressure region" (hierarchical) chết vì rejection loop 98.7% — chính là lý do không nên chỉ nhắm vùng khó nhất.
- **Rủi ro thừa nhận**: Goodhart (agent game hóa metric), coupling ẩn qua chuỗi patch, decay miscalibration — cần periodic full-coherence checks.

## Mô tả

Thay vì ra lệnh "agent B làm việc X", mỗi agent đo **áp lực** tại các vùng của workspace (vd: số task pending, mức "xấu" của code, độ sâu nợ) và tự di chuyển tới vùng áp lực cao nhất mà mình giải quyết được. Áp lực = hàm của tín hiệu chất lượng + temporal decay (việc chờ lâu → áp lực tăng; làm xong → giảm). Không ai ra lệnh — như phong trào sinh học (physarum). Khác stigmergy (T — feedback qua dấu vết môi trường): đây là **gradient đẩy chủ động**, có hàm mục tiêu tường minh + chứng minh hội tụ.

## Kiến trúc

```
┌────────────────────────────────────────────────────────────┐
│         PRESSURE LANDSCAPE (shared workspace)               │
│                                                            │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐      │
│  │ zone: parse │   │ zone: code  │   │ zone: tests │      │
│  │ pressure P₁ │   │ pressure P₂ │   │ pressure P₃ │      │
│  │ (todo tasks)│   │ (red tests) │   │ (fail rate) │      │
│  └─────────────┘   └─────────────┘   └─────────────┘      │
│        ▲                 ▲                 ▲                │
│        └────────┬────────┴────┬───────────┘                │
│                 ▼             ▼                            │
│        ┌────────────────┐  ┌────────────────┐              │
│        │ agent A        │  │ agent B        │              │
│        │ pick zone argmax│  │ pick zone argmax│             │
│        │ (P × fit)       │  │ (P × fit)       │             │
│        └────────────────┘  └────────────────┘              │
│                                                            │
│  P(zone) = quality_signal(t) × decay(age)                  │
│  làm xong → signal giảm → agent tự rời đi                  │
└────────────────────────────────────────────────────────────┘
```

## Implementation

```typescript
// packages/gateway/src/pressure-field.ts (NEW)
interface Zone {
  id: string;
  pressure: (nowMs: number) => number;   // quality signal × decay
  fitFor: (agent: AgentProfile) => number;
}

function pressure(qualitySignal: number, ageMs: number, decayHalfLifeMs = 3600_000): number {
  // Temporal decay: việc chờ càng lâu → decay càng giảm nhưng không về 0;
  // signal chất lượng cao → pressure cao → agent bị hút tới.
  return qualitySignal * Math.pow(0.5, ageMs / decayHalfLifeMs);
}

class PressureField {
  private zones: Zone[] = [];     // kanban theo stage + fail-rate từ event ledger

  async step(agent: AgentProfile): Promise<Zone | null> {
    let best: Zone | null = null;
    let bestScore = 0;
    for (const zone of this.zones) {
      const score = zone.pressure(Date.now()) * zone.fitFor(agent);
      if (score > bestScore) { bestScore = score; best = zone; }
    }
    return best;                   // agent tự đi, không ai ra lệnh
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không orchestration overhead (scale theo số agent) | ❌ Áp lực "hút" nhầm vùng (signal thiết kế sai) |
| ✅ Chứng minh hội tụ + 48.5% vs 1.5% (hierarchical) | ❌ Chưa ai áp dụng cho coding agents (rủi ro mới) |
| ✅ Temporal decay chống hội tụ sớm | ❌ Cần định nghĩa quality signal đo được |
| ✅ Elegant, đúng tông "novel" của bộ docs | ❌ Agent cần cooperatitve (đọc shared artifact) |
| ✅ Kanban + event ledger làm nền | |

## Khi nào chọn

- Nhiều agents (>4) chung 1 dự án — hierarchical bắt đầu nghẽn
- Có sẵn tín hiệu chất lượng (test fail rate, task backlog age)
- Muốn thử nghiệm paradigm novel (đúng tinh thần bộ docs)
- Chấp nhận rủi ro chưa chứng minh trên miền coding
