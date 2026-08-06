# Hướng CR: Agent CI/CD — chạy eval làm gate khi merge prompt/tool

> **Nguồn gốc:** "CI/CD for Evals: Prompt & Agent Regression in GitHub Actions" (kinde 2026); galtea quality gate 2026; Red Hat "Behavioral Testing" 2026
> **Coupling:** 🟢 — tầng dev, không đụng runtime
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (eval + vitest sẵn; thiếu CI gate + datasets)
> **Effort:** 1 tuần

## Nguồn gốc

Agent CI/CD: **chạy evals tự động trong pipeline khi PR đổi prompt/model/tool** — chặn regression trước khi merge (kinde 2026: "automatically testing your AI prompts, models, and agents within CI"; galtea 2026: "quality regressions get caught before they ship, not after support tickets"). Red Hat 2026: "Behavioral testing belongs in CI to catch regressions — agent evaluation belongs in experiment workflows". Khác **PP eval** (chạy tay/mỗi lần) — CI/CD *tự động gắn vào PR*: diff prompt/skill/tool → chạy regression suite → gate merge (fail → chặn). Khác **QQQQ replay** (debug loop cá nhân) — CI/CD là *cổng chuẩn hóa cho team*. Vấn đề: LLM non-deterministic → threshold phải có khoảng dung sai + chạy nhiều seeds; cost (mỗi PR chạy LLM eval) → phối NNNN dataset + GGGG judge + PPPP local (chạy rẻ).

## Mô tả

mya pipeline CI (GitHub Actions): (1) **detect change** — diff prompt/skill/tool/spec (HHHH) → chọn suite liên quan; (2) **chạy regression** — NNNN dataset (synthetic + golden QQQQ + trace thật) → agent chạy (stub tool UUUU, model rẻ PPPP); (3) **gate** — GGGG judge + expected → điểm ≥ threshold → merge; dưới → chặn PR với report (53); (4) **khoan dung** — chạy n seeds, compare median, không fail vì 1 outlier. Suite chậm chạy nightly (không chặn mỗi PR); suite nhanh (behavioral — redhat) chặn PR. Nối: HHHH spec → diff detect; QQQQ golden; TTTT schema check chạy cùng gate.

## Kiến trúc

```
  PR (đổi prompt/skill/tool/spec) ──► CI ──► DIFF DETECT (HHHH spec)
        │
        ▼
  REGRESSION SUITE (nhanh — gate PR)
    NNNN dataset (synth+golden) ──► agent run (stub UUUU, rẻ PPPP)
        │                              │
        ▼                              ▼
  GGGG judge + expected ──► score ≥ threshold? ──► MERGE
                              │ fail
                              ▼
                        chặn PR + report (53)
        │
  SUITE CHẬM (nightly — không chặn): trace thật replay (QQQQ), drift (TTTT)
```

```
mya: packages/eval + vitest SẴN (chạy tay) — thiếu: CI pipeline + gate + dataset
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/eval (PP) — runner — nền CI
// ✅ NNNN + QQQQ — dataset sẵn (synth + golden + trace)
// ✅ GGGG judge — chấm tự động
// ✅ PPPP local + UUUU stub — chạy rẻ + không side-effect
// ✅ report (53) — trả kết quả gate
// ✅ HHHH spec — diff detect (đổi gì → chạy suite gì)

// ❌ THIẾU: GitHub Actions workflow (diff → suite → gate)
// ❌ THIẾU: threshold policy (khoan dung non-determinism)
// ❌ THIẾU: tách suite nhanh (gate PR) / chậm (nightly)
```

## Implementation

```yaml
# .github/workflows/agent-eval.yml (NEW)
on: pull_request
jobs:
  agent-eval:
    steps:
      - run: npx mya eval diff --from=$BASE --to=$HEAD   # HHHH detect
      - run: npx mya eval run --suite=fast --model=local # NNNN + PPPP + stub
      - run: npx mya eval gate --threshold=0.8           # GGGG score
        # fail → block merge + report (53)
```

```typescript
// packages/eval/src/ci.ts (NEW)
function gateScore(results: EvalRun[], seeds: number): number {
  // median theo seeds — không fail vì 1 outlier (non-determinism)
  return median(results.map((r) => r.score));
}
// suite fast = behavioral checks (redhat) → gate PR
// suite slow = trace replay + drift (QQQQ/TTTT) → nightly
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chặn regression trước merge (galtea 2026) | ❌ LLM non-determinism — threshold khó đúng |
| ✅ Đổi prompt/tool có vòng đánh giá tự động | ❐ Cost mỗi PR (PPPP local + UUUU stub giảm) |
| ✅ Report dễ đọc trong PR (53) | ❌ Dataset phải duy trì (NNNN/QOQQ) |
| ✅ Tách nhanh/chậm — PR không kẹt | ❌ False fail làm team khó chịu |
| ✅ Nối toàn bộ stack eval (NNNN/GGGG/QQQQ) | |

## Khác các hướng gần

| | PP Eval | QQQQ Replay | SSSS: CI/CD |
|---|---|---|---|
| Chạy khi nào | Thủ công | Debug cá nhân | **Tự động mỗi PR** |
| Vai trò | Runner | Thí nghiệm | **Cổng merge (gate)** |
| Mối quan hệ | Nền | Cung cấp golden | **Điều phối cả 2 + NNNN** |

## Khi nào chọn

- Đổi prompt/skill thường xuyên — muốn chặn vỡ
- Đã có eval + dataset + judge — thêm workflow là ngắn
- Có CI (monorepo mya có GitHub Actions nền)
- Chấp nhận chạy eval rẻ (PPPP local + stub UUUU)