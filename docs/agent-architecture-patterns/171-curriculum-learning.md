# Hướng FO: Curriculum Learning Layer — agent tự tăng độ khó task theo năng lực

> **Nguồn gốc:** arXiv 2512.08545 "Curriculum Guided Massive Multi-Agent" (Kar 2025 — progressive skill acquisition); WebRL (Qi — 96 cites, curriculum + online actor-critic, task sets tăng độ khó); ADCL (EMNLP 2025, 22 cites — Difficulty Shift, adaptive difficulty); CurriculumPT (MDPI Appl. Sci. 2025, 15 cites — định nghĩa task difficulty + curriculum sequence)
> **Coupling:** 🟡 — runtime phải đo được năng lực + phục vụ task theo độ khó
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (PP eval + task pipeline sẵn; thiếu difficulty scheduling)
> **Effort:** 2-3 tuần

## Nguồn gốc

Curriculum learning: **dạy/tăng dần — task dễ trước, khó sau, theo năng lực hiện tại** — arXiv 2512.08545: "curriculum learning emerged as a powerful paradigm for shaping learning trajectory — progressive skill acquisition, improved"; WebRL (96 cites): "leverages a curriculum learning setup to perform online actor-critic RL over generated task sets of increasing difficulty"; ADCL (EMNLP 2025 22 cites): giải "Difficulty Shift" — adaptive difficulty theo quá trình; CurriculumPT (15 cites): "how to reasonably define task difficulty and design effective curriculum sequence". Điểm khác **PP eval** (đo chất lượng với dataset cố định) và **147 data flywheel** (học từ dữ liệu người dùng) — PPPPPPP *điều phối độ khó task*: (1) difficulty score — mỗi task có độ khó (mấy bước? trừu tượng? nhiều tool? — CurriculumPT định nghĩa difficulty); (2) ability estimate — theo dõi success rate per độ khó (PP baseline); (3) schedule — task mới giao theo năng lực: dễ vừa thành → tăng độ khó (curriculum scheduling — Romac); (4) adaptive — khi agent giỏi bỏ xa → tăng nhanh (ADCL), kẹt → lùi bài dễ (review — 150 scenario), không ném task quá khó; (5) dùng cho onboarding agent mới (153 — agent mới bắt đầu từ dễ); (6) eval — PP theo độ khó phân tầng, đo tiến bộ (YYYY).

## Kiến trúc

```
  DIFFICULTY SCORE mỗi task (CurriculumPT — mức độ phức tạp)
        │
        ▼
  ABILITY MEASURE: PP success rate theo độ khó (baseline)
        │
        ▼
  CURRICULUM SCHEDULE (WebRL): task mới = độ khó vượt nhỉnh
   · adaptive (ADCL — Difficulty Shift: tăng nhanh khi trôi)
        │
        ├── thành → TĂNG độ khó (progressive shaping — Turing)
        ├── kẹt    → LÙI task dễ hơn (recycle — 150)
        └── mới   → bắt đầu từ dễ (153 onboarding)
        │
        ▼
  THEO DÕI: progress theo difficulty (YYYY + V episodic) → tune LLM/tools
```

```
mya: PP eval + 153 onboarding SẴN — thiếu: difficulty scheduling layer
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ PP eval — đo năng lực (nền ability measurement)
// ✅ 153 onboarding — agent mới tập từ dễ (tự nhiên)
// ✅ 150 scenario — luyện task khác nhau (nguồn task)
// ✅ 147 feedback + YYY — theo dõi tiến trình
// ✅ J memory — nhớ bài học theo độ khó

// ❌ THIẾU: difficulty score (định nghĩa độ khó — CurriculumPT)
// ❌ THIẾU: curriculum schedule (adaptive — WebRL/ADCL)
// ❌ THIẾU: adaptive pacing (Difficulty Shift — ADCL)
```

## Implementation

```typescript
// packages/curriculum/src/schedule.ts (NEW)
export class Curriculum {
  difficulty(task: Task): number { return complexity(task) * abstractness(task); }
  async next(agent: AgentState): Task {
    const ability = eval.ability(agent);          // PP success by difficulty
    const target = ability.threshold + DELTA;    // vừa nhỉnh khó hơn (adaptive)
    return tasks.pick(target); // CurriculumTask — tăng theo tiến độ (WebRL)
  }
  adapt(agent, result) {   // ADCL: Difficulty Shift — tăng/lùi theo kết quả
    return result.ok ? level.up(agent) : level.down(agent);
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent đỡ vỡ — học từ dễ lên khó (progressive — arXiv 2512.08545) | ❌ Khó định nghĩa "độ khó" — subjective |
| ✅ Tiến nhanh hơn — adaptive tăng theo trôi (ADCL) | ❐ Cần kho task đủ độ khó — phải tích lũy + phân loại |
| ✅ Training agent mới an toàn (bắt đầu từ dễ) | ❌ Năng lực đo bằng success không đủ (quality) |
| ✅ Xây trên PP + 150 + 153 | ❌ Quá dễ → chán, quá khó → kẹt (Difficulty Step) |

## Khác các hướng gần

| | PP Eval | 153 Onboarding | PPPPPPP: Curriculum |
|---|---|---|---|
| Mục đích | Đo chất lượng | Tập bắt đầu | **Sắp task theo độ khó** |
| Cơ chế | Bài so sánh | Bài cho agent mới | **Adaptive difficulty + pacing** |
| Quan hệ | Nguồn đo | phần đầu | **Lớp điều chỉnh độ khó** |

## Khi nào chọn

- Agent phải "mọc" — nhiều độ kỹ, không thể làm việc khó ngay
- Có kho task nhiều mức độ khó (tự tạo + tích lũy — CurriculumPT)
- Muốn agent tăng trưởng đo được (PP theo difficulty)
- Đã có PP + 150 + 153 — thêm difficulty + adaptive schedule