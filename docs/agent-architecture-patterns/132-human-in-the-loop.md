# Hướng EB: Human-in-the-Loop — agent thực thi, người duyệt quyết định cuối

> **Nguồn gốc:** StackAI HITL Approval Workflows; Strata "HITL: 2026 Guide to AI Oversight"; Port.io "HITL for AI Coding Agents"; Galileo AI HITL Oversight 2026
> **Coupling:** 🟢 — thêm lớp duyệt, runtime không đổi
> **Agent-agnostic:** ✅ (người duyệt ở lớp ngoài — MCP/CLI)
> **Code sẵn:** ⚠️ (checkpoint TT + audit VV + perms UUUU sẵn; thiếu approval UI/API)
> **Effort:** 1-2 tuần

## Nguồn gốc

Human-in-the-Loop: **agent không tự thực thi hành động nhạy cảm; người duyệt quyết định cuối** — StackAI: "a runtime control pattern where an AI agent must request and receive a human decision"; Strata 2026: "trained humans retain decision authority over high-risk AI agent actions"; Port.io: "agents do the work but cannot make irreversible changes without a human's approval"; Galileo: "match escalation thresholds to real production risk, choose approval patterns based on reversibility". Điểm khác **UU escalate tree** (tự động leo tầng người) và **UUUU dynamic perms** (policy quyền) — CCCCCC *cú hãm cứng*: trước hành động không-thể-đảo-ngược (delete, merge, gửi tiền, public), agent phải yêu cầu phê duyệt → người duyệt approve/reject/modify → mới thực thi. Theo *reversibility*: ghi file đảo được = tự do; xóa/quan hệ bên ngoài = cần duyệt. Nối TT (checkpoint/pause), VV (audit lý do duyệt), YYYY (metric tần suất duyệt — tỉ lệ agent nhờ cậy người).

## Mô tả

mya HITL flow: (1) **phân loại hành động** — theo reversibility + blast radius (rủi ro): GHI hàng (add/update file, query read) = auto; NGỤY BIẾN (delete, overwrite, thay đổi nhiều file cùng lúc, side-effect ngoài — push, deploy, gửi mail/nhắn) = cần duyệt; (2) **approval request** — agent dừng (checkpoint TT), tạo request có: hành động dự định, file/đối tượng ảnh hưởng, lý do (TTTT explainable), diff xem trước; (3) **người duyệt** — CLI/MCP/TUI: approve / reject + ghi chú / modify (sửa lệnh rồi duyệt); (4) **execution gate** — chỉ thực thi khi được duyệt (không vượt qua được — policy engine WW), log lý do vào VV; (5) **auto-approve theo hồ sơ** — action quen thuộc/low-risk trong trust list (học từ lịch sử duyệt) nhưng vẫn audit; (6) **chống mệt mỏi** — nếu agent cần duyệt quá nhiều → alert, reviewer xem lại (config quá hẹp/quá rộng).

## Kiến trúc

```
  HÀNH ĐỘNG (pre-MCP/CLI) ──► PHÂN LOẠI (reversibility + risk)
        │ auto (ghi/đọc)          │ sensitive (delete/merge/side-effect)
        ▼                          ▼
  THỰC THI (như cũ)          APPROVAL REQUEST (TT checkpoint → pause)
                                      │
                                 NGƯỜI DUYỆT (CLI/MCP/TUI)
                                  approve | reject | modify
                                      │
                                      ▼
                                EXECUTION GATE (WW policy — không tự thoát)
                                      │
                                      ▼
                                  THỰC THI + VV audit (lý do duyệt)
```

```
mya: TT + VV + WW + UUUU SẸN — thiếu: approval request + gate + UI/CLI duyệt
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ TT checkpoint — dừng giữa chừng (nền tảng pause)
// ✅ VV audit — ghi sự kiện + lý do (bằng chứng duyệt)
// ✅ WW policy engine — chặn hành động (execution gate dựa sẵn)
// ✅ UUUU perms — policy theo ngữ cảnh (phân loại rủi ro)
// ✅ TTTT explainable — agent nêu lý do (để người duyệt quyết)

// ❌ THIẾU: approval request object + channel (CLI/MCP/TUI)
// ❌ THIẾU: reversibility classifier (tự phân loại hành động)
// ❌ THIẾU: execution gate (chờ duyệt trước khi thực thi)
```

## Implementation

```typescript
// packages/hitl/src/approval.ts (NEW)
export class ApprovalGate {
  async preExecute(cmd: Command) {
    if (this.classify(cmd) === "auto") return cmd;         // reversibility low
    const req = await this.raise(cmd);                     // checkpoint TT — pause
    const decision = await this.promptHuman(req);          // CLI/MCP — approve/modify/reject
    audit.log("approval", { cmd, decision });              // VV — lý do duyệt (TTTT)
    if (decision.action === "reject") throw new Rejected(req, decision.note);
    return decision.action === "modify" ? decision.cmd : cmd; // gate WW không thoát
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chặn hậu quả không thể đảo ngược (delete/merge/push) | ❌ Chậm — mọi hành động nhạy cảm chờ người |
| ✅ Tuân governance: quyết định cuối ở người | ❐ Mệt người duyệt nếu request quá nhiều |
| ✅ Rõ ràng trách nhiệm (VV ghi người duyệt + lý do) | ❌ Người duyệt không có mặt 24/7 (agent kẹt) |
| ✅ Xây trên TT+WW+UUUU có sẵn | ❌ Phân loại reversibility sai → duyệt nhầm/thiếu |

## Khác các hướng gần

| | TT Checkpoint | UU Escalate | CCCCCC: HITL |
|---|---|---|---|
| Mục đích | Resume sau crash | Leo tầng người | **Duyệt quyết định nhạy cảm** |
| Kích hoạt | Sự kiện/chủ động | Lỗi/không chắc | **Hành động không đảo ngược** |
| Quyền quyết | Agent | Người (khi lỗi) | **Người luôn (với hành động nhạy cảm)** |

## Khi nào chọn

- Hành động có side-effect ngoài/không đảo ngược (push, gửi, xóa)
- Cần tuân governance — quyết định cuối ở con người
- Đã có TT+VV+WW+UUUU — thêm approval gate + UI
- Rủi ro pháp lý/vận hành cao (finops XXXXX — chi tiền)