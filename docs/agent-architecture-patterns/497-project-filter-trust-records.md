# Hướng SC: Project Filter Trust Records — filter DSL trong repo .hypa/, phải cấp trust tường minh

> **Nguồn gốc:** hypa (project-local filter DSL); ".hypa/ filter rules"; "repo-scoped context filter require explicit trust"; "filter DSL trust grant records"; "untrusted filter rules ignored until approved"
> **Coupling:** 🟡 — thêm trust-gate trước khi áp dụng filter DSL từ repo (load → check trust → apply/ignore)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (packages/ai compressor + config loader sẵn — chưa có .hypa/ DSL parser + trust record store)
> **Effort:** 2-3 tuần

## Nguồn gốc

**hypa** cho phép mỗi repo định nghĩa **filter DSL** trong `.hypa/` (ví dụ `.hypa/filters.yaml` — rule nén/ẩn field nào, prune pattern nào). Đây là **code tùy biến từ repo** (giống như `.editorconfig` hay `tsconfig` nhưng cho context-filter). Nguy cơ: **repo độc hại** có thể đặt filter DSL **ẩn/giấu** thông tin quan trọng (prune security field, ẩn error) → agent nhìn sai. **hypa** yêu cầu **explicit trust**: filter DSL chỉ áp dụng khi user **cấp trust tường minh** (trust record: user duyệt `.hypa/` → ghi `trusted`). Nguyên tắc: **repo filter = code không tin cậy** cho tới khi trust — giống plugin permission, không tự apply. Khác **100 prompt-compression** (filter built-in, tin cậy) — SC là **repo-supplied DSL + trust gate**.

## Mô tả

mya project filter trust records: (1) **Load DSL**: phát hiện `.hypa/filters.yaml` trong repo → parse rule (prune field X, summarize section Y). (2) **Trust gate**: check trust record store — repo này đã được user duyệt chưa? (3) **Apply nếu trusted**: trust=true → áp dụng filter DSL (nén theo rule repo). (4) **Ignore nếu untrusted**: trust=false → **bỏ qua** DSL (dùng built-in filter an toàn) + **warn** user "repo có .hypa/ chưa trust — duyệt để apply". (5) **Trust grant**: user chạy `mya trust-filters .` → ghi trust record (repo path + hash DSL → trusted). (6) **Hash pin**: trust record pin hash DSL — nếu DSL đổi sau trust → **re-prompt** (trust hết hạn). mya có compressor + config loader — SC thêm **`.hypa/` parser** + **trust record store** + **hash pin**.

## Kiến trúc

```
  REPO có .hypa/filters.yaml:
  ┌─────────────────────────────────────────────────────┐
  │  .hypa/filters.yaml:                                 │
  │    prune: [secret, token]                            │
  │    summarize: [test-output]                          │
  │    dsl-hash: a3f9...                                  │
  └───────────────┬─────────────────────────────────────┘
                  │ load
                  ▼
  ┌─── TRUST GATE ──────────────────────────────────────┐
  │  trust-record store: repo "/proj" → trusted?         │
  │  check: record.repo == "/proj" && record.hash == a3f9│
  └───────────┬───────────────────┬─────────────────────┘
              │ trusted            │ untrusted / hash mismatch
              ▼                    ▼
  ┌─── APPLY DSL ──────────┐  ┌─── IGNORE + WARN ──────────┐
  │  prune secret/token     │  │  dùng built-in filter       │
  │  summarize test-output  │  │  WARN: ".hypa/ chưa trust   │
  │  (rule repo áp dụng)     │  │   — mya trust-filters . để  │
  └─────────────────────────┘  │   apply"                    │
                                └────────────────────────────┘
  TRUST GRANT: mya trust-filters .  → ghi { repo, hash, trusted: true }
  HASH PIN: DSL đổi → hash mismatch → re-prompt trust
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/ai — compressor (nền — SC áp dụng DSL lên trên)
// ✅ config loader — load repo config (nền — SC load .hypa/)
// ✅ 466 context-citation — provenance (gần — SC = trust cho filter source)

// ❌ THIẾU: .hypa/ DSL parser (parse filter rule từ repo)
// ❌ THIẾU: trust record store (repo path + hash → trusted)
// ❌ THIẾU: trust gate (check record trước apply DSL)
// ❌ THIẾU: hash pin (DSL đổi → re-prompt trust)
```

## Implementation

```typescript
// packages/ai/src/project-filter-trust.ts (MỚI)
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

interface FilterDsl { prune: string[]; summarize: string[]; hash: string }
interface TrustRecord { repo: string; hash: string; trusted: boolean; at: number }

class ProjectFilterTrust {
  private records = new Map<string, TrustRecord>(); // key = repo path

  // load + check trust → apply hoặc ignore
  resolve(repoDir: string): { dsl: FilterDsl | null; applied: boolean; reason: string } {
    const dslPath = join(repoDir, '.hypa', 'filters.yaml');
    if (!existsSync(dslPath)) return { dsl: null, applied: false, reason: 'no .hypa/' };
    const raw = readFileSync(dslPath, 'utf8');
    const dsl = parseDsl(raw);
    const record = this.records.get(repoDir);
    if (!record || record.hash !== dsl.hash) {
      return { dsl, applied: false, reason: record ? 'dsl changed — re-trust needed' : 'not trusted' };
    }
    if (!record.trusted) return { dsl, applied: false, reason: 'explicitly denied' };
    return { dsl, applied: true, reason: 'trusted' };
  }

  // user grant trust (mya trust-filters .)
  grantTrust(repoDir: string): void {
    const dslPath = join(repoDir, '.hypa', 'filters.yaml');
    if (!existsSync(dslPath)) throw new Error('no .hypa/filters.yaml');
    const raw = readFileSync(dslPath, 'utf8');
    const hash = createHash('sha256').update(raw).digest('hex').slice(0, 16);
    this.records.set(repoDir, { repo: repoDir, hash, trusted: true, at: Date.now() });
  }
}

function parseDsl(raw: string): FilterDsl {
  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 16);
  const m = { prune: [] as string[], summarize: [] as string[] };
  // minimal YAML-ish parse (production: proper YAML parser)
  for (const line of raw.split('\n')) {
    const p = line.match(/^\s*prune:\s*\[(.*)\]/); if (p) m.prune = p[1].split(',').map(s => s.trim());
    const s = line.match(/^\s*summarize:\s*\[(.*)\]/); if (s) m.summarize = s[1].split(',').map(x => x.trim());
  }
  return { ...m, hash };
}

// Usage:
// const r = trust.resolve('/proj');
// if (r.applied) → apply r.dsl (prune secret, summarize test)
// else → WARN r.reason + dùng built-in filter
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Repo tùy biến filter (DSL per-project) | ❌ Trust friction (user phải duyệt trước apply) |
| ✅ Anti-malicious (repo độc hại không ẩn được — untrusted) | ❌ Hash pin drift (DSL đổi → re-prompt, phiền) |
| ✅ Explicit consent (tường minh, audit được) | ❌ DSL parser (cần YAML parser an toàn) |
| ✅ Phối 466 citation (trust cho filter source) | ❌ Trust store (per-repo record quản lý) |

## Khác các hướng gần

| | 100 Prompt-Compression | Plugin Permission | SC: Filter-Trust |
|---|---|---|---|
| Filter source | Built-in (tin cậy) | Plugin code | **Repo `.hypa/` DSL** |
| Trust | Luôn apply | Cấp permission | **Explicit trust record** |
| Đổi rule | Build-time | Reload | **Hash pin → re-prompt** |

## Khi nào chọn

- Muốn mỗi repo tùy biến filter (DSL per-project, không hardcode)
- Bảo mật: repo filter là code không tin cậy → cần explicit trust
- Muốn audit (trust record: ai duyệt cái gì, khi nào)
- Nối packages/ai (compressor) + config loader; guard DSL parser safety (không RCE qua YAML) + hash pin (đổi → re-prompt) + trust store (per-repo, audit); warn rõ khi ignore (user biết DSL tồn tại nhưng chưa trust)
