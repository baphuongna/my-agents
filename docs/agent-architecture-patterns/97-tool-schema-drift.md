# Hướng TTTT: Tool Schema Drift — bắt MCP server đổi schema khiến agent gọi sai

> **Nguồn gốc:** "MCP Tools Broke Silently — Schema Drift is the New Dependency Hell" (dev.to 2026); fixzi taxonomy 2026; microsoft/agent-framework #4725
> **Coupling:** 🟢 — tầng gateway, agent không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (mcp-client sẵn; thiếu drift detection)
> **Effort:** 1-2 tuần

## Nguồn gốc

Tool schema drift: **MCP server update → tool schema đổi → agent gọi sai âm thầm** (không crash, chỉ sai output). dev.to 2026: "description changes are breaking changes — they alter the model's probability of selecting and correctly invoking the tool"; reddit r/mcp 2026: "server updates, description reworded, agent's behaviour changes with nothing in pipeline registering it"; fixzi: taxonomy đổi schema theo severity (add optional field = minor; đổi type/bỏ field = breaking); microsoft/agent-framework #4725: đề xuất **"stable fail-closed markers"** cho remote MCP schema drift — fail-closed thay vì gọi sai. Vì agent chọn/sinh args dựa trên schema (name, description, params) — schema là *API contract*; drift âm thầm = dependency hell của thời agent. Khác **RRRR recovery** (sửa sau khi fail) — TTTT *phát hiện trước* khi gọi sai; khác **IQ reliability** (timeout/retry) — TTTT là *đối chiếu hợp đồng*.

## Mô tả

mya gateway: (1) **schema baseline** — lưu schema mỗi tool lúc nạp (hash + phiên bản server); (2) **reload detect** — mỗi lần connect lại, lấy schema mới → **diff chuẩn hóa**: breaking (bỏ field, đổi type, đổi enum, đổi param bắt buộc) → **fail-closed**: không cho agent gọi tool đó nữa, báo triage (CCC) + update spec (HHHH); minor (thêm field optional, đổi description) → cập nhật + trace; (3) **warning** — tool dùng nhiều mà description đổi (ảnh hưởng chọn lựa — dev.to) → đánh dấu cần re-eval; (4) **CI check** (SSSS) — chạy contract test khi server version đổi (UUUU mock). Nối: RRRR (sửa) chạy sau TTTT (chặn).

## Kiến trúc

```
  MCP SERVER ──► CONNECT ──► LẤY SCHEMA ──► SO SÁNH BASELINE
        │
  ┌─────┴────────────────────────────────────────┐
  BREAKING (bỏ field/đổi type/enum)        MINOR (thêm optional/description)
  ──► FAIL-CLOSED: chặn tool              ──► cập nhật schema + trace (QQQQ)
  ──► báo triage (CCC) + update HHHH spec ──► cảnh báo: tool hot mà desc đổi
        │                                        │
        └──────────────► SSSS CI: contract test khi server version đổi
                                        (UUUU mock — không đợi vỡ production)
```

```
mya: mcp-client SẴN (nạp schema) — thiếu: baseline + diff + fail-closed
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ gateway/mcp-client.ts — lấy tool list/schema (nơi thêm baseline)
// ✅ gateway/mcp-lifecycle.ts — connect lifecycle (nơi trigger re-detect)
// ✅ RRRR recovery — sửa sau khi fail (tầng sau TTTT)
// ✅ QQQQ trace — ghi tool behavior (phát hiện âm thầm)
// ✅ HHHH spec — cập nhật khi tool đổi
// ✅ SSSS CI — gate (chạy contract test)

// ❌ THIẾU: schema baseline + hash/version lưu trữ
// ❌ THIẾU: diff classifier (breaking/minor)
// ❌ THIẾU: fail-closed policy (chặn tool khi breaking)
```

## Implementation

```typescript
// packages/gateway/src/schema-drift.ts (NEW)
type Drift = { severity: "breaking" | "minor"; detail: Diff[] };

function detectDrift(baseline: ToolSchema, current: ToolSchema): Drift {
  const removed = baseline.params.filter((p) => !current.params.has(p.name));
  const changed = paramsChangedType(baseline, current);
  const descChanged = baseline.description !== current.description;
  return {
    severity: removed.length || changed.length ? "breaking" : "minor",
    detail: [...removed.map(breaking), ...(descChanged ? [descNote] : [])],
  };
}

function applyDrift(policy: DriftPolicy, drift: Drift, tool: ToolId): ToolState {
  if (drift.severity === "breaking" && policy.failClosed)
    return "disabled";                    // chặn tool — không gọi sai (msft #4725)
  updateBaseline(tool, currentSchema);    // minor: cập nhật
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chặn gọi sai âm thầm (dependency hell hết) | ❐ Baseline phải lưu từ đầu (đợi tích lũy) |
| ✅ Fail-closed: không sinh args trên schema cũ | ❌ Diff tự động có thể nhầm (validation thủ công) |
| ✅ Description đổi cũng bắt (chọn tool sai — dev.to) | ❌ Breaking → tool tắt bất ngờ (phải có luồng báo) |
| ✅ Nối RRRR (sửa) + UUUU (mock test) + SSSS (CI) | ❌ Schema server lỏng lẻo — diff nhiễu |

## Khác các hướng gần

| | IQ Reliability | RRRR Recovery | TTTT: Drift |
|---|---|---|---|
| Vấn đề | Tool trả lỗi | Tool fail khi gọi | **Schema đổi trước khi gọi** |
| Thời điểm | Lúc gọi | Sau fail | **Lúc reload/nạp** |
| Hành động | Retry | Sửa params | **Fail-closed + update** |
| Mối quan hệ | Tầng dưới | Sau TTTT | **Phòng bệnh trước** |

## Khi nào chọn

- Dùng nhiều MCP server bên ngoài (hay update)
- Tool gọi sai âm thầm khó phát hiện
- Đã có mcp-client + lifecycle — thêm baseline layer
- Muốn fail-closed thay vì để agent "đoán" (11 checks — duckweave)