# Hướng XV: Assumption Surfacing Protocol — spec-driven development 4-phase gated, mọi giả định phải nêu trước khi code (research.md)

> **Nguồn gốc:** agent-skills (spec-driven-development bản Addy Osmani — research.md) | **Coupling:** 🟢 — protocol thuần prompt/process, không đụng runtime | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có session + budget + eval gate — chưa có assumption gate) | **Effort:** 1-2 tuần

## Nguồn gốc

**agent-skills** dạy spec-driven development theo mô hình **4-phase gated**: `Specify → Plan → Tasks → Implement`. Trước khi viết bất kỳ dòng code nào, agent phải viết **research.md** — tài liệu nêu mọi **assumption** (giả định) về yêu cầu, môi trường, API, data shape. Không có assumption nào được phép tồn tại ngầm bên trong code. Mỗi phase có cổng (gate) riêng: không pass gate thì không sang phase kế. Nguyên tắc: **code là nơi cuối cùng chứa giả định — assumption phải nổi lên bề mặt trước**.

## Mô tả

mya áp dụng assumption-surfacing protocol: khi nhận task, agent bắt đầu bằng **Specify phase** — viết `research.md` liệt kê assumption (ví dụ "API trả `{items: []}`", "file < 10MB", "chỉ chạy Linux"). Mỗi assumption có trạng thái: `confirmed` (đã verify bằng tool), `unverified` (cần test lúc Implement). Gate: nếu còn assumption `unverified` quan trọng → không Implement. Khi Implement phát hiện assumption sai → quay lại Specify, cập nhật research.md, đánh dấu assumption đó **invalidated** — tạo audit trail. mya có sẵn session (lưu trace), budget (giới hạn iteration) và eval (gate chất lượng) — XV thêm **assumption manifest** + **phase gate check**.

## Kiến trúc

```
  ┌─ Specify ──► research.md (assumptions[] + status) ──┐
  │   gate A: assumption đủ chi tiết, không mâu thuẫn     │
  ▼                                                     ▼
  ┌─ Plan ────► task list (mỗi task gắn assumption id) ─┐
  │   gate B: mọi task có assumption mapping             │
  ▼                                                     ▼
  ┌─ Tasks ───► implement + test từng slice ────────────┐
  │   gate C: assumption sai → quay Specify (invalidate)│
  ▼                                                     ▼
  ┌─ Implement ► verify + demo ─────────────────────────┐
  │   gate D: không còn assumption unverified critical  │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core session.ts — History/session (nền — XV ghi research.md vào history)
// ✅ packages/core iteration-budget.ts — giới hạn vòng lặp (nền — XV phase gate analog)
// ✅ packages/eval tiers.ts — eval gate (nền — XV gate D verify)
// ✅ packages/core supervised.ts — task wrapper crash-resilient (nền — XV chạy phase)

// ❌ THIẾU: assumption manifest (schema research.md)
// ❌ THIẾU: phase gate check (Specify→Plan→Tasks→Implement)
// ❌ THIẾU: assumption invalidation loop (Implement → quay Specify)
```

## Implementation (TS)

```typescript
// packages/core/src/assumption-gate.ts (MỚI)
export type AssumptionStatus = "confirmed" | "unverified" | "invalidated";

export interface Assumption {
  id: string;                 // "A-01"
  text: string;               // "API trả {items: T[]}"
  status: AssumptionStatus;
  phase: "specify" | "plan" | "tasks" | "implement";
}

export type Phase = Assumption["phase"];

const ORDER: Phase[] = ["specify", "plan", "tasks", "implement"];

export class AssumptionGate {
  private assumptions: Assumption[] = [];

  add(text: string): void {
    this.assumptions.push({ id: `A-${this.assumptions.length + 1}`, text, status: "unverified", phase: "specify" });
  }

  confirm(id: string): void {
    const a = this.assumptions.find((x) => x.id === id);
    if (a) a.status = "confirmed";
  }

  invalidate(id: string): void {
    const a = this.assumptions.find((x) => x.id === id);
    if (a) a.status = "invalidated"; // quay Specify
  }

  canProceed(to: Phase): boolean {
    const idx = ORDER.indexOf(to);
    const blockers = this.assumptions.filter(
      (a) => ORDER.indexOf(a.phase) >= idx && a.status === "unverified" && !a.text.startsWith("cosmetic"),
    );
    return blockers.length === 0;
  }

  report(): string {
    return this.assumptions.map((a) => `${a.id} [${a.status}] ${a.text}`).join("\n");
  }
}

// Usage:
// const gate = new AssumptionGate();
// gate.add("Endpoint trả 200 ngay cả khi empty list");
// gate.add("Chỉ cần hỗ trợ Linux (cosmetic — không block)");
// gate.confirm("A-1");          // verify bằng curl trước Implement
// gate.canProceed("implement"); // false nếu còn A-2 unverified
// gate.invalidate("A-1");       // Implement thấy response khác → quay Specify
```

## Được

- ✅ Assumption nổi bề mặt — code không chứa giả định ngầm
- ✅ Fail sớm — sai assumption bị phát hiện ở gate, không phải lúc debug
- ✅ Audit trail — research.md ghi lại toàn bộ vòng đời assumption
- ✅ Task mapping — mỗi task biết nó phụ thuộc assumption nào
- ✅ Deterministic gate — `canProceed()` trả lời máy được, không cần cảm tính

## Mất

- ❌ Overhead process — 4 phase gate thêm chi phí cho task nhỏ một file
- ❌ Research.md stale — nếu agent không cập nhật, manifest sai lệch thực tế
- ❌ Unverified kéo dài — assumption không verify được (phụ thuộc môi trường ngoài) chặn gate mãi

## Khác các hướng gần

| | Spec-first (viết doc rồi code) | TDD (test trước) | XV: Assumption Gate |
|---|---|---|---|
| Trọng tâm | behavior doc | test fail trước | **giả định + phase gate** |
| Cơ chế | doc review | red-green-refactor | **canProceed() check** |
| Loop-back | doc update | refactor | **invalidate → quay Specify** |

## Khi nào chọn

- Task phức tạp, nhiều giả định về API/môi trường/data shape
- Muốn fail sớm + audit trail thay vì debug muộn
- Có pipeline session/budget/eval sẵn — XV chỉ thêm manifest + gate
- Nối packages/core session.ts (ghi research.md) + iteration-budget.ts (giới hạn phase) + eval tiers.ts (gate verify); guard assumption-drift (manifest vs code thực tế — test), gate-blocking (cosmetic assumption không được chặn — whitelist), và invalidation-loop (Implement phát hiện sai phải quay Specify, không sửa vội); XV = assumption gate, kết hợp 647 XW vertical-slice-incremental (mỗi slice verify assumption riêng) + 648 XX five-axis-code-review (review theo trục correctness/security)
