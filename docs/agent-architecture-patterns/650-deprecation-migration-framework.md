# Hướng XZ: Deprecation Migration Framework — decision framework 5 câu hỏi, phân loại compulsory vs advisory deprecation, migration từng bước cho việc loại bỏ tính năng cũ an toàn (research.md)

> **Nguồn gốc:** agent-skills (deprecation-and-migration — research.md) | **Coupling:** 🟢 — process + codemod, không đổi runtime | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có skills curator + audit — chưa có deprecation registry) | **Effort:** 1-2 tuần

## Nguồn gốc

**agent-skills** dạy deprecation and migration bằng **decision framework 5 câu hỏi** (ai dùng? có thể xóa ngay? cần migration? có codemod? thời điểm nào?) trước khi loại bỏ tính năng cũ. Phân loại **compulsory deprecation** (phải migrate — API cũ sắp mất, lỗ hổng bảo mật) vs **advisory deprecation** (nên migrate — có lựa chọn tốt hơn nhưng chưa bắt buộc). Migration theo từng bước: announce → deprecate (warning) → migrate (codemod) → remove. Không xóa tính năng đang có người dùng mà không có lộ trình.

## Mô tả

mya áp dụng deprecation framework: khi muốn loại tool/API/skill cũ, agent chạy **5 câu hỏi decision**: (1) ai đang dùng? (2) có thay thế tương đương? (3) xóa ngay có phá gì? (4) cần migration path (codemod/script)? (5) announce/grace period bao lâu? Kết quả: deprecation entry ghi vào **registry** với loại `compulsory|advisory`, ngày announce, ngày remove. Trong grace period, runtime vẫn chạy nhưng log warning + hint thay thế. Hết hạn → remove kèm codemod nếu cần. mya có sẵn skills curator (cập nhật skill cũ), audit (theo dõi thay đổi), tools (codemod bằng script) — XZ thêm **deprecation registry** + **warning emitter**.

## Kiến trúc

```
  5 câu hỏi decision:
  ┌─1 ai dùng? ──► usage scan (grep/telemetry)
  ├─2 thay thế? ──► replacement API tồn tại?
  ├─3 xóa ngay? ──► breaking change? security?
  ├─4 codemod? ──► migration script viết được?
  └─5 thời điểm? ──► announce → grace → remove

  Registry:
  ┌──────────────────────────────────────────────┐
  │ { name, kind: compulsory|advisory,           │
  │   announceAt, removeAt, replacement,         │
  │   codemod: "scripts/migrate-x.mjs" }         │
  └──────────────────────────────────────────────┘
   Runtime: dùng API cũ → warning log + hint thay thế
   removeAt đến → chạy codemod → xóa (advisory giữ thêm 1 chu kỳ)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills curator.ts — cập nhật/thay skill cũ (nền — XZ replacement)
// ✅ packages/audit — theo dõi thay đổi hệ thống (nền — XZ registry audit)
// ✅ packages/core telemetry.ts — span log (nền — XZ warning emit)
// ✅ packages/tools — script/codemod chạy được (nền — XZ migration)

// ❌ THIẾU: deprecation registry (5 câu hỏi → entry)
// ❌ THIẾU: runtime warning emitter (dùng API cũ → hint thay thế)
// ❌ THIẾU: remove scheduler (removeAt + codemod + rollback)
```

## Implementation (TS)

```typescript
// packages/core/src/deprecation.ts (MỚI)
export type DepKind = "compulsory" | "advisory";

export interface Deprecation {
  name: string;            // "kanbanTool.v1"
  kind: DepKind;
  announceAt: string;      // ISO date
  removeAt: string;
  replacement: string;     // "kanbanTool.v2"
  codemod?: string;        // "scripts/migrate-kanban.mjs"
}

export class DeprecationRegistry {
  private entries = new Map<string, Deprecation>();

  register(d: Deprecation): void {
    this.entries.set(d.name, d);
  }

  /** 5 câu hỏi decision → tạo entry. */
  decide(usage: { users: number; hasReplacement: boolean; breaking: boolean }): DepKind {
    if (usage.breaking || usage.users === 0) return "compulsory";
    return usage.hasReplacement ? "advisory" : "compulsory"; // không thay thế → vẫn phải migrate
  }

  /** Runtime gọi API cũ → warning + hint. */
  warn(name: string, now = new Date()): string | null {
    const d = this.entries.get(name);
    if (!d) return null;
    if (now >= new Date(d.removeAt)) return `⛔ ${name} đã bị REMOVE — dùng ${d.replacement}`;
    if (now >= new Date(d.announceAt)) return `⚠️ ${name} deprecated (${d.kind}) — migrate sang ${d.replacement}`;
    return null;
  }

  /** removeAt đến → trả codemod cần chạy. */
  dueRemovals(now = new Date()): Deprecation[] {
    return [...this.entries.values()].filter((d) => now >= new Date(d.removeAt));
  }
}

// Usage:
// registry.register({ name: "kanbanTool.v1", kind: "compulsory", announceAt: "2026-08-01", removeAt: "2026-09-01", replacement: "kanbanTool.v2", codemod: "scripts/migrate-kanban.mjs" });
// const w = registry.warn("kanbanTool.v1");   // ⚠️ deprecated — migrate sang kanbanTool.v2
// for (const d of registry.dueRemovals()) await runCodemod(d.codemod); // xóa an toàn
```

## Được

- ✅ Xóa tính năng có lộ trình — không xóa đột ngột
- ✅ Compulsory vs advisory rõ — mức độ ép buộc minh bạch
- ✅ Runtime hint — user/agent biết thay thế ngay lúc dùng
- ✅ Codemod path — migration tự động, ít công sửa tay
- ✅ 5 câu hỏi decision — quyết định deprecate có cấu trúc

## Mất

- ❌ Grace period kéo dài — advisory giữ lâu, code cũ tồn tại dai dẳng
- ❌ Usage scan thiếu chính xác — grep không bắt dynamic call
- ❌ Codemod sai — migration tự động đổi nhầm semantics (cần test)

## Khác các hướng gần

| | Xóa thẳng (breaking) | Version song song | XZ: Deprecation Framework |
|---|---|---|---|
| Trải nghiệm user | vỡ ngay | 2 version duy trì | **warning → migrate → remove** |
| Chi phí | thấp | cao (maintain 2) | **trung bình (grace)** |
| An toàn | thấp | cao | **cao (announce + codemod)** |

## Khi nào chọn

- Sắp loại bỏ tool/API/skill cũ trong mya (ví dụ kanban v1, tool cũ)
- Muốn migration có codemod + warning thay vì breaking change
- Có skills curator + audit + telemetry sẵn — XZ thêm registry + scheduler
- Nối packages/skills curator.ts (thay thế skill) + core/telemetry.ts (warning span) + tools (chạy codemod); guard usage-scan (grep + telemetry kết hợp — không bỏ sót), codemod-test (migration script phải có golden test), và rollback-path (remove sai → restore từ git tag); XZ = deprecation registry, kết hợp 646 XV assumption-gate (deprecation assumption nêu trong research.md) + 657 YG minimal-complexity-gate (đừng deprecate vì over-engineering)
