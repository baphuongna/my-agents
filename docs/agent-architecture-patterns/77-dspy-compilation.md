# Hướng ZZZ: DSPy Compilation — pipeline khai báo, compiler tự tối ưu prompt

> **Nguồn gốc:** Khattab et al., 2024 "DSPy" (Stanford; arXiv 2310.03714)
> **Coupling:** 🟢 — modules thuần, compiler ngoài runtime
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (prompts + eval sẵn; thiếu compiler)
> **Effort:** 2 tuần

## Nguồn gốc

DSPy (Stanford, Khattab 2024): thay vì viết prompt tay, khai báo **pipeline** = graph các **modules** (chain-of-thought, retrieve, tool-call...), mỗi module có **signature** (input/output fields) — rồi **compile**: optimizer (BootstrapFewShot, MIPRO, teleprompt) chạy trên **training examples + eval metric** tự tạo prompt/few-shot/demo cho từng module. Bài toán: prompt engineering fragile — DSPy đưa về **tối ưu hóa có dữ liệu** (như ML). 2024-2026: dùng cho agent pipelines (tool selection, decomposition). Khác **TTT EvoPrompt** (GA mutate text prompt) — DSPy compile trên **khai báo module + signature** với optimizer có mục tiêu; có thể kết hợp: DSPy làm genotype có cấu trúc.

## Mô tả

mya khai báo pipeline agent như graph module (không viết prompt cho từng bước): `[taskDecompose → toolSelect → execute → verify]`, mỗi module = signature rõ (input: task+context; output: steps). **Compiler** chạy trên golden examples (PP) → tự tạo prompt/few-shot per module cho tới khi metric đạt → **compile artifact** (prompt đã tối ưu) nạp vào runtime (packages/prompts). Khi thêm eval case: **recompile** (không sửa prompt tay). Khác WWW Stateful Graph (điều khiển flow) — DSPy tối ưu *bên trong* module; khác FFF (LLM tự plan) — plan structure khai báo. Lưu ý: DSPy compile chạy N lượt LLM (SS budget) — chạy định kỳ, không phải mỗi request.

## Kiến trúc

```
  khai báo PIPELINE (modules + signatures)
    [decompose → select-tool → execute → verify]
                     │
                     ▼ (offline, định kỳ)
  COMPILER (BootstrapFewShot/MIPRO)
    │  training examples (golden, PP)
    │  metric (PP score)
    │  optimizer sinh prompt/few-shot per module ──► chạy N lượt (SS)
    ▼
  COMPILED ARTIFACTS (prompt tối ưu) ──► runtime (packages/prompts)
    │
  thêm eval case mới ──► recompile (không sửa prompt tay)
```

```
mya: packages/prompts (nơi nạp artifact) + packages/eval (examples + metric) sẵn
     thiếu: module DSL (signature) + compiler/optimizer + compile loop
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/prompts — config có cấu trúc (nơi nạp compiled artifact)
// ✅ packages/eval — golden examples + metric (PP = fitness cho compiler)
// ✅ packages/cron — chạy compile định kỳ
// ✅ SS rate-limiter — chặn compile chạy lố cost

// ❌ THIẾU: module DSL — khai báo pipeline + signature per module
// ❌ THIẾU: compiler/optimizer (BootstrapFewShot-class) tạo prompt từ examples
// ❌ THIẾU: metric-driven recompile khi thêm case
```

## Implementation

```typescript
// packages/prompts/src/compile.ts (NEW)
interface Module {
  name: string;
  signature: { inputs: string[]; outputs: string[] };   // contract
  optimizer?: "fewshot" | "cot" | "mipro";
}

interface Pipeline { modules: Module[] }

async function compile(p: Pipeline, examples: Example[], metric: Metric): Promise<Artifact> {
  const art: Artifact = {};
  for (const m of p.modules) {
    art[m.name] = await optimizeModule(m, examples, metric);  // sinh prompt tối ưu
    // optimizer: Bootstrap examples từ golden + metric (PP)
  }
  await promptsStore.save(art);           // packages/prompts — nạp runtime
  return art;
  // thêm eval case → recompile (không đụng prompt tay)
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Prompt không fragile — compile lại bằng dữ liệu | ❌ Compile chạy N lượt LLM (SS budget + cron) |
| ✅ Signature rõ — module contract machine-checkable | ❌ Khai báo pipeline + examples cần bảo trì |
| ✅ Thêm case = recompile (không prompt tay) | ❌ Metric kém → compile ra prompt kém (PP quan trọng) |
| ✅ Kết hợp TTT (GA mutate trên genotype có cấu trúc) | ❌ Overhead cho pipeline đơn giản |
| ✅ Stanford, phổ biến rộng (2024-2026) | |

## Khác các hướng gần

| | TTT EvoPrompt | WWW Stateful Graph | ZZZ: DSPy Compile |
|---|---|---|---|
| Tối ưu gì | Prompt (GA) | Flow điều khiển | **Prompt trong module (compiler)** |
| Genotype | Text tự do | Graph | **Signature + examples** |
| Vòng lặp | Thế hệ GA | Runtime | Recompile offline |
| Mối quan hệ | Có thể gộp | Điều khiển ngoài | **Tối ưu trong từng node** |

## Khi nào chọn

- Pipeline nhiều bước, prompt thủ công đang fragile (đổi model là vỡ)
- Có golden examples + metric tốt (PP)
- Muốn "thêm case → compile" thay vì sửa prompt tay
- Chấp nhận cost compile định kỳ (SS + cron)