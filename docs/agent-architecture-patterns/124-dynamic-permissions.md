# Hướng DT: Dynamic Contextual Permissions — quyền tool co giãn theo ngữ cảnh

> **Nguồn gốc:** "Dynamic Capability Scoping for Enterprise AI Agents" (arXiv 2607.22445, 2026); aembit CBAC MCP 2026; oso context-aware
> **Coupling:** 🟡 — policy động, gateway đổi nhẹ
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (OO static sẵn; thiếu policy engine)
> **Effort:** 2 tuần

## Nguồn gốc

Dynamic contextual permissions: **quyền không tĩnh theo role — đánh giá runtime theo context** — arXiv 2607.22445: "capability scoping must follow a **dynamic least-privilege principle**, treated as a prevention mechanism before a detection one"; aembit 2026 (CBAC cho MCP servers): "policies are dynamic, not hardcoded — policy engine processes three dimensions at runtime and adapts to current conditions"; oso: "role-based defines what a user should do, only context-aware permissions ensure guarantees hold **in the moment**"; cerbos/APONO: dynamic authorization — continuous evaluation thay vì static trust. Ba chiều ngữ cảnh (aembit): who (identity), what (action/data), where/when (environment, risk). Khác **OO static permissions** (tool → permission cố định) — UUUUU *thu hẹp/mở rộng theo task*: task nhạy cảm (xóa/ghi quyền) → hẹp hơn; task thường → đủ quyền cần.

## Mô tả

mya policy engine (gateway — trước mỗi tool call, sau triage): (1) **policy input** — user intent, task type (AAAAA tree), data sensitivity (nhãn file/thư mục), risk (tool hạng nặng: delete/exec/write), history (đã approve chưa); (2) **decision** — allow (đủ quyền theo ngữ cảnh) / deny / **narrow** (cho phép với tham số hạn chế — dynamic scoping: đúng phạm vi file/thư mục) / prompt (hỏi user — TT); (3) **narrowing** — v.d. file write tool: task thuộc `/docs/x` → chỉ cho phép ghi `/docs/x/**` (scoping — arXiv prevention-first); (4) **runtime adapt** — data đổi nhạy cảm (thư mục nhạy) → policy hẹp lại ngay (không đợi); (5) **log + học** — deny/narrow ghi trace (QQQQ) → nếu deny nhiều (agent cố vượt — YYYY) → cảnh báo. Nối: OO (base config), KKK (secret proxy), RRR (firewall), TT (approval).

## Kiến trúc

```
  TOOL CALL ──► POLICY ENGINE (runtime — aembit 3 dimensions)
    who (user/intent) · what (action + data sensitivity)
    where/when (task loại AAAAA · risk · history)
        │
  ┌─────┴──────────────────────────────────┐
  ALLOW              NARROW (dynamic scoping)        DENY / PROMPT (TT)
  đủ quyền           ghi /docs/x/** (phạm vi)        hạng nặng → hỏi user
  theo ngữ cảnh      (arXiv: least-privilege prevention)
        │
        ▼
  LOG deny/narrow (QQQQ) — agent cố vượt nhiều → YYYY flag
  DATA đổi nhạy cảm → policy hẹp lại NGAY (runtime adapt — aembit)
```

```
mya: OO permissions static SẸN — thiếu: policy engine + narrow scoping
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools OO — base permission config (nền)
// ✅ gateway — nơi chèn policy engine (trước tool call)
// ✅ TT approval — prompt user khi cần
// ✅ KKK secrets — không chạm (bổ sung dynamic)
// ✅ QQQQ trace — log deny/narrow
// ✅ YYYY anti-hack — agent cố vượt deny
// ✅ AAAAA task tree — task type (policy input)

// ❌ THIẾU: policy engine (3 dimensions runtime)
// ❌ THIẾU: narrow scoping (phạm vi file/dir theo task)
// ❌ THIẾU: runtime adapt (data nhạy cảm → hẹp ngay)
```

## Implementation

```typescript
// packages/gateway/src/cbac.ts (NEW)
type Decision = { verdict: "allow" | "deny" | "narrow" | "prompt"; scope?: Path };

function evaluate(call: ToolCall, ctx: PolicyCtx): Decision {
  const base = permissions[call.tool];                 // OO static nền
  if (!base.allowed) return { verdict: "deny" };
  const sensitivity = dataSensitivity(ctx.task, call.args);  // nhãn dữ liệu
  if (sensitivity === "high") return { verdict: "prompt" };  // TT
  if (base.narrowable) {
    return { verdict: "narrow", scope: scopeOf(ctx.task) }; // /docs/x/**
  }
  return { verdict: "allow" };
}
// dynamic least-privilege: prevention-first (arXiv 2607.22445)
// runtime adapt: data đổi → re-evaluate (aembit "adapts to current conditions")
// deny nhiều → trace (QQQQ) + YYYY flag
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Least-privilege động — hẹp theo task (arXiv 2607.22445) | ❌ Policy engine thêm latency mỗi call (nhẹ) |
| ✅ Prevent trước khi detect (chống leo quyền) | ❐ Nhãn nhạy cảm dữ liệu phải duy trì |
| ✅ Narrow scoping — file write hẹp đúng phạm vi | ❌ Policy phức tạp hơn static OO (kỷ luật) |
| ✅ Runtime adapt — data đổi → hẹp ngay (aembit) | ❌ False deny cản task hợp lệ (tune + TT) |

## Khác các hướng gần

| | OO Static Permissions | RRR Firewall | UUUUU: Dynamic CBAC |
|---|---|---|---|
| Quyết định | Lúc config | Luồng prompt | **Lúc call (runtime)** |
| Chiều | Tool cố định | Content | **who/what/where + scope** |
| Mối quan hệ | Nền tảng | Đối tác | **Mở rộng OO theo ngữ cảnh** |

## Khi nào chọn

- Tool quyền nặng (delete/exec/write) dùng chung nhiều task
- Dữ liệu có độ nhạy khác nhau theo thư mục/task
- Đã có OO + TT + trace — thêm policy engine
- Muốn prevention (không chỉ detect) — arXiv 2607.22445