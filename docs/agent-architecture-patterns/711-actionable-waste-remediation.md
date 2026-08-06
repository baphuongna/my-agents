# Hướng AAI: Actionable Waste Remediation — mỗi WasteFinding kèm WasteAction copy-paste được để sửa lãng phí ngay

> **Nguồn gốc:** codeburn (docs/architecture.md) | **Coupling:** 🟢 — thêm action layer trên findings | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có detectors nền — chưa có action template) | **Effort:** 1-2 tuần

## Nguồn gốc

**codeburn** không dừng ở phát hiện lãng phí — mỗi `WasteFinding` đi kèm **`WasteAction` có thể copy-paste ngay**: **paste-to-CLAUDE.md**, **paste-to-session-opener**, **prompt-now** (câu lệnh gửi thẳng agent), **edit shell config**. Chuyển phát hiện thành **hành động sửa cụ thể** — người dùng/agent không phải tự nghĩ cách fix. Nguyên tắc: **finding phải kèm remedy hành động được** — chẩn đoán mà không có phác đồ điều trị thì vô dụng.

## Mô tả

mya actionable waste remediation: mở rộng `WasteFinding` (AAH) với **`WasteAction`**: `{ kind, target, content }` — `kind` ∈ `paste-to-claude-md` / `paste-to-session-opener` / `prompt-now` / `edit-config`; `content` là đoạn text sẵn sàng dùng. Detector trả finding kèm action (vd duplicate read → `paste-to-session-opener` nhắc đọc cache; bloated CLAUDE.md → `edit-config` gợi ý cắt section). Output render dạng copy-paste block (markdown code fence) để user/agent dùng ngay. Agent-agnostic: action là text template, không phụ thuộc agent nào.

## Kiến trúc

```
  WASTE FINDING (từ AAH detectors)
        │
        ▼
  ┌─── WASTE ACTION ──────────────────────────────────┐
  │  { kind, target, content }                         │
  │  ├─ paste-to-claude-md     → đoạn text thêm CLAUDE.md │
  │  ├─ paste-to-session-opener → đoạn nhắc đầu session  │
  │  ├─ prompt-now             → câu lệnh gửi agent     │
  │  └─ edit-config            → gợi ý sửa config       │
  └──────────────────────┬───────────────────────────────┘
                         ▼
  ┌─── RENDER (copy-paste block) ─────────────────────┐
  │  ## Finding: duplicate_read (impact 12k tokens)    │
  │  ```                                             │
  │  <nội dung action — copy dán ngay>                │
  │  ```                                             │
  └──────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core waste.ts (AAH) — WasteFinding + detectors (nền)
// ✅ packages/core telemetry.ts — evidence source
// ✅ packages/print — render surface (nơi hiện copy-paste block)
// ✅ packages/skills skill.ts — skill body format (nền paste-to-md)
// ✅ packages/prompts inject.ts — session opener (nền paste-to-opener)

// ❌ THIẾU: WasteAction type + detector hookup
// ❌ THIẾU: action template per finding type
// ❌ THIẾU: render copy-paste block
```

## Implementation

```typescript
// packages/core/src/waste-action.ts (NEW)
export type ActionKind =
  | "paste-to-claude-md" | "paste-to-session-opener" | "prompt-now" | "edit-config";

export interface WasteAction {
  kind: ActionKind;
  /** File/config cần sửa (nếu có). */
  target?: string;
  /** Nội dung copy-paste sẵn sàng. */
  content: string;
}

export interface ActionableFinding {
  type: string;
  impactTokens: number;
  evidence: string;
  actions: WasteAction[]; // ≥ 1 — luôn có cách sửa
}

/** Template theo loại finding — detector không tự viết action. */
export function actionsFor(type: string, evidence: string): WasteAction[] {
  switch (type) {
    case "duplicate_read":
      return [
        { kind: "paste-to-session-opener", content: `Trước khi đọc file, kiểm tra nội dung đã có trong context chưa (files đọc: ${evidence}). Đọc lại chỉ khi cần dữ liệu mới.` },
        { kind: "prompt-now", content: `Kiểm tra ${evidence} đã được đọc trong session này chưa; nếu có, dùng nội dung cũ thay vì đọc lại.` },
      ];
    case "context_bloat":
      return [
        { kind: "paste-to-claude-md", content: "Giữ prompt đầu vào gọn: chỉ giữ thông tin cần cho task hiện tại; tóm tắt lịch sử thay vì giữ nguyên. Target ratio ≤ 25:1." },
        { kind: "edit-config", target: "~/.mya/compress.json", content: '{ "aggressive": true, "threshold": 100000 }' },
      ];
    case "ghost_skill":
      return [
        { kind: "edit-config", target: "~/.mya/skills-index.json", content: `Xóa các skill không tồn tại: ${evidence}.` },
        { kind: "prompt-now", content: `Xóa các mục skill không có file tương ứng khỏi index: ${evidence}` },
      ];
    default:
      return [{ kind: "prompt-now", content: `Xem xét lãng phí "${type}" (${evidence}) và đề xuất cách giảm.` }];
  }
}

/** Gắn action cho mọi finding — không finding nào thiếu remedy. */
export function makeActionable(findings: Array<{ type: string; impactTokens: number; evidence: string }>): ActionableFinding[] {
  return findings.map((f) => ({ ...f, actions: actionsFor(f.type, f.evidence) }));
}

/** Render copy-paste block cho CLI/TUI. */
export function renderActionable(f: ActionableFinding): string {
  const blocks = f.actions.map((a) => `### ${a.kind}${a.target ? ` → ${a.target}` : ""}\n\`\`\`\n${a.content}\n\`\`\``).join("\n");
  return `## Finding: ${f.type} (impact ${f.impactTokens} tokens)\n${blocks}`;
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Finding → action luôn (không "chẩn đoán suông") | ❌ Template chung — đôi khi chưa đúng ngữ cảnh cụ thể |
| ✅ Copy-paste ngay — zero nghĩ | ❌ Action phải cập nhật theo thay đổi format (CLAUDE.md…) |
| ✅ Nhiều action cho một finding (chọn cách phù hợp) | ❌ edit-config có thể gợi ý sai config path |
| ✅ Agent-agnostic — text template | ❌ prompt-now phụ thuộc agent hiểu được lệnh |

## Khác các hướng gần

| | Finding (AAH) | AAI: Actionable |
|---|---|---|
| Output | Chẩn đoán + evidence | **Chẩn đoán + cách sửa** |
| Hành động | Agent tự nghĩ | **Copy-paste ngay** |
| Template | Per-detector | **Per-finding-type** |
| Mối quan hệ | Nền | **Lớp remedy trên finding** |

## Khi nào chọn

- Đã có waste detectors (AAH) — cần biến findings thành hành động
- Người dùng muốn sửa lãng phí nhanh, không muốn nghĩ cách
- Kết hợp: AAH (detect) + AAI (action) + render ở print/TUI
- Guard: mọi finding type có actionsFor (fallback default), test template không vỡ format
