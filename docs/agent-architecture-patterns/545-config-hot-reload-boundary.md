# Hướng TY: Config Hot-Reload Boundary — đánh dấu field nào cần restart, field nào reload nóng theo content-signature

> **Nguồn gốc:** deer-flow `src/config/` (`AppConfig`, `Registry`, content-signature reload), `STARTUP_ONLY_FIELDS`; "config hot-reload without restart", "some fields require restart", "content-signature hash", "reload by signature not mtime" | **Coupling:** 🟡 — thêm registry + signature-reload vào config layer | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (config load sẵn — chưa có STARTUP_ONLY registry + content-signature reload) | **Effort:** 2 tuần

## Nguồn gốc

**deer-flow** chia config thành hai nhóm rõ ràng: (1) **STARTUP_ONLY_FIELDS** — field mà thay đổi cần **restart** process (vd bind address, transport type, database path — khởi tạo resource một lần). (2) **Reloadable fields** — field có thể **hot-reload** giữa chừng (vd log level, model name, retry count). Registry đánh dấu field nào thuộc nhóm nào. Khi config file thay đổi, thay vì reload tất cả (nguy hiểm — field startup-only không áp dụng nổi), hệ thống **tính content-signature** (hash nội dung) và **chỉ reload khi signature thay** (không reload theo mtime — vì `touch` không thay nội dung). Field reloadable → áp dụng nóng; field startup-only → báo "cần restart để áp dụng". Nguyên tắc: **ranh giới reload rõ ràng**, **reload theo nội dung thực**.

## Mô tả

mya config hot-reload boundary: (1) **Registry**: đánh dấu mỗi field là `startup-only` hoặc `reloadable`. (2) **Content-signature**: hash nội dung config file (SHA-256), watch thay đổi. (3) **Signature compare**: signature đổi → parse diff, field nào đổi. (4) **Apply**: reloadable field → áp dụng nóng; startup-only field đổi → cảnh báo "cần restart". mya có config load — TY thêm **field-registry** + **signature-watcher** + **diff-applier** + **restart-warning**.

## Kiến trúc

```
  config.yaml thay đổi (user edit giữa chừng)
        │
        ▼
  ┌─── CONTENT-SIGNATURE (hash nội dung) ────────────────────┐
  │  SHA-256(config.yaml) == cũ? → bỏ (touch không count)      │
  │  SHA-256 khác? → parse diff                                  │
  └───────────────────────┬─────────────────────────────────┘
                          │ (diff: field nào đổi)
                          ▼
  ┌─── FIELD REGISTRY (startup-only vs reloadable) ─────────┐
  │  logLevel: reloadable     → ✅ áp dụng nóng               │
  │  model.name: reloadable   → ✅ áp dụng nóng               │
  │  bindAddress: STARTUP_ONLY → ⚠ "cần restart để áp dụng"   │
  │  transport: STARTUP_ONLY  → ⚠ "cần restart để áp dụng"     │
  └──────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/core types.ts — config types (nền — TY registry ở đây)
// ✅ packages/core redact.ts — secret redaction (nền — TY không lộ secret trong diff)
// ✅ packages/agent sdk.ts — agent config (nền — TY reload agent config)

// ❌ THIẾU: field-registry (STARTUP_ONLY_FIELDS set + reloadable set)
// ❌ THIẾU: content-signature watcher (hash, compare, skip mtime-only)
// ❌ THIẾU: diff-applier (reloadable → apply nóng)
// ❌ THIẾU: restart-warning (startup-only đổi → cảnh báo)
```

## Implementation

```typescript
// packages/core/src/config-reload.ts (MỚI)
import { createHash } from 'node:crypto';

const STARTUP_ONLY_FIELDS = new Set([
  'bindAddress', 'transport', 'databasePath', 'port',
]);

type ApplyFn = (value: unknown) => void;

class ConfigHotReload {
  private signature: string = '';
  private appliers = new Map<string, ApplyFn>();
  constructor(
    private readConfig: () => Record<string, unknown>,
    private onStartupOnlyChange: (field: string) => void,
  ) {}

  register(field: string, apply: ApplyFn): void {
    if (STARTUP_ONLY_FIELDS.has(field)) return; // startup-only không register applier
    this.appliers.set(field, apply);
  }

  // check + reload nếu signature đổi
  reload(): { applied: string[]; needsRestart: string[] } {
    const raw = this.readConfig();
    const sig = createHash('sha256').update(JSON.stringify(raw)).digest('hex');
    if (sig === this.signature) return { applied: [], needsRestart: [] }; // no content change
    this.signature = sig;

    const applied: string[] = [];
    const needsRestart: string[] = [];
    for (const [field, value] of Object.entries(raw)) {
      if (STARTUP_ONLY_FIELDS.has(field)) { needsRestart.push(field); continue; }
      const apply = this.appliers.get(field);
      if (apply) { apply(value); applied.push(field); }
    }
    needsRestart.forEach(f => this.onStartupOnlyChange(f));
    return { applied, needsRestart };
  }
}

// Usage:
// reload.register('logLevel', v => logger.level = v);   // reloadable
// reload.register('retryCount', v => retry = v);         // reloadable
// bindAddress → STARTUP_ONLY → reload() cảnh báo "cần restart"
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Hot-reload an toàn (reloadable apply nóng) | ❌ Registry maintenance (mỗi field phải tag đúng) |
| ✅ Content-signature (touch/whitespace không trigger) | ❌ Startup-only frust (user đổi nhưng phải restart) |
| ✅ Restart-warning rõ (không silent-ignore startup field) | ❌ Hash cost (SHA mỗi check, dù nhỏ) |
| ✅ Không reload thừa (signature same → skip) | ❌ Partial-apply risk (một field fail → state lẫn lộn) |

## Khác các hướng gần

| | Restart-all config | mtime-watch reload | TY: Signature-Boundary |
|---|---|---|---|
| Cái gì | Đổi config → restart | mtime đổi → reload all | **Signature đổi → reload reloadable only** |
| Precision | ❌ (restart tất cả) | ❌ (touch = reload) | **✅ (diff per-field)** |
| Startup field | ✅ apply (restart) | ⚠ silent ignore | **⚠ warn "cần restart"** |

## Khi nào chọn

- Agent chạy long-lived daemon → muốn đổi config mà không restart
- Config có cả field nóng (log/model) và field cứng (bind/transport)
- Muốn reload chính xác (content-signature, không mtime-noise)
- Nối packages/core types.ts + redact.ts (secret không lộ trong diff) + packages/agent sdk.ts; guard registry correctness (tag field đúng khi thêm config mới), partial-apply rollback (field fail → revert), và restart-warning UX (clear signal cho user); TY = config hot-reload boundary, kết hợp 546 TZ harness-import-firewall (config boundary ngược — harness không leak app config)
