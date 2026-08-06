# Hướng XG: Deterministic DB Lookup — database-lookup: catalog 78 DB với retrieval contract (filter server-side vs local), paginate tới khi count reconcile

> **Nguồn gốc:** scientific-agent-skills (database-lookup skill); "catalog 78 databases", "retrieval contract — filter server-side vs local", "paginate until count reconcile" | **Coupling:** 🟡 — thêm DB-lookup skill với deterministic pagination | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (skills + web-fetch sẵn — chưa có DB catalog + count-reconcile contract) | **Effort:** 3-4 tuần

## Nguồn gốc

**scientific-agent-skills** cung cấp skill **database-lookup** với **catalog 78 database** khoa học (PubMed, UniProt, ChemBL, PDB, ...). Mỗi DB có **retrieval contract** chỉ rõ: **filter nào chạy server-side** (DB hỗ trợ → đẩy query lên, trả đúng subset) vs **filter nào local** (DB không hỗ trợ → fetch về rồi filter trong code). Vấn core: **pagination phải reconcile count** — trang đầu trả `total_count` (server báo N kết quả), engine paginate đến khi **số kết quả thu về == total_count** (không thừa thiếu) → **deterministic** (lấy đủ, không cắt sớm). Nguyên tắc: **contract rõ + count reconcile** — không phụ thuộc model đoán số trang, lấy đủ theo total server.

## Mô tả

mya deterministic DB lookup: skill `database_lookup(db, query, filters)` — (1) chọn DB từ catalog 78. (2) theo contract: server-filter (đẩy lên) + local-filter (sau fetch). (3) paginate tới khi số row thu về == total_count (reconcile). mya có skills + web-fetch — XG thêm **DB catalog** + **server/local-filter contract** + **count-reconcile pagination**.

## Kiến trúc

```
  ┌─── CATALOG (78 DB, mỗi DB có contract) ──────────────┐
  │  pubmed:  { serverFilters:["term","date"], local:["author"] } │
  │  uniprot: { serverFilters:["query"], local:["length"] }      │
  │  ...                                                      │
  └───────────────────────┬───────────────────────────────────┘
                          │
                          ▼
  ┌─── BUILD QUERY (theo contract) ──────────────────────┐
  │  user filters: { term:"cancer", author:"Smith" }       │
  │  contract: term=server, author=local                    │
  │  → server-query: term=cancer (đẩy lên)                  │
  │  → local-pending: author=Smith (filter sau)             │
  └───────────────────────┬───────────────────────────────┘
                          │
                          ▼
  ┌─── PAGINATE + COUNT RECONCILE ───────────────────────┐
  │  page 1: fetch server-query → { rows:[...], total:342 }│  ← server báo 342
  │  page 2..N: paginate đến khi len(rows) == 342           │  ← reconcile
  │  → rows đủ 342                                          │
  └───────────────────────┬───────────────────────────────┘
                          │
                          ▼
  ┌─── LOCAL FILTER (trong code, sau fetch đủ) ──────────┐
  │  rows(342) → filter author=Smith → rows(12)            │  ← local (DB không hỗ trợ)
  └─────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/skills skill.ts — skill (nền — XG database-lookup skill)
// ✅ packages/skills curator.ts — skill resolve (nền — XG catalog lookup)
// ✅ 630 XF pluggable-web-providers — web_fetch (relate — XG fetch DB API)

// ❌ THIẾU: DB catalog (78 DB + contract)
// ❌ THIẾU: server/local-filter split (contract)
// ❌ THIẾU: count-reconcile pagination
```

## Implementation

```typescript
// packages/skills/src/db-lookup.ts (MỚI)
interface DbContract { serverFilters: string[]; localFilters: string[]; endpoint: (q: Record<string,string>, page:number, size:number) => string }
interface FetchResult { rows: Record<string, unknown>[]; total: number }

const CATALOG = new Map<string, DbContract>(); // 78 DB
function registerDb(name: string, c: DbContract): void { CATALOG.set(name, c); }

async function databaseLookup(
  db: string, filters: Record<string, string>, fetchPage: (url: string) => Promise<FetchResult>,
): Promise<Record<string, unknown>[]> {
  const contract = CATALOG.get(db);
  if (!contract) throw new Error(`unknown db: ${db}`);
  // split filter: server (đẩy lên) vs local (filter sau)
  const serverQuery: Record<string, string> = {};
  const localPending: Record<string, string> = {};
  for (const [k, v] of Object.entries(filters)) {
    if (contract.serverFilters.includes(k)) serverQuery[k] = v;
    else localPending[k] = v; // DB không hỗ trợ → local
  }
  // paginate + count reconcile
  const PAGE = 50; let page = 1; const all: Record<string, unknown>[] = []; let total = Infinity;
  while (all.length < total) {
    const res = await fetchPage(contract.endpoint(serverQuery, page++, PAGE));
    total = res.total; // server báo
    all.push(...res.rows);
  } // reconcile: len(all) == total
  // local filter (sau fetch đủ)
  return all.filter((row) => Object.entries(localPending).every(([k, v]) => String(row[k]) === v));
}

// Usage:
// registerDb("pubmed", { serverFilters:["term","date"], localFilters:["author"], endpoint: buildPubMedUrl });
// const rows = await databaseLookup("pubmed", { term:"cancer", author:"Smith" }, fetchPage);
// → paginate đến total reconcile, rồi local-filter author
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Deterministic (count reconcile, lấy đủ) | ❌ Large result cost (342 row = nhiều fetch) |
| ✅ Contract rõ (server vs local filter) | ❌ Contract maintenance (78 DB, mỗi DB rule khác) |
| ✅ Server-filter hiệu quả (đẩy query lên) | ❌ Server inconsistency (total đổi giữa trang) |
| ✅ Catalog 78 DB (coverage rộng) | ❌ Rate-limit per-DB (mỗi API limit khác) |

## Khác các hướng gần

| | Single-page fetch | Best-effort paginate | XG: DB-Lookup-Reconcile |
|---|---|---|---|
| Đủ data | ❌ (cắt trang 1) | ⚠️ | **✅ count reconcile** |
| Filter | all local | mixed ad-hoc | **✅ contract (server/local)** |
| Catalog | 1 | 1 | **✅ 78 DB** |

## Khi nào chọn

- Cần truy vấn nhiều DB khoa học với kết quả đầy đủ (không cắt sớm)
- Cần contract rõ (đâu server-filter, đâu local) để deterministic
- Nối packages/skills skill.ts + curator.ts + 630 XF pluggable-web-providers (fetch DB API); guard total-drift (total đổi giữa trang → re-baseline + warn), server-filter-validation (verify filter thực server-side, không silent local), và pagination-deadline (cap trang tối đa, không paginate vô hạn); XG = deterministic DB lookup, kết hợp 630 XF (fetch backend) + 620 WV outcome-collector-parser-validator (parser typed data từ DB row)
