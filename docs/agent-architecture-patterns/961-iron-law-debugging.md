# Hướng AJY: Iron-Law Debugging — Systematic Debugging có Iron Law "NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST", 4 phases bắt buộc, cấm symptom fixes và guessing

> **Nguồn gốc:** superpowers (skills/systematic-debugging/SKILL.md) | **Coupling:** 🟢 — skill procedure, không đụng core | **Agent-agnostic:** ⚠️ (phụ thuộc model tuân thủ) | **Code sẵn:** ⚠️ (có lsp-cascade + repair; thiếu root-cause procedure) | **Effort:** 1 tuần

## Nguồn gốc

**superpowers** (skills/systematic-debugging/SKILL.md) có **Iron Law**: *"NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST"* — với **4 phases bắt buộc**: (1) **root cause** — tìm nguyên nhân gốc trước (không sửa khi chưa biết vì sao); (2) **reproduce consistently** — tái hiện lỗi ổn định (sửa mà không reproduce được thì không biết sửa đúng chưa); (3) **recent changes** — kiểm tra thay đổi gần đây (lỗi thường đến từ change mới); (4) **fix** — sửa sau khi đủ 3 bước trên. **Cấm symptom fixes** (sửa triệu chứng — lỗi quay lại) và **cấm guessing dưới áp lực thời gian** (đoán mò khi deadline gấp — càng tệ).

Giá trị: (1) **fix đúng gốc** — symptom fix chỉ giấu lỗi, root-cause fix hết hẳn; (2) **reproduce = bằng chứng** — biết chắc lỗi được sửa (chạy lại reproduction → hết); (3) **ngăn panic-guessing** — áp lực thời gian là lúc dễ guess nhất — Iron Law cấm đúng lúc đó; (4) **discipline thành skill** — 4 phases là procedure, không phải lời khuyên.

## Mô tả

Với mya, pattern = **root-cause-first debugging procedure**: (1) **skill body** — Systematic Debugging skill: Iron Law ở đầu, 4 phases bắt buộc theo thứ tự, không được nhảy thẳng tới fix; (2) **phase gates** — mỗi phase có output phải đạt: root cause (viết nguyên nhân thành câu), reproduce (ghi lệnh + output lỗi ổn định), recent changes (liệt kê diff gần đây), fix (sửa + chạy lại reproduction); (3) **nối tooling** — mya có `packages/tools/src/lsp-cascade.ts` (runCascade + diagnostics — nguồn thông tin lỗi), `repair.ts` (sửa lỗi argument thường gặp — nhưng không thay root cause), `hashline-edit.ts` (edit an toàn) — skill hướng dẫn dùng đúng thứ tự; (4) **anti-guess guard** — khi fail: skill yêu cầu quay lại phase 1 (root cause) thay vì thử fix khác; (5) nơi gắn — `packages/skills` (skill body) + eval case kiểm tra agent theo đúng 4 phases. Đây là pattern **procedure-enforced debugging discipline**: không tin model "biết cách debug", mà ép procedure qua skill + gate.

## Kiến trúc (ASCII)

```
  BUG BÁO CÁO
    │
    ▼ IRON LAW: NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
  ├─ PHASE 1: ROOT CAUSE ──► viết nguyên nhân gốc thành câu
  │      (không được nhảy tới fix)
  ├─ PHASE 2: REPRODUCE ──► lệnh + output lỗi lặp lại ổn định
  ├─ PHASE 3: RECENT CHANGES ──► diff/commit gần đây liên quan
  └─ PHASE 4: FIX ──► sửa đúng gốc → CHẠY LẠI REPRODUCTION
       │
       ├─ lỗi hết ──► xong
       └─ lỗi còn ──► QUAY LẠI PHASE 1 (cấm guess fix khác)
  CẤM: symptom fixes · guessing dưới áp lực thời gian
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools/src/lsp-cascade.ts — runCascade + diagnostics (nguồn thông tin lỗi)
// ✅ packages/tools/src/repair.ts — arg repair (nền — sửa lỗi quen thuộc)
// ✅ packages/tools/src/hashline-edit.ts — hash-anchored edit (nền — fix an toàn)
// ✅ packages/tools/src/codeexec.ts — code-exec bridge (nền — chạy reproduction)
// ✅ packages/skills/src/skill.ts — Skill body (nơi chứa systematic-debugging skill)

// ❌ THIẾU: Iron Law procedure skill (4 phases bắt buộc, thứ tự cứng)
// ❌ THIẾU: phase gates (output mỗi phase phải đạt trước khi qua)
// ❌ THIẾU: anti-guess guard (fail → quay lại phase 1, không thử fix khác)
```

## Implementation

```typescript
// packages/skills/src/debug-phases.ts (NEW)
export type DebugPhase = "root-cause" | "reproduce" | "recent-changes" | "fix" | "done";

export interface DebugState {
  phase: DebugPhase;
  rootCause: string;          // phase 1 — nguyên nhân gốc thành câu
  reproduce: string;          // phase 2 — lệnh + output ổn định
  recentChanges: string[];    // phase 3 — diff/commit gần đây
  fixAttempts: number;
}

/** Phase gate — không được qua phase khi output chưa đạt. */
export function canAdvance(state: DebugState): { ok: boolean; reason: string } {
  switch (state.phase) {
    case "root-cause":
      return state.rootCause.trim().length > 0
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Iron Law: viết root cause thành câu trước khi qua" };
    case "reproduce":
      return state.reproduce.trim().length > 0
        ? { ok: true, reason: "" }
        : { ok: false, reason: "phải reproduce ổn định trước khi fix — không thì không biết sửa đúng chưa" };
    case "recent-changes":
      return { ok: true, reason: "" };   // luôn cho qua — nhưng phải liệt kê
    default:
      return { ok: true, reason: "" };
  }
}

/** Iron Law: cấm fix khi chưa hoàn thành phase 1-3. */
export function assertNoPrematureFix(state: DebugState): boolean {
  return state.phase === "fix" || state.phase === "done"
    ? state.rootCause.trim().length > 0 && state.reproduce.trim().length > 0
    : false;
}

/** Anti-guess guard — fix fail → quay lại phase 1, không thử fix khác. */
export function onFixFailed(state: DebugState): DebugState {
  return { ...state, fixAttempts: state.fixAttempts + 1, phase: "root-cause" };
}

/** Mỗi phase có output bắt buộc — procedure, không phải lời khuyên. */
export function phaseOutputs(state: DebugState): Record<DebugPhase, string> {
  return {
    "root-cause": state.rootCause,
    reproduce: state.reproduce,
    "recent-changes": state.recentChanges.join("\n"),
    fix: `fix attempt #${state.fixAttempts}`,
    done: "reproduction đã chạy lại và hết lỗi",
  };
}
// Nối lsp-cascade: phase 1-2 lấy diagnostics từ runCascade — dữ liệu thật, không guess
// Nối eval: case kiểm tra agent theo đúng thứ tự 4 phases (AJV-style corpus)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Fix đúng gốc — symptom fix không giấu được lỗi | ❌ 4 phases tốn thời gian cho bug đơn giản |
| ✅ Reproduce = bằng chứng sửa đúng | ❌ Bug không reproduce ổn định (flaky) — kẹt phase 2 |
| ✅ Chống panic-guessing — áp lực thời gian vẫn theo procedure | ❌ Model có thể bỏ qua skill — cần eval (AJV) |
| ✅ Discipline thành skill — không phụ thuộc "model giỏi debug" | ❌ Recent-changes yêu cầu git history tốt |

## Khác các hướng gần

| | AJY Iron-Law Debugging | 321 Flaky Test Stabilization | 109 Simulated User Testing |
|---|---|---|---|
| Trọng tâm | Root cause trước fix | Ổn định test flaky | Test agent bằng user giả |
| Cơ chế | 4 phases + gate | Retry + quarantine | Mô phỏng hành vi user |
| Quan hệ | Quy trình debug | Trường hợp khó reproduce | Kiểm tra agent nói chung |

## Khi nào chọn

- Agent hay sửa symptom / đoán mò khi gặp bug — cần discipline
- Bug phức tạp, tái diễn — root-cause + reproduce là bắt buộc
- Muốn debug thành procedure có gate — không tin "model tự biết"
- Guard: Iron Law ở đầu skill, 4 phases bắt buộc, fail quay lại phase 1, cấm guessing