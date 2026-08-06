# Hướng MMMMM: Spec→Test→Code Loop — exec contract: sinh test từ spec trước khi code

> **Nguồn gốc:** GitHub Spec-Kit (2025); arXiv 2602.00180 SDD; "TDD becomes more powerful with agentic coding" (Spec-Kit discussion)
> **Coupling:** 🟢 — quy trình xây dựng, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (vitest/eval sẵn; thiếu sinh-test pipeline)
> **Effort:** 1 tuần

## Nguồn gốc

Spec→Test→Code: **không chờ code mới viết test** — từ spec sinh test (qua acceptance criteria) trước, chạy (đỏ), rồi agent viết code làm test xanh. GitHub Spec-Kit (2025): spec (contract) → "tests become executable assertions from spec"; arXiv 2602.00180: code từ spec — validate bằng test sinh từ spec; cộng đồng Spec-Kit: "TDD becomes even more powerful with agentic coding". Khác **KKKKK SDD** (định nghĩa spec là nguồn thật — cấu trúc + verify) — MMMMM *là chuỗi vận hành* (spec → test → code → verify → criteria); khác **TDD thuần** (con người viết test trước) — MMMMM *agent sinh test từ spec* + agent code. Chống: (1) agent "đảo ngược" (viết regexp khớp hàm mong muốn — cần criteria thật ở 53/YYYY); (2) test trống (fake pass — YYYY Verify-artifact).

## Mô tả

mya coding loop: (1) **test-gen** — agent A đọc spec (KKKKK criteria) → sinh test mapping từng criterion (vitest) — *trước khi có code*; (2) **red** — chạy tests → đỏ (xác nhận test có ý nghĩa, không pass trống); (3) **driver** — agent khác viết code tối thiểu làm tests xanh (LLLLL driver); (4) **criteria verify** — mỗi criterion ↔ test pass thật (53/YYYY — chống fake/trimmed tests); (5) **refactor/clean** — CCC/LLLLL dọn, chạy lại (SSSS regress); (6) **commit gate** — SSSS gate check criteria 100% + không test bỏ qua. Đây là "pha kế tiếp" của SDD+Pair: ổn định deterministic (tests là contract chạy được — CI không cần LLM mỗi lần).

## Kiến trúc

```
  SPEC (KKKKK — goal/criteria/edges)
        │
        ▼
  (1) TEST-GEN (agent đọc spec → vitest theo từng criterion)
        │
        ▼
  (2) RED (chạy — đỏ: test CÓ Ý NGHĨA, không pass trống)
        │
        ▼
  (3) DRIVER (agent viết code tối thiểu — LLLLL driver role)
        │
        ▼
  (4) CRITERIA VERIFY (53 · YYYY — pass THẬT, không fake/trim)
         ├─ fail ──► quay lại (3) (RRRR budget)
         └─ pass ──► (5) REFACTOR + chạy lại (SSSS regress)
        │
        ▼
(6) COMMIT GATE: criteria 100% + không skip test ──► merge
  về sau: tests = contract chạy được — CI ổn định không cần LLM mỗi lần
```

```
mya: vitest + eval + CI SẸN — thiếu: test-gen từ spec + red-gate
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ KKKKK spec — criteria (nguồn sinh test)
// ✅ vitest runner + 53 report — chạy + báo
// ✅ YYYY anti-hack — pass thật (không fake/trim)
// ✅ LLLLL driver role — code tối thiểu
// ✅ SSSS CI gate — criteria 100% khi commit
// ✅ XXXX/FFFFFFFF — biết tool nào (workspace) để sinh test

// ❌ THIẾU: test-gen agent (spec → vitest mapping)
// ❌ THIẾU: RED gate (test phải đỏ — chống test vô nghĩa)
// ❌ THIẾU: criteria↔test registry (53 mapping)
```

## Implementation

```typescript
// packages/spec/src/test-gen.ts (NEW)
function genTests(spec: Spec): Vitest[] {
  // agent đọc criteria → vitest file (per criterion)
  return spec.criteria.map((c) => testFor(c, spec));  // KKKKK mapping
}

function redGate(tests: Vitest[], before: Code): boolean {
  // test phải ĐỎ trước khi code: có ý nghĩa, không pass rỗng
  return every(tests, (t) => !t.pass(before));
}

// loop: test-gen → RED confirmed → driver (LLLLL) → verify criteria (53/YYYY)
// spec đổi → tái sinh tests phần liên quan + re-run (SSSS)
// sau: tests là contract deterministic — CI không cần LLM mỗi lần
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Contract chạy được — CI deterministic (SSSS rẻ) | ❌ Test-gen đòi spec có criteria machine-checkable |
| ✅ RED gate — chống test "pass trống" vô nghĩa | ❐ Triplet (spec/test/code) phải đồng bộ (VV) |
| ✅ TDD mạnh hơn với agent (GitHub 2025) | ❌ Sinh test thiếu edge → lỗ hổng (spec phải đủ) |
| ✅ Kết hợp SDD + Pair thành vòng kín | ❌ Overhead cho task nhỏ (chọn mức cần) |

## Khác các hướng gần

| | KKKKK SDD | 7 TDD | MMMMM: Loop |
|---|---|---|---|
| Cấp độ | Spec làm nguồn | Test trước | **Chuỗi spec→test→code** |
| Sinh bởi | Con người/LLM | Con người | **Agent (test-gen)** |
| Mối quan hệ | Nền | Thành phần | **Vận hành ổn định cả 2** |

## Khi nào chọn

- Coding task có contract rõ (criteria đo được)
- Muốn CI deterministic (bớt phụ thuộc LLM khi chạy lại)
- Đã có spec + vitest + pair loop — thêm test-gen + red gate
- Sẵn sàng kỷ luật criteria↔test registry