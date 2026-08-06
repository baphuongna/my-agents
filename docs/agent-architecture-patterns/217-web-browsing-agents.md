# Hướng HI: Web Browsing Agents — agent điều khiển trình duyệt (Playwright) để tương tác web thật

> **Nguồn gốc:** Playwright docs ("reliable web automation — one API drive Chromium, Firefox, WebKit — for testing, scripting, and AI agents"); Stackademic "Playwright in Agentic AI" ("Playwright's interaction model mirrors how humans use browsers — fires real mouse events, keyboard"); fast.io "Best Headless Browsers for AI Agents" (Playwright + agent browser — interact, authenticate, save sessions); Playwright MCP guide (navigation, form filling, data extraction — LLM-friendly); plainenglish "Autonomous Browser Agents" (LLMs + Playwright + memory + planning loops)
> **Coupling:** 🟡 — chạm tầng tool tương tác web (quyền, session, DOM)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (fetch/shell có; chưa điều khiển browser)
> **Effort:** 3-6 tuần

## Nguồn gốc

Web browsing agents: **thay vì fetch tĩnh — agent dùng Playwright (hoặc browser-use) điều khiển browser thật: click, type, submit, đọc DOM sau render — xử lý trang JS-heavy, form, auth** — Stackademic: mô phỏng hành vi người — real mouse/keyboard events; Playwright: 1 API cho cả 3 engine — reliable; fast.io: authenticate + save sessions (quan trọng cho trang login); MCP guide: LLM-friendly — navigation, form filling, data extraction; plainenglish: memory + planning loops giúp navigate tốt hơn intern. Khác **computer-use (150)** (điều khiển cả desktop OS — tổng quát hơn) — JJJJ tập trung *web* qua DOM — rẻ hơn, chính xác hơn; **shell/platform** (CLI — không có UI); **MCP-first (162)** (tool APIs — chỉ khi web có API). Kết nối: **209 rewrite** (query web), **191 kv-cache** (cache page), **214 PII** (không gửi data nhạy lên web), **200 injection** (web untrusted — đánh dấu data), **198 audit** (ghi hành động browser).

## Kiến trúc

```
  TASK (agent: "điền form đặt vé, đọc dashboard X")
        │
        ▼
  PLAYWRIGHT SESSION (Chromium headless — persistent profile + cookie)
        │
        ▼
  NAVIGATE (goto → DOM ready → snapshot "text + landmarks" cho LLM)
        │
        ▼
  ACT (click / type / select / submit — theo mô hình người dùng thật)
        │
        ▼
  VERIFY (đọc lại DOM — confirm hành động thành công, retry nếu không)
        │
        ▼
  RESULT (extract data — trả về; audit ghi hành trình)
```

```
mya: chưa có browser — chỉ fetch URL (đủ cho trang tĩnh, thiếu JS/form)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ fetch/file/url tool — đọc trang tĩnh (nền)
// ✅ 200 injection defense — đánh dấu web data untrusted
// ✅ 209 query rewrite / 191 cache — phía retrieval
// ✅ 198 audit — ghi hành động (nền)

// ❌ THIẾU: browser runtime (Playwright — 3 engines, session persist)
// ❌ THIẾU: snapshot DOM → LLM (text + actionable landmarks)
// ❌ THIẾU: hành động click/type/select + verify sau khi thực hiện
```

## Implementation

```typescript
// packages/webagent/src/browser.ts (NEW)
export class WebAgent {
  constructor(private pw: Playwright) {}
  async act(task: Task): Promise<PageResult> {
    const page = await this.pw.launch({ headless: true, session: profile }); // persist
    const snap = await snapshot(page);             // text + landmarks — LLM-friendly
    const action = await llm.decide(snap, task);   // click/type/select/submit
    await exec(page, action);
    return verify(page, snap);                     // đọc lại DOM — confirm ok
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Xử lý trang JS-heavy, form, auth — vượt fetch tĩnh | ❌ Chậm hơn API/fetch — browser nặng |
| ✅ Đọc DOM sau render — đúng nội dung thật | ❌ Dễ vỡ khi UI thay đổi (selector) — cần retry/verify |
| ✅ Hành vi người thật — vượt qua bot-detection cơ bản | ❌ Phạm vi quyền: cần session/credential — bảo mật kỹ |
| ✅ 1 API 3 engines (Playwright) — testable + agent cùng dùng | ❌ Vận: cookies hết hạn, rate-limit, page popup |

## Khác các hướng gần

| | 150 Computer-use | 162 MCP-first | JJJJJJJJ: Web-agent |
|---|---|---|---|
| Mục | Điều khiển cả OS | Gọi API qua MCP | **Tương tác browser (DOM)** |
| Phạm vi | Desktop toàn bộ | API có sẵn | **Web có giao diện** |
| Quan hệ | Tổng quát hơn | Nhanh hơn nếu có API | **Dùng khi không có API — fallback tự động** |

## Khi nào chọn

- Trang web không có API — nhưng agent cần dữ liệu/hành động trên đó
- Trang JS-heavy — fetch không render được nội dung
- Form submission, login session, crawl có interaction
- Không khi: có API (162) hoặc trang tĩnh fetch đủ — tránh nặng thêm