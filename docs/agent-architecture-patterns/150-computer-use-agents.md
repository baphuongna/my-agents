# Hướng ET: Computer-Use Agents — agent thao tác GUI/trình duyệt như người

> **Nguồn gốc:** Claude Platform "Computer use tool" (Anthropic); arXiv 2411.10323 "Preliminary Case Study with Claude 3.5 Computer Use"; Ui.Vision "Computer Use in Browser"; XHinker "How AI Agent Sees Desktop and Controls Mouse"
> **Coupling:** 🟢 — thêm tool layer mới, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (shell/MCP sẵn; thiếu GUI/computer-use runtime)
> **Effort:** 2-4 tuần

## Nguồn gốc

Computer-use: **agent "nhìn" màn hình và thao tác (click, gõ, scroll) như con người** — Anthropic computer use tool: "Anthropic processes the screenshot images and action requests in real time as part of the API call" — model nhận screenshot + trả hành động (mouse/keyboard); arXiv 2411.10323: "agent framework for deploying API-based GUI automation models"; XHinker: "Browser control works differently — it uses the browser's own automation protocol instead of simulating mouse clicks". Điểm chính: 2 kiểu — GUI (screenshot → click toạ độ — nhìn thật) vs browser automation (DOM/protocol — chuẩn hơn). Điểm khác **shell/MCP** (giao diện văn bản/API) — UUUUUU *vượt qua giao diện văn bản*: tool/GUI app không có API, không có CLI → agent điều khiển trực tiếp. Rủi ro cao: click nhầm, màn hình chứa dữ liệu nhạy cảm (screenshot = leak). Nối DDDDDD sandbox (chạy computer-use trong máy ảo/container — nhìn màn hình ảo), CCCC HITL (click nguy hiểm — cần duyệt), VV audit (ghi hành động GUI), XX (hạn chế — chỉ môi trường an toàn), IIII TEE (screen chứa dữ liệu).

## Mô tả

mya computer-use: (1) **chọn kiểu điều khiển** — GUI (screenshot → action) khi không có API/DOM; browser automation (Playwright/CDP) khi có DOM (chuẩn hơn — XHinker); (2) **vòng nhìn-làm** — screenshot → model phân tích → action (click/tý/gõ/scroll) → screenshot mới → lặp cho tới hoàn thành (giới hạn vòng — PPPP); (3) **an toàn** — chạy trong máy ảo/sandbox (DDDDDD: screen ảo, không đụng màn hình thật người dùng); action nhạy cảm (gửi form, xóa) → CCCC duyệt; (4) **giảm nhiễu** — screenshot nén/crop vùng liên quan (rẻ — SS), so 2 screenshot liên tiếp phát hiện vòng lặp (không đổi); (5) **đo** — tỷ lệ hoàn thành task GUI (PP eval — computer-use benchmark), cost mỗi task (XXXXX); (6) **fallback** — GUI lỗi → thử API/DOM trước (bậc điều khiển: API > DOM > GUI — HHH-style).

## Kiến trúc

```
  TASK (không API/CLI) ──► ĐIỀU KHIỂN (chọn bậc):
   API > DOM/browser automation (Playwright/CDP) > GUI (screenshot → click)
        │
        ▼
  GUI LOOP: screenshot → model action (click/tý/gõ) → screenshot mới
   giới hạn vòng (PPPP) · so screenshot phát hiện kẹt
        │
        ▼
  AN TOÀN: chạy screen ảo (sandbox DDDDDD) · action nhạy cảm → HITL (CCCC)
        │
        ▼
  AUDIT VV (hành động GUI) · screenshot chứa data → redact (RRR)
```

```
mya: shell/MCP SẸN — thiếu: computer-use runtime (screenshot → action)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ shell/MCP — bậc điều khiển API/DOM (nền)
// ✅ DDDDDD sandbox — máy ảo cho GUI (nơi chạy)
// ✅ CCCC HITL — duyệt action nhạy cảm
// ✅ PPPP bounded — giới hạn vòng lặp
// ✅ VV audit + RRR redact — bằng chứng + che dữ liệu
// ✅ PP eval — benchmark computer-use

// ❌ THIẾU: computer-use runtime (screenshot → action model)
// ❌ THIẾU: screen ảo (VM với display)
// ❌ THIẾU: DOM automation (Playwright/CDP) cho browser
```

## Implementation

```typescript
// packages/gui/src/computer.ts (NEW)
export class ComputerUse {
  async run(task: Task, vm: VmScreen): Promise<Result> {
    for (let i = 0; i < maxSteps && !done; i++) {    // giới hạn PPPP
      const shot = await vm.screenshot();            // screen ảo — sandbox
      const action = await model.act(shot, task);    // click/tý/gõ
      if (action.sensitive) await hitl.approve(action); // CCCC
      await vm.execute(action);                      // không đụng screen thật
      if (sameAs(shot, vm.screenshot())) break;      // kẹt — không tiến triển
    }
    return audit.gui(task, steps);                   // VV
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tự động hóa GUI không có API/CLI (QuickBooks — Reddit) | ❌ Chậm + tốn (nhiều screenshot → token) |
| ✅ Browser DOM automation chuẩn hơn click ảo | ❐ Click nhầm — cần screen ảo + HITL |
| ✅ Vượt được giới hạn "không có giao diện lập trình" | ❌ Screenshot chứa dữ liệu nhạy cảm (redact RRR) |
| ✅ Xây trên sandbox + HITL + audit | ❌ Model GUI còn lỗi — tỷ lệ hoàn thành chưa cao |

## Khác các hướng gần

| | Shell (B) | MCP (BBB) | UUUUUU: Computer-Use |
|---|---|---|---|
| Giao diện | CLI text | API protocol | **GUI/screenshot + DOM** |
| Khi dùng | Có CLI | Có API | **Không API/CLI — màn hình** |
| Rủi ro | Thấp | Thấp | **Cao — cần sandbox + HITL** |

## Khi nào chọn

- Tool/app không có API/CLI — phải thao tác UI thật
- Browser automation (DOM) — form, crawl cần đăng nhập
- Đã có sandbox + HITL + audit — thêm computer-use runtime
- Task GUI lặp lại (kế toán, nhập liệu — Reddit use case)