# Hướng AAB: Private-Tag Privacy Control — nội dung trong thẻ `<private>` bị loại khỏi lưu trữ memory

> **Nguồn gốc:** claude-mem (README.md) | **Coupling:** 🟢 — chèn vào capture pipeline trước khi lưu memory | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có auto-capture + redact — chưa có private-tag stripper) | **Effort:** 1 tuần

## Nguồn gốc

**claude-mem** có cơ chế **quyền riêng tư fine-grained**: nội dung bọc trong thẻ `<private>` bị **loại khỏi lưu trữ memory**. Người dùng (hoặc agent) chủ động đánh dấu phần nào không được capture — `<private>` là opt-out rõ ràng tại chỗ, không cần cấu hình toàn cục. Nội dung private không bao giờ vào store, không được inject lại vào prompt sau này. Nguyên tắc: **capture default-on nhưng có escape hatch tại chỗ** — dữ liệu nhạy cảm (mật khẩu, token, thông tin cá nhân) được người dùng khoanh vùng ngay trong văn bản.

## Mô tả

mya private-tag privacy control: chèn **stripper** vào capture pipeline (packages/memory auto-capture.ts + remember tool): trước khi lưu observation/memory, scan text cho `<private>…</private>` — nội dung bên trong **bị cắt bỏ hoàn toàn** (không phải mask — không lưu gì), có thể thay bằng placeholder `[PRIVATE]` nếu cần giữ ngữ cảnh. Áp dụng ở mọi cổng vào memory: auto-capture pattern, remember tool, dream-cycle consolidation, spill payload. Khác redact (thay secret bằng `***` nhưng vẫn lưu cấu trúc) — AAB **không lưu nội dung**; kết hợp được: redact chặn secret dạng pattern, AAB chặn vùng người dùng tự đánh dấu.

## Kiến trúc

```
  VĂN BẢN ĐẦU VÀO (user/assistant turn, tool output)
        │
        ▼
  ┌─── PRIVATE-TAG STRIPPER ──────────────────────────┐
  │  scan <private>…</private>                         │
  │   ├─ khớp → cắt nội dung (thay [PRIVATE] nếu cần) │
  │   └─ không khớp → giữ nguyên                      │
  └───────────────────────┬───────────────────────────┘
                          ▼
  ┌─── CAPTURE PIPELINE ─────────────────────────────┐
  │  auto-capture (regex heuristic)                   │
  │  remember tool (explicit)                         │
  │  dream-cycle (consolidation)                      │
  │  → memory store (KHÔNG chứa nội dung private)     │
  └────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/memory auto-capture.ts — pattern heuristic capture (nơi chèn stripper)
// ✅ packages/core redact.ts — secret masking (nền — AAB là lớp vùng tự đánh dấu)
// ✅ packages/memory dream-cycle.ts — consolidation (nơi chèn stripper)
// ✅ packages/core spill.ts — LargeValueRef (payload lớn — nơi chèn stripper)
// ✅ packages/memory sqlite-store.ts — store (đảm bảo không lưu private)

// ❌ THIẾU: private-tag stripper (<private>…</private> → cắt)
// ❌ THIẾU: hook vào mọi cổng vào memory (capture/remember/dream)
// ❌ THIẾU: placeholder [PRIVATE] giữ ngữ cảnh (tùy chọn)
```

## Implementation

```typescript
// packages/memory/src/private-tag.ts (NEW)
const PRIVATE_RE = /<private\b[^>]*>([\s\S]*?)<\/private>/g;

/** Cắt mọi nội dung trong <private>…</private>. Giữ placeholder nếu keepPlaceholder. */
export function stripPrivateTags(text: string, keepPlaceholder = false): string {
  return text.replace(PRIVATE_RE, keepPlaceholder ? "[PRIVATE]" : "");
}

/** Kiểm tra text có chứa private tag không (cho audit/metrics). */
export function hasPrivateTag(text: string): boolean {
  PRIVATE_RE.lastIndex = 0;
  return PRIVATE_RE.test(text);
}

/** Wrap một đoạn thành private — dùng khi agent tự đánh dấu. */
export function wrapPrivate(content: string): string {
  return `<private>${content}</private>`;
}

/** Capture hook: mọi cổng vào memory gọi qua đây. */
export function sanitizeForMemory(raw: string, opts?: { keepPlaceholder?: boolean }): string {
  const stripped = stripPrivateTags(raw, opts?.keepPlaceholder);
  // redact còn hoạt động trên phần đã strip — hai lớp độc lập
  return stripped;
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Kiểm soát privacy fine-grained ngay tại chỗ | ❌ Nội dung trong tag mất hẳn (không recall lại) |
| ✅ Không cần cấu hình toàn cục | ❌ Agent/user phải nhớ wrap tag |
| ✅ Default-on capture vẫn giữ (không mất tính năng) | ❌ Tag lọt vào prompt nếu stripper không chạy ở mọi cổng |
| ✅ Kết hợp redact (pattern) + AAB (vùng) | ❌ Placeholder [PRIVATE] làm mất ngữ cảnh cục bộ |

## Khác các hướng gần

| | Redact (mask) | AAB: Private Tag |
|---|---|---|
| Cơ chế | Pattern thay `***` | **Người dùng đánh dấu vùng** |
| Nội dung lưu | Cấu trúc giữ, secret ẩn | **Không lưu nội dung** |
| Ai quyết định | Regex (43 vendor patterns) | **Người dùng/agent tại chỗ** |
| Mối quan hệ | Lớp pattern | **Lớp vùng — bổ sung** |

## Khi nào chọn

- Memory capture default-on mà người dùng cần opt-out tại chỗ
- Dữ liệu nhạy cảm không theo pattern (redact không bắt được)
- Kết hợp: redact (pattern) + AAB (vùng) + permission gate (tool) thành 3 lớp
- Test: đảm bảo stripper chạy ở MỌI cổng vào memory (auto-capture, remember, dream, spill)
