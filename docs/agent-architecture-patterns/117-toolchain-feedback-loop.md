# Hướng DM: Toolchain Feedback Loop — lint/typecheck/test làm feedback cho agent code

> **Nguồn gốc:** "Rust's Compiler Catches What Coding Agents Get Wrong" (marclove 2025); aihero "AI Coding Feedback Loops for TS" 2026; arXiv 2605.20456 Agentic Agile-V
> **Coupling:** 🟢 — toolchain chạy ngoài, agent không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ✅ (lint + typecheck + vitest sẵn)
> **Effort:** 1 tuần

## Nguồn gốc

Toolchain feedback: **đưa output của lint/typecheck/test vào vòng lặp agent** — marclove 2025: "type system, borrow checker produce specific, actionable error messages that slot naturally into the agentic loop — catching hallucinations, dead code, bugs"; aihero 2026: TS feedback loops — type checking + testing + pre-commit hooks "keep AI agents working correctly"; arXiv 2605.20456 "Agentic Agile-V": verified engineering — inspect, plan, edit, run tests, PR; lotharschulz 2026: "Editor Loop — seconds-fast feedback via agent lifecycle hooks". Khác **MMMMM spec-test-code** (sinh test từ spec — contract) — NNNNN là *toolchain có sẵn* chạy sau mỗi edit (không cần spec): typecheck/lint/best-practice auto → agent nhận lỗi cụ thể → sửa; khác **SSSS CI** (cuối PR) — NNNNN là *trong loop* (giây, không phút).

## Mô tả

mya coding loop (subagent GG): mỗi lần agent sửa file → hook chạy (1) **typecheck** (tsc — mya TS strict) → lỗi kiểu + vị trí; (2) **lint** (eslint) → lỗi style/best-practice; (3) **test nhanh** (vitest file đụng) → fail cụ thể; (4) **build** → lỗi build — tất cả trả về agent **dưới dạng structured error** (file:line + message — nối PPPPP): agent sửa cho đến khi sạch (giới hạn vòng — RRRR budget; hết → fail-loud không sửa bừa — Lanham). Đây là "cheap high-value": toolchain sẵn có, không tốn LLM để phát hiện — chỉ agent sửa. Khác ACI (60) — interface: NNNNN *quy trình*: sau-edit → chạy → feedback → sửa.

## Kiến trúc

```
  AGENT EDIT file ──► HOOK (lifecycle — lotharschulz Editor Loop)
        │
        ▼
  TOOLCHAIN (đã có sẵn mya):
    tsc (typecheck) · eslint (lint) · vitest (test đụng) · build
        │
        ▼
  STRUCTURED ERROR (file:line + message — PPPPP)
    ├─ lỗi kiểu/best-practice/compile — agent SỬA (vòng giới hạn RRRR)
    ├─ sạch ──► tiếp tục task (MẤY criteria 53)
    └─ hết vòng còn lỗi ──► FAIL-LOUD (báo triage CCC — không sửa bừa)
```

```
mya: tsc + eslint + vitest + build SẸN (repo TS strict) — chỉ thiếu hook loop
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages — tsc strict + eslint + vitest (toolchain đủ)
// ✅ RRRR budget — giới hạn vòng sửa
// ✅ PPPPP structured error (nối)
// ✅ MMMMM criteria — tiếp nối sau khi sạch
// ✅ GG subagents — coding loop (nơi thêm hook)
// ✅ CI workflows — build/lint/test sẵn (tái dùng)

// ❌ THIẾU: post-edit hook chạy toolchain trong loop
// ❌ THIẾU: structured error format (file:line + message)
// ❌ THIẾU: fail-loud policy (hết vòng → triage)
```

## Implementation

```typescript
// packages/print/src/toolchain-hook.ts (NEW)
async function afterEdit(files: string[]): Promise<Feedback[]> {
  return [
    ...(await run("tsc --noEmit")),        // typecheck — TS strict
    ...(await run("eslint")),             // lint
    ...(await run(`vitest run ${touched(files)}`)),  // test đụng
  ].map(structured);                      // file:line + message (PPPPP)
}

// agent loop: edit → hook → feedback → sửa (vòng ≤ budget RRRR)
// hết vòng vẫn lỗi → fail-loud (CCC) — KHÔNG tự sửa bừa (Lanham 2026)
// marclove: type system bắt hallucination/dead code — vào loop tự nhiên
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Toolchain có sẵn — phát hiện lỗi không tốn LLM | ❌ Hook chạy thêm thời gian mỗi edit |
| ✅ TS strict bắt hallucination/dead code (marclove) | ❐ Lỗi lint phức (config) — feedback phải rõ |
| ✅ Lỗi cụ thể file:line → agent sửa đúng chỗ | ❌ Test chậm — chỉ chạy file đụng (nhanh) |
| ✅ Nối PPPPP + RRRR + CI thành vòng kín | ❌ Toolchain sai config → feedback nhiễu |

## Khác các hướng gần

| | MMMMM Spec→Test | 60 ACI | NNNNN: Toolchain |
|---|---|---|---|
| Nguồn lỗi | Test từ spec | Interface | **Lint/type/build sẵn** |
| Thời điểm | Theo criteria | Cấu trúc agent | **Sau mỗi edit (giây)** |
| Mối quan hệ | Contract | Interface | **Vòng phản hồi kỹ thuật** |

## Khi nào chọn

- Coding task bằng agent (mya có — GG/LLLLL)
- Muốn chất lượng cao mà không tốn LLM detect
- Toolchain sẵn (TS strict — mya có) — chỉ thêm hook
- Đã có RRRR budget + CI — nối loop là ngắn