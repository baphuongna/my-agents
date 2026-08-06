# Hướng AW: Impasse-Subgoal — spawn specialist khi agent bế tắc

> **Nguồn gốc:** Soar cognitive architecture (Laird, 2012); Wray/Kirk/Laird arXiv:2505.07087
> **Coupling:** 🟢 — specialist tạm thời, terminate sau khi xong
> **Agent-agnostic:** ✅ — áp cho bất kỳ agent chính
> **Code sẵn:** ⚠️ (1 phần — role-subagent-spawn sẵn; thiếu impasse detector)
> **Effort:** 1 tuần

## Nguồn gốc

Soar (Laird) vận hành theo vòng: agent chọn operator (hành động) cho trạng thái hiện tại. Khi **không operator nào áp dụng được** (no-change impasse) hoặc **không biết chọn operator nào** (tie impasse) → Soar **tự sinh subgoal**: tạm dừng, xử lý riêng vấn đề bế tắc, giải quyết xong thì quay lại operator cũ với thông tin mới. Đây là cơ chế *tự mở rộng* — không cần ai từ ngoài ra lệnh. Wray et al. (2025) liệt kê đây là cognitive design pattern quan trọng cho LLM agents: LLM "do dự" (tool-call bị hủy, lặp cùng action, trả lời chung chung) là tín hiệu impasse — lúc đó spawn specialist đúng lúc, hiệu quả hơn để agent chính tự loay hoay.

## Mô tả

mya theo dõi **tín hiệu impasse** của agent chính: (1) cùng action lặp lại N lần, (2) tool-call rồi hủy, (3) vòng lặp review-fail cùng bài học, (4) message do dự ("I'm not sure"). Phát hiện → **spawn specialist** (role khác, model khác, context sạch) với đúng vấn đề + kết quả mong đợi → specialist trả verdict/phương án → agent chính tiếp tục. Specialist **terminate ngay** — không thành "agent thứ 2 thường trực". Khác council (song song review): đây là *theo yêu cầu, khi bế tắc*, 1 specialist tạm thời.

## Kiến trúc

```
┌────────────────────────────────────────────────────────────┐
│            IMPASSE-SUBGOAL LOOP (mya)                       │
│                                                            │
│  agent chính ── chạy task ──► ┌──────────────────┐         │
│                               │ IMPASSE DETECTOR │         │
│  tín hiệu:                    └────────┬─────────┘         │
│   · action lặp ≥ 3                  │ detect              │
│   · tool-call rồi hủy               ▼                     │
│   · review-fail lặp          ┌──────────────┐              │
│   · "I'm not sure"           │ SPAWN         │             │
│                              │ specialist    │             │
│                              │ (role + model)│             │
│                              └──────┬───────┘              │
│                                     ▼                     │
│  specialist (context sạch) ── giải quyết ──► verdict       │
│                                     │                     │
│                                     ▼                     │
│  agent chính ── nhận verdict ──► tiếp tục ──► terminate    │
└────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/print/src/role-subagent-spawn.ts — spawn subagent theo role
//    (view handle registry, spawn/kill lifecycle)
// ✅ packages/print/src/pi-subagent.ts — session con, chia model registry + auth
// ✅ packages/core/src/roles.ts — role = { prompt, tools, model } (chọn specialist)

// ❌ THIẾU: impasse detector (tín hiệu từ agent chính).
//    Cần đọc event stream (K) tìm pattern: action lặp, tool-call hủy, ...
```

## Implementation

```typescript
// packages/gateway/src/impasse.ts (NEW)
class ImpasseDetector {
  private actionCounts = new Map<string, number>();

  /** Gọi sau mỗi tool_call — trả verdict nếu nghi bế tắc. */
  onToolCall(tool: string, args: Record<string, unknown>): "normal" | "suspect" {
    const key = `${tool}:${JSON.stringify(args)}`;
    const n = (this.actionCounts.get(key) ?? 0) + 1;
    this.actionCounts.set(key, n);
    if (n >= 3) { log(`[impasse] ${tool} lặp ${n} lần — nghi bế tắc`); return "suspect"; }
    return "normal";
  }

  onTurn(messages: LlmTrace): "normal" | "suspect" {
    // Tín hiệu: tool-call rồi hủy, review-fail lặp cùng bài học, "not sure"
    if (hasAbortedToolCall(messages)) return "suspect";
    if (repeatedLesson(messages, 2)) return "suspect";
    return "normal";
  }
}

// Khi suspect → spawn specialist:
const verdict = await spawnRoleSubagent("specialist", {
  problem: summarizeImpasse(session),
  role: pickRoleFor(task),          // từ roles registry
  model: "mid",                     // rẻ hơn nếu vấn đề hẹp
  deliverable: "verdict + options",
});
await resumeAgentWith(session, verdict);
// specialist auto-terminate sau khi trả kết quả
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Giải quyết bế tắc đúng lúc, không loay hoay | ❌ Detector sai → spawn tốn cost thừa |
| ✅ Specialist context sạch (không nhiễm vòng lặp cũ) | ❌ Vấn đề hẹp vẫn tốn 1 LLM call |
| ✅ Không thành agent thường trực thứ 2 | ❌ Verdict phải "ép" vào agent chính (prompt) |
| ✅ Map thẳng vào role-subagent-spawn sẵn | |
| ✅ Có audit: "task X từng bế tắc, nhờ specialist Y" | |

## Khi nào chọn

- Agent chính hay mắc kẹt vòng lặp (fix-fail, tool lặp)
- Muốn dùng subagent *đúng lúc* thay vì spawn sẵn
- Đã có role-subagent-spawn + event ledger
- Muốn audit lịch sử bế tắc → học cách tránh (gắn YY)
