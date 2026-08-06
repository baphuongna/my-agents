# Hướng BP: Subsumption Architecture — hành vi ưu tiên, không planner trung tâm

> **Nguồn gốc:** Brooks, 1986 "A Robust Layered Control System for a Mobile Robot" (MIT)
> **Coupling:** 🟢 — mỗi lớp hành vi độc lập, chỉ chung 1 bus ưu tiên
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (roles + tier routing sẵn; thiếu priority arbitration)
> **Effort:** 1-2 tuần

## Nguồn gốc

Subsumption (Brooks 1986) — nền tảng robotics: thay vì planner trung tâm suy nghĩ rồi hành động, **nhiều lớp hành vi** (behavior layers) chạy song song, mỗi lớp có ưu tiên, **lớp ưu tiên cao hơn đè (subsume) lớp thấp hơn khi xung đột**. Không cần biểu diễn thế giới đầy đủ, không planning — phản ứng theo ưu tiên. Ví dụ robot: tránh vật cản (cao) > về đích (thấp). Với LLM agents 2025+: ý tưởng quay lại — thay vì 1 agent tự quyết mọi thứ, có **lớp hành vi theo ưu tiên**: an toàn (huỷ task nguy hiểm) > đúng scope (không làm việc ngoài lệnh) > hoàn thành (làm xong task) > hiệu quả (làm nhanh). Khác EE Behavior Tree (cây điều kiện rẽ nhánh có node kiểm soát) — subsumption là *mức ưu tiên tuyệt đối* trên cùng dữ liệu; khác GG Supervisor (giám sát lỗi) — subsumption chọn *hành vi* đúng.

## Mô tả

mya tổ chức hành vi thành **lớp ưu tiên** (không phải planner gom hết): 1) **safety layer** — nhìn mọi output/tool call, hủy nếu nguy hiểm (lệnh xóa dữ liệu, chạy tiền, gửi ngoài); 2) **policy layer** — chặn việc ngoài phạm vi (OO roles, SS budget); 3) **task layer** — thực thi task chính (agent loop); 4) **quality layer** — sau khi xong, review (PP/JJ). Khi xung đột (quality muốn sửa thêm nhưng budget hết): lớp cao (policy/SS) subsume. Mỗi lớp là 1 module độc lập — **thêm lớp không sửa lớp khác** (đặc điểm chính của subsumption). Có thể cài qua tool-call interceptor + response validator.

## Kiến trúc

```
      input ──► LAYER STACK (ưu tiên giảm dần, chạy song song)
      │
      ▼
  L1 SAFETY (cao nhất)   — huỷ: lệnh nguy hiểm (rm -rf, tiền, external send)
      │
  L2 POLICY (OO/SS)      — chặn: tool ngoài scope, vượt budget
      │
  L3 TASK                — agent loop chính (chạy task, spawn subagent)
      │
  L4 QUALITY (PP)        — review output sau cùng (không cản execution giữa chừng)
      │
  output ──► (lớp cao subsume khi xung đột)

  Thêm hành vi mới = thêm 1 lớp, không đụng các lớp còn lại
```

```
mya: OO roles (policy) + SS (budget) + PP (quality) đã là "lớp" rải rác
     thiếu: arbitration rõ ràng + safety layer (lớp cao nhất) + interceptor bus
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ OO roles — lớp policy (chặn tool ngoài scope)
// ✅ SS rate-limiter — lớp budget (chặn vượt trần)
// ✅ PP eval — lớp quality (review kết quả)
// ✅ packages/print/src/mya-bridge.ts — registerTool (nơi cài interceptor)
// ✅ 20-immune-system — cơ chế phát hiện tấn công (họ safety)

// ❌ THIẾU: safety layer cấp cao nhất (huỷ lệnh nguy hiểm trước khi chạy)
// ❌ THIẾU: arbitration bus — xung đột giữa lớp giải quyết theo ưu tiên (không tùy biến)
// ❌ THIẾU: tách lớp thành module độc lập (hiện logic lồng trong agent loop)
```

## Implementation

```typescript
// packages/core/src/subsumption.ts (NEW)
interface Layer {
  priority: number;                     // cao = subsume
  examine(ctx: ActionContext): Decision;   // allow | deny | override
}

// ví dụ L1 safety — subsume mọi lớp khác
const safetyLayer: Layer = {
  priority: 100,
  examine: ({ action }) => isDangerous(action) ? { deny: "E_DANGEROUS" } : { allow: true },
};

// agent loop: mọi tool call đi qua bus → lớp cao thắng
function arbitrate(ctx: ActionContext, layers: Layer[]): Decision {
  return [...layers].sort((a, b) => b.priority - a.priority)
    .map((l) => l.examine(ctx))
    .find((d) => d.deny || d.override) ?? { allow: true };
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ An toàn đặt ở lớp cao nhất — không phụ thuộc agent "nhớ" | ❌ Xung đột tinh tế giữa lớp cần ưu tiên hợp lý |
| ✅ Thêm hành vi = thêm lớp (không đụng agent loop) | ❌ Lớp quá thô → chặn nhầm việc hợp lệ |
| ✅ Không cần planner trung tâm — phản ứng theo ưu tiên | ❌ Quyết định dài hạn (goal) không phải thế mạnh |
| ✅ OO/SS/PP đã là lớp — chỉ cần arbitration | ❌ Debug: hành vi bị lớp nào subsume phải rõ |
| ✅ Kiến trúc proven 40 năm (robot) | |

## Khác các hướng gần

| | EE Behavior Tree | GG Supervisor | QQQ: Subsumption |
|---|---|---|---|
| Cơ chế | Điều kiện rẽ nhánh | Giám sát crash | **Ưu tiên tuyệt đối** |
| Ai quyết | Node cha | Supervisor | Lớp cao nhất |
| Thêm hành vi | Sửa cây | Thêm worker | **Thêm lớp độc lập** |
| Mục đích | Điều khiển | Độ tin cậy | An toàn + chính sách |

## Khi nào chọn

- Muốn an toàn không phụ thuộc agent (lớp cao nhất luôn chặn)
- OO/SS/PP đang rời rạc — cần arbitration rõ ràng
- Muốn thêm hành vi (chính sách mới) không đụng agent loop
- Kết hợp 20-immune: safety layer thành nơi chặn tấn công