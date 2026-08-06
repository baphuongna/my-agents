# Hướng ADH: Acceptance Criteria Before Execution — bắt buộc define pass/fail trước khi launch execution lanes

> **Nguồn gốc:** oh-my-codex (ultrawork skill) | **Coupling:** 🟢 — gate thuần convention trước execution loop | **Agent-agnostic:** ✅ — không phụ thuộc model/tool cụ thể | **Code sẵn:** ⚠️ (sẵn convention + eval; thiếu gate bắt buộc) | **Effort:** 1 tuần

## Nguồn gốc

**Ultrawork** skill của **oh-my-codex** quy định: TRƯỚC khi launch execution lanes, agent phải define **pass/fail acceptance criteria** — một trong ba loại: (1) **command** — chạy lệnh X trả kết quả đúng, (2) **artifact** — file/đầu ra tồn tại với nội dung đúng, (3) **manual check** — human xác nhận điểm cụ thể. Criterion phải "chứng minh được success" chứ không phải mô tả mơ hồ.

Kèm theo là policy chọn phương thức: **prefer direct tool work** cho task nhỏ/coupled (không tốn chi phí orchestration), **delegate** (subagent/team) chỉ khi task đủ independent để hưởng lợi từ parallel. Nghĩa là gate không chỉ định nghĩa "thế nào là xong" mà còn định nghĩa "ai làm, làm thế nào".

## Mô tả

Với mya, pattern này gắn vào **đầu vòng lặp agent**: trước `runTurn`, phase "plan" phải emit một **acceptance criteria object** (typed discriminated union: command/artifact/manual) và lưu vào session state. Khi agent tuyên bố xong, hệ thống **verify** từng criterion — chạy command, kiểm artifact, hoặc mở approval cho manual — rồi mới đóng turn. `packages/eval` đã có ParityHarness/IntegrationTier cho test suite; pattern này mở rộng sang **per-task acceptance** trong runtime, không chỉ per-release.

## Kiến trúc (ASCII)

```
  TASK ──► PLAN PHASE
            │  define pass/fail TRƯỚC khi làm
            ▼
  ACCEPTANCE CRITERIA (typed union)
    ├─ { type: "command", cmd, expectExit, expectOutput? }
    ├─ { type: "artifact", path, predicate? }
    └─ { type: "manual", question, reviewer }
            │
            ▼
  CHỌN LANE: task nhỏ/coupled → direct tool work
             task independent → delegate (subagent/team)
            │
            ▼
  EXECUTION → tuyên bố done
            │
            ▼
  VERIFY từng criterion → đủ pass mới đóng turn
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/eval — ParityHarness + IntegrationTier + CredentialedTier
//   (verify theo scenario — nền per-task acceptance)
// ✅ packages/core — TurnHandle + TurnTerminal (nơi chèn verify gate)
// ✅ packages/tools — runToolBatch + approval.ts (chạy command/artifact check)
// ✅ packages/agent — spawnSubagent (lane delegate đã có)
// ✅ packages/audit — AuditLog (ghi kết quả verify)

// ❌ THIẾU: acceptance criteria typed union trong session state
// ❌ THIẾU: verify gate bắt buộc trước khi đóng turn
// ❌ THIẾU: lane chooser (direct vs delegate theo độ coupled)
```

## Implementation

```typescript
// packages/core/src/acceptance.ts (NEW)
export type AcceptanceCriterion =
  | { type: "command"; cmd: string; expectExit: number; expectOutput?: RegExp }
  | { type: "artifact"; path: string; predicate?: (content: string) => boolean }
  | { type: "manual"; question: string; reviewer: string };

export async function verifyAcceptance(
  criteria: AcceptanceCriterion[],
  tools: ToolExecutor,
): Promise<{ ok: boolean; results: string[] }> {
  const results: string[] = [];
  for (const c of criteria) {
    switch (c.type) {
      case "command": {
        const r = await tools.run("bash", { cmd: c.cmd });
        const ok = r.exitCode === c.expectExit &&
          (!c.expectOutput || c.expectOutput.test(r.stdout));
        results.push(`command ${c.cmd}: ${ok ? "PASS" : "FAIL"}`);
        break;
      }
      case "artifact": {
        const ok = existsSync(c.path) &&
          (!c.predicate || c.predicate(readFileSync(c.path, "utf8")));
        results.push(`artifact ${c.path}: ${ok ? "PASS" : "FAIL"}`);
        break;
      }
      case "manual": {
        results.push(`manual: ${c.question} (reviewer: ${c.reviewer})`);
      }
    }
  }
  return { ok: results.every((r) => r.includes("PASS") || r.includes("manual")), results };
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ "Xong" được chứng minh, không tuyên bố suông | ❌ Viết criterion tốn thời gian cho task nhỏ |
| ✅ Detect sớm agent lạc hướng (verify fail) | ❌ Criterion sai → verify sai, mất giá trị |
| ✅ Lane chooser giảm chi phí orchestration | ❌ Manual check cần reviewer — chặn turn |
| ✅ Tái dùng được cho cả subagent (delegate) | ❌ Command criterion có side effect |

## Khác các hướng gần

| | ADH Acceptance Criteria | ADN Story Verify | AEC Apply Log |
|---|---|---|---|
| Điểm áp dụng | Trước execution | Trong story lifecycle | Sau mỗi thay đổi |
| Loại bằng chứng | Command/artifact/manual | verify_command + result | Bảng # + Verified |
| Mục đích | Gate trước khi chạy | Tái verify khi cần | Audit trail từng dòng |

## Khi nào chọn

- Task có output định lượng được (test, build, artifact)
- Muốn chống "agent tuyên bố xong nhưng chưa xong"
- Đã có eval harness — mở rộng gate xuống runtime
- Cần policy rõ: task nào direct, task nào delegate