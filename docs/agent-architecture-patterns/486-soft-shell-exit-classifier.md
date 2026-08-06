# Hướng RR: Soft-Shell-Exit Classifier — exit code 1 + stdout có nội dung = lỗi mềm, trả stdout bình thường

> **Nguồn gốc:** context-mode (`exit-classify.ts`); "classify non-zero exit codes"; "grep exits 1 for no matches — not a real error"; "exit code 1 + stdout has non-whitespace content = soft failure"; "return stdout normally"
> **Coupling:** 🟢 — pure classifier chèn vào tool-result adapter (không can thiệp core)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (bash/exec tool + exit-code handling sẵn — chưa có soft-fail classification)
> **Effort:** 0.5-1 tuần

## Nguồn gốc

**context-mode** gặp vấn đề phân loại exit code shell: lệnh như `grep` **exit 1 khi không match** — đây **không phải lỗi thật**, chỉ "không có kết quả". Nhưng nếu tool trả `exit 1` về agent như **error**, agent tưởng lệnh hỏng → lặp lại / sửa nhầm / hallucinate fix. Giải pháp: **soft-shell-exit classifier** — xử lý exit code 1 là **lỗi mềm (soft failure)** khi thỏa 3 điều kiện: (1) `language = "shell"`; (2) `exitCode === 1` (chính xác 1, không phải 2/130); (3) `stdout` **có nội dung non-whitespace** (grep in ra thứ gì đó / lệnh chạy xong có output). Khi soft → **trả stdout bình thường** (isError=false, agent thấy output bình thường); khi hard (exit ≠1, hoặc exit 1 nhưng stdout rỗng) → **trả error** (isError=true, kèm stdout + stderr đầy đủ). Nguyên tắc: **exit 1 + output = "chạy xong, không match", không phải crash**. Khác **442 progress-drafts** — RR **phân loại exit, không lưu draft**; khác **478 transactional-sandbox** (rollback) — RR **không rollback, chỉ đổi isError**.

## Mô tả

mya soft-shell-exit classifier: (1) **Tool exec**: chạy shell command → nhận `{exitCode, stdout, stderr}`. (2) **Classify**: nếu `language=shell && exitCode===1 && stdout.trim().length > 0` → **soft** (isError=false, output=stdout). (3) **Hard**: còn lại → isError=true, output = `Exit code: N\nstdout:...\nstderr:...`. (4) **Return**: soft → agent thấy output bình thường (không tưởng lỗi); hard → agent thấy error đầy đủ. Kết quả: `grep` exit 1 (no match) → agent hiểu "không match" thay vì "lệnh hỏng" → không sửa nhầm. mya có bash tool + exit-code handling — RR thêm **classifyNonZeroExit** pure function vào tool-result adapter.

## Kiến trúc

```
  SHELL COMMAND chạy xong
  ┌─── exec result ────────────────────────────────────┐
  │  language: "shell"                                  │
  │  exitCode: 1                                        │
  │  stdout: "(empty — grep no match)"   HOẶC  "file.ts"│
  │  stderr: ""                                         │
  └───────────────────────┬────────────────────────────┘
                          ▼
  ┌─── CLASSIFY NON-ZERO EXIT ──────────────────────────┐
  │  isSoftFail =                                        │
  │    language === "shell"      (1) shell-specific      │
  │    && exitCode === 1         (2) chính xác 1         │
  │    && stdout.trim().length>0 (3) stdout có nội dung  │
  │                                                     │
  │  ┌─ SOFT (3 điều kiện) ───────────────────────┐    │
  │  │  isError = false                            │    │
  │  │  output = stdout  (trả bình thường)         │    │
  │  │  → agent thấy "no match" không phải "crash" │    │
  │  └─────────────────────────────────────────────┘    │
  │  ┌─ HARD (còn lại) ───────────────────────────┐    │
  │  │  isError = true                             │    │
  │  │  output = "Exit code: N\nstdout:\n...\n     │    │
  │  │            stderr:\n..."                    │    │
  │  │  → agent thấy error đầy đủ                  │    │
  │  └─────────────────────────────────────────────┘    │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ bash/exec tool (packages/*) — chạy shell + exit-code (nền — RR = classify trong result adapter)
// ✅ tool-result adapter — format result cho agent (nền — RR = soft/hard routing)
// ✅ 442 openclaw-progress-drafts — save draft (đối chiếu — RR = classify exit)
// ✅ 478 transactional-sandbox — batch rollback (đối chiếu — RR = chỉ đổi isError)

// ❌ THIẾU: classifyNonZeroExit (pure function: shell + exit1 + stdout → soft)
// ❌ THIẾU: soft path (isError=false, output=stdout)
// ❌ THIẾU: hard path (isError=true, output=exit+stdout+stderr đầy đủ)
```

## Implementation

```typescript
// packages/agent/src/exit-classify.ts (MỚI)
export interface ExitClassification {
  isError: boolean;
  output: string;
}

// classify non-zero exit codes cho shell exec
// exit code 1 + stdout có nội dung = lỗi mềm (grep no-match), trả stdout bình thường
export function classifyNonZeroExit(params: {
  language: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}): ExitClassification {
  const { language, exitCode, stdout, stderr } = params;
  const isSoftFail =
    language === "shell" &&        // (1) shell-specific
    exitCode === 1 &&              // (2) chính xác 1 (không phải 2/130 SIGINT)
    stdout.trim().length > 0;      // (3) stdout có nội dung non-whitespace

  return {
    isError: !isSoftFail,
    output: isSoftFail
      ? stdout                                      // soft → trả stdout bình thường
      : `Exit code: ${exitCode}\n\nstdout:\n${stdout}\n\nstderr:\n${stderr}`,  // hard → đầy đủ
  };
}

// chèn vào tool-result adapter (sau exec)
function adaptExecResult(result: { language: string; exitCode: number; stdout: string; stderr: string }) {
  if (result.exitCode === 0) return { ok: true, output: result.stdout };     // success
  if (result.exitCode !== 0) {
    const c = classifyNonZeroExit(result);                    // non-zero → classify
    return { ok: !c.isError, output: c.output };
  }
  return { ok: true, output: result.stdout };
}

// Usage:
// grep "foo" file.ts (no match) → exit 1, stdout ""     → HARD (stdout rỗng)
// grep "foo" file.ts (match)    → exit 0                → success
// ls /missing                    → exit 1, stderr "..."  → HARD (exit1 nhưng stderr, stdout rỗng)
// shell "echo hi; false"         → exit 1, stdout "hi"   → SOFT (isError=false, output="hi")
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent không tưởng "no match" là crash (grep exit 1) | ❌ Chỉ áp dụng shell + exit chính xác 1 |
| ✅ Giảm vòng lặp sửa nhầm (agent không "fix" lệnh OK) | ❌ Có thể che lỗi thật (exit 1 + stdout = bug nuốt) |
| ✅ Output đầy đủ khi hard (stdout + stderr) | ❌ Heuristic (exit1+stdout không phải lúc nào cũng mềm) |
| ✅ Pure + testable (3 điều kiện rõ ràng) | ❌ Cẩn thận nuốt stderr (soft chỉ trả stdout, bỏ stderr) |

## Khác các hướng gần

| | 442 Progress-Drafts | 478 Transactional-Sandbox | RR: Soft-Shell-Exit |
|---|---|---|---|
| Cái gì | Lưu draft khi lỗi | Batch rollback | **Phân loại exit 1 mềm/cứng** |
| Khi | Tool fail | Action batch | **Non-zero exit** |
| Hiệu ứng | Save draft | Rollback | **Đổi isError (không rollback)** |

## Khi nào chọn

- Agent hay tưởng shell exit 1 (grep no-match) là crash → sửa nhầm
- Muốn exit 1 + stdout có nội dung → soft (trả output bình thường)
- Cần phân biệt "chạy xong không kết quả" vs "lệnh hỏng"
- Nối bash/exec tool (RR = classify trong result adapter); guard nuốt lỗi thật (soft chỉ khi exit===1 + shell + stdout có nội dung — exit≠1 luôn hard) + stderr handling (soft chỉ trả stdout — nếu cần stderr, vẫn hard) + heuristic tuning (mở rộng điều kiện mềm nếu cần: exit 1 + stderr có nghĩa cũng có thể mềm)
