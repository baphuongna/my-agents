# Hướng DR: Agent Reproducibility — chạy lại agent ra cùng kết quả

> **Nguồn gốc:** "Multi-Artifact Versioning" (SSRN 2026); jfrog reproducibility; arXiv 2603.06862 artifact evaluation
> **Coupling:** 🟢 — tầng ghi/khôi phục, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (versioning sẵn; thiếu stack pin)
> **Effort:** 1-2 tuần

## Nguồn gốc

Reproducibility cho agent: **chạy lại cùng input + cùng stack → cùng output (gần đúng)** — như build reproducibility (jfrog: "recreate a build with the exact versions of dependencies"); SSRN MAV: LLM-agent software cần multi-artifact versioning (prompt version, model version, tool schema, data, code — *toàn bộ* xác định output); arXiv 2603.06862: reproducibility foundations + artifact evaluation. LLM có temperature → không bao giờ 100% — reproducibility nghĩa là: (1) **pin toàn bộ stack** (model id + version, prompt hash, tool defs hash, data/context hash, code commit); (2) **ghi manifest** mỗi run (đã có trace QQQQ — thêm stack hash); (3) **replay gần đúng** (temperature 0 + cùng stack → deterministic hơn; còn chênh → biết do đâu); (4) **diff giữa runs** — bản chất 2 lần chạy giống nhau đến đâu (nối 53/SSSS). Giá trị: debug ổn định (QQQQ), eval tin cậy (SSSS gate — chạy lại không fail ngẫu nhiên), MAV (QQQQQ) gắn artifact vào run.

## Mô tả

mya reproducibility layer: (1) **stack pinning** — mỗi run ghi manifest: `{model, modelVersion, prompts: hash(P), skills: hash(YY), tools: hash(OI — TTTT), data/context hash, code: commit, temperature}` — nối QQQQQ artifact registry; (2) **deterministic mode** — temp 0 + tool order ổn định + same seed → replay càng khớp; (3) **reproduce** — chạy lại với manifest cũ (đã pin) → so sánh output (53 diff) — khác do: model provider đổi (52), data đổi (ZZZZ), prompt đổi (V) — *biết chính xác yếu tố*; (4) **eval fairness** — SSSS gate: chạy 2 lần → variance đo được (khoan dung threshold theo variance — tránh fail ngẫu nhiên); (5) **rollback** — manifest cũ + stack cũ → chạy lại hành vi cũ (debug, so sánh).

## Kiến trúc

```
  RUN ──► MANIFEST (pin toàn bộ stack — jfrog-style)
    model+version · prompts hash (P) · skills (YY) · tools schema (TTTT)
    data/context hash · code commit · temperature
        │
  ┌─────┴─────────────────────────────┐
  DETERMINISTIC MODE              REPRODUCE
  temp 0 · seed · order ổn định     chạy lại manifest cũ → diff (53)
  replay khớp hơn                        │
        │                     khác do: model đổi (52) · data (ZZZZ) ·
  EVAL FAIRNESS (SSSS)                    prompt (V) — biết yếu tố nào
  chạy 2 lần → variance → threshold theo variance (không fail ngẫu nhiên)
        │
  ROLLBACK: manifest cũ + stack cũ → hành vi cũ (debug/so sánh)
```

```
mya: trace QQQQ + versioning SẸN — thiếu: manifest + pin + variance đo
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ QQQQ trace — ghi run (nơi thêm stack hash)
// ✅ QQQQQ artifact registry — manifest version (MAV)
// ✅ 52 registry — model version (đổi → diff)
// ✅ TTTT schema hash — tool defs pin
// ✅ ZZZZ drift — data đổi (nguyên nhân khác biệt)
// ✅ SSSS gate — variance threshold
// ✅ VV audit — prompt/skill changes

// ❌ THIẾU: manifest chuẩn (pin toàn bộ stack)
// ❌ THIẾU: deterministic mode (temp/seed/order)
// ❌ THIẾU: variance measurement (eval fairness)
```

## Implementation

```typescript
// packages/ai/src/reproducibility.ts (NEW)
interface RunManifest {
  stack: {
    model: string; modelVersion: string;       // 52
    prompts: string; skills: string; tools: string;  // hash P/YY/OO-TTTT
    data: string; code: string;                // commit
    temp: number;
  };
}

function pin(env: Env): RunManifest { ... }     // mỗi run ghi (QQQQQ)
function reproduce(m: RunManifest, runner): DiffResult {
  return diff(runner.run(m), expected);         // 53 — biết yếu tố khác
}
// deterministic: temp 0 + seed + tool order (điều khiển)
// variance: chạy 2× cùng manifest → σ → SSSS threshold theo σ
// (jfrog: recreate đúng version dependencies — agent: đúng stack)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Debug ổn định (QQQQ replay đúng stack) | ❐ LLM không 100% deterministic (temp 0 ≠ đủ) |
| ✅ Eval tin cậy (variance → threshold đúng) | ❌ Manifest thêm metadata mỗi run |
| ✅ Biết yếu tố nào làm khác (52/ZZZZ/V) | ❌ Provider model cũ có thể hết (52 giữ version) |
| ✅ Nối MAV/artifact (QQQQQ) + rollback | ❌ Deterministic mode thêm cấu hình |

## Khác các hướng gần

| | QQQQ Replay | 52 Model Routing | SSSSS: Reproducible |
|---|---|---|---|
| Vấn đề | Chạy lại | Chọn model | **Đóng băng stack + đo variance** |
| Cơ chế | Trace | Registry | **Manifest + pin + diff** |
| Mối quan hệ | Nền | Thành phần manifest | **Bao trùm debug/eval** |

## Khi nào chọn

- Debug agent khó vì output thay đổi lung tung
- Eval fail ngẫu nhiên (SSSS gate nhiễu)
- So sánh prompt/model versions nghiêm túc
- Đã có trace + registry + versioning — thêm manifest