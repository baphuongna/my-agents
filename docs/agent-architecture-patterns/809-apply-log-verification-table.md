# Hướng AEC: Apply Log Verification Table — audit trail từng dòng cho mọi thay đổi

> **Nguồn gốc:** pi-crew-self-distill | **Coupling:** 🟢 — bảng log ngoài runtime | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn audit; thiếu APPLY-LOG generator) | **Effort:** 1 tuần

## Nguồn gốc

**pi-crew-self-distill** ghi mọi **pattern migration** vào **APPLY-LOG.md** dạng bảng: `# | Target file:line | Change | Verified` — từng thay đổi một dòng, kèm **bằng chứng verify**: `tsc clean` + `test:critical 97/97`. Đây là **audit trail từng dòng** — biết chính xác file nào, dòng nào, đổi gì, và có được kiểm chứng không.

Giá trị: (1) **tái kiểm** — bất kỳ lúc nào cũng đối chiếu code với log; (2) **rollback** — biết dòng nào đổi để revert; (3) **bằng chứng** — "97/97 tests pass" là con số, không phải lời khẳng định. Pattern kết nối trực tiếp với ADH (acceptance criteria — verify là criterion) và ADJ (ladder — APPLY-LOG là criteria inspectable).

## Mô tả

Với mya, APPLY-LOG là **convention + generator**: mỗi khi agent (hoặc migration tool) sửa code, ghi một hàng `| file:line | change | verified?` vào APPLY-LOG.md. `packages/tools` hashline-edit đã có verify cơ chế edit; `packages/eval` chạy `tsc` + test:critical; `packages/audit` AuditLog ghi runtime events — nhưng **APPLY-LOG là bảng human-readable** cho migration/review, khác audit log runtime. Có thể sinh tự động: hook sau mỗi edit (nối core ToolHookSink) ghi hàng, sau đó verify gate điền cột Verified. Gap: chưa có generator + convention file.

## Kiến trúc (ASCII)

```
  MIGRATION / EDIT (agent sửa code)
    │
    ▼ APPLY-LOG GENERATOR (hook sau edit — nối ToolHookSink)
  APPLY-LOG.md — bảng
    # | Target file:line | Change            | Verified
    ---|------------------|------------------|----------
    1  | src/core/a.ts:12 | đổi signature    | tsc clean
    2  | src/core/b.ts:40 | thêm guard       | tsc clean
    3  | test/c.test.ts:5 | sửa expectation  | test:critical 97/97
            │
            ▼
  VERIFY GATE (eval: tsc + test:critical) điền cột Verified
  → audit trail từng dòng — tái kiểm/rollback/bằng chứng
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/core — ToolHookSink (hook sau mỗi tool call — nơi ghi hàng)
// ✅ packages/eval — tiers + typecheck script (scripts/typecheck.mjs — nền Verified cột)
// ✅ packages/audit — AuditLog (runtime events — bổ sung cho bảng)
// ✅ packages/tools/src/hashline-edit.ts — edit có verify (migration chính)
// ✅ packages/print — render bảng markdown

// ❌ THIẾU: APPLY-LOG convention + generator (hook → hàng bảng)
// ❌ THIẾU: verify gate tự điền cột Verified (tsc + test:critical)
// ❌ THIẾU: đối chiếu code ↔ log (re-check migration)
```

## Implementation

```typescript
// packages/tools/src/apply-log.ts (NEW)
export interface ApplyRow {
  seq: number;
  target: string;      // file:line
  change: string;
  verified: string;    // "tsc clean" | "test:critical 97/97" | "—"
}

export class ApplyLog {
  constructor(private file = "APPLY-LOG.md") {}

  append(row: Omit<ApplyRow, "seq">): void {
    const seq = this.nextSeq();
    appendFileSync(this.file,
      `| ${seq} | ${row.target} | ${row.change} | ${row.verified} |\n`);
  }

  // hook sau edit (nối core ToolHookSink): mỗi thay đổi → 1 hàng
  attach(sink: ToolHookSink, verify: VerifyRunner): void {
    sink.on("tool", (e) => {
      if (e.tool === "hashline-edit" && e.ok) {
        const v = verify.quick();   // tsc clean?
        this.append({
          target: `${e.path}:${e.line}`,
          change: truncate(e.change, 40),
          verified: v.ok ? "tsc clean" : "FAIL",
        });
      }
    });
  }

  verifyAll(): { ok: boolean; rows: ApplyRow[] } {
    const rows = parseTable(readFileSync(this.file, "utf8"));
    // chạy lại tsc + test:critical cho toàn bộ (nối eval tiers)
    const tsc = runSync("npx tsc --noEmit");
    const critical = runSync("npx vitest run --testTimeout=5000 test:critical");
    return {
      ok: tsc.exitCode === 0 && critical.exitCode === 0,
      rows: rows.map((r) => ({ ...r, verified: tsc.exitCode === 0 ? "tsc clean" : "FAIL" })),
    };
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Audit từng dòng — biết chính xác đổi gì | ❌ Log phải cập nhật đều — dễ quên hàng |
| ✅ Bằng chứng verify (tsc + test:critical) | ❌ file:line stale khi code dịch chuyển |
| ✅ Rollback/review nhanh | ❌ Hàng quá chi tiết → log dài |
| ✅ Nối ADJ (criteria inspectable) | ❌ Verify lại toàn bộ tốn thời gian |

## Khác các hướng gần

| | AEC Apply Log | ADK Trace | ADN Story Verify |
|---|---|---|---|
| Đơn vị | Dòng thay đổi | Hành trình turn | Story |
| Verify | tsc + test:critical | score-trace | verify_command |
| Mục đích | Audit migration | Debug + friction | Vận hành story |

## Khi nào chọn

- Migration lớn cần audit từng dòng + rollback được
- Muốn bằng chứng verify gắn liền mỗi thay đổi
- Đã có hashline-edit + eval — thêm generator + verifyAll
- Team review migration bằng bảng đối chiếu