# Hướng YK: Verified Framework IDs — mọi technique ID (ATT&CK v19.1 754/754, F3 123/123) được verify bằng mitreattack-python chống ID revoked/deprecated — data mapping phải máy kiểm, không phải người (README.md)

> **Nguồn gốc:** Anthropic-Cybersecurity-Skills (README.md) | **Coupling:** 🟢 — verify step, không đổi runtime | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có osv-check + skill parser — chưa có ID verifier) | **Effort:** 1-2 tuần

## Nguồn gốc

**Anthropic-Cybersecurity-Skills** xác nhận mọi technique ID trong skill frontmatter được verify bằng **mitreattack-python** chống lại dataset chuẩn: **ATT&CK v19.1 — 754/754 technique ID hợp lệ**, **F3 — 123/123 hợp lệ**. Lý do: ID framework (T1566.001, F3.A.1) dễ gõ sai, dễ dùng ID **revoked** (đã bị MITRE gộp/đổi) hoặc **deprecated** — nếu người viết tự kiểm bằng mắt thì sót. Nguyên tắc: **data mapping phải máy kiểm, không phải người** — verify tự động trong pipeline, ID sai/revoked bị chặn hoặc cảnh báo trước khi skill vào thư viện.

## Mô tả

mya áp dụng verified-framework-ids: pipeline skill mới (hoặc skill edit) chạy **ID verifier**: (1) extract mọi technique ID từ frontmatter (658 YH frameworks field); (2) so với dataset chuẩn (ATT&CK/F3 JSON hoặc qua mitreattack-python subprocess — mya là TS nên dùng npx/python bridge hoặc dataset file); (3) phân loại: `valid` / `revoked` (từng tồn tại, đã gộp) / `deprecated` (còn nhưng khuyến cáo bỏ) / `unknown` (sai format); (4) revoked/unknown → **block skill entry**; deprecated → warning + đề nghị ID thay thế. Kết quả verify ghi vào provenance skill (ai verify lúc nào). mya có sẵn skills/skill.ts (frontmatter parse), osv-check (quét dependency security), tools (chạy script) — YK thêm **ID verifier** + **block/warn rule**.

## Kiến trúc

```
  Skill frontmatter frameworks (658 YH):
    mitre_attack: [T1566.001, T1110.001]
    mitre_f3:     [F3.A.1, F3.X.99]

  ID VERIFIER (mitreattack dataset / script):
    ├─ T1566.001 → valid ✅
    ├─ T1110.001 → revoked (gộp vào T1110) ⛔ BLOCK
    ├─ F3.A.1    → valid ✅
    └─ F3.X.99   → unknown format ⛔ BLOCK

  Rule: revoked/unknown → block skill entry
        deprecated → warn + đề nghị thay thế
        valid      → pass, ghi provenance
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills skill.ts — parse frontmatter frameworks (nền — YK input)
// ✅ packages/tools osv-check.ts — quét dependency theo dataset (nền — YK analog verify)
// ✅ packages/skills curator.ts — pipeline đánh giá skill (nền — YK chạy trong curator)
// ✅ packages/tools codeexec.ts — chạy python/mitreattack nếu cần (nền — YK bridge)

// ❌ THIẾU: ID verifier (so dataset chuẩn, phân loại valid/revoked/deprecated/unknown)
// ❌ THIẾU: block/warn rule (revoked → block entry, deprecated → warn)
```

## Implementation (TS)

```typescript
// packages/skills/src/verify-ids.ts (MỚI)
export type IdStatus = "valid" | "revoked" | "deprecated" | "unknown";

export interface IdVerdict {
  id: string;
  status: IdStatus;
  replacement?: string; // cho revoked/deprecated
}

export interface FrameworkDataset {
  valid: Set<string>;
  revoked: Map<string, string>;    // id → replacement
  deprecated: Map<string, string>; // id → replacement
}

export function verifyIds(ids: string[], ds: FrameworkDataset): IdVerdict[] {
  return ids.map((id) => {
    if (ds.valid.has(id)) return { id, status: "valid" };
    const r = ds.revoked.get(id);
    if (r) return { id, status: "revoked", replacement: r };
    const d = ds.deprecated.get(id);
    if (d) return { id, status: "deprecated", replacement: d };
    return { id, status: "unknown" };
  });
}

/** Rule: revoked/unknown → block; deprecated → warn. */
export function gateIds(verdicts: IdVerdict[]): { pass: boolean; notes: string[] } {
  const notes: string[] = [];
  let pass = true;
  for (const v of verdicts) {
    if (v.status === "revoked" || v.status === "unknown") {
      pass = false;
      notes.push(`⛔ ${v.id} (${v.status})${v.replacement ? ` → dùng ${v.replacement}` : ""}`);
    } else if (v.status === "deprecated") {
      notes.push(`⚠️ ${v.id} deprecated → ${v.replacement}`);
    }
  }
  return { pass, notes };
}

// Usage:
// const ds = loadDataset("data/attck-v19.1.json"); // hoặc gọi mitreattack-python
// const verdicts = verifyIds(skill.frameworks.mitre_attack ?? [], ds);
// const g = gateIds(verdicts);
// g.pass || blockSkillEntry(skill.name, g.notes); // máy kiểm, không phải người
```

## Được

- ✅ ID chính xác máy tính — không sót revoked/typo như người kiểm
- ✅ Dataset chuẩn — ATT&CK v19.1/F3 đầy đủ, version rõ
- ✅ Block cứng — skill ID sai không vào thư viện
- ✅ Deprecated có hướng — đề nghị replacement ngay
- ✅ Provenance — verify ghi vào skill, audit được

## Mất

- ❌ Dataset phải cập nhật — ATT&CK release mới phải tải lại (cần cron)
- ❌ Bridge cost — mitreattack-python là Python, mya TS cần subprocess/JSON
- ❌ Chặn nhầm — ID mới chưa có trong dataset cũ → unknown → block oan

## Khác các hướng gần

| | Kiểm tay (người đọc) | Regex format check | YK: Dataset Verify |
|---|---|---|---|
| Revoked | sót | không bắt | **bắt + replacement** |
| Version | không rõ | không | **ATT&CK v19.1 rõ ràng** |
| Cưỡng chế | khuyên | warn | **block entry** |

## Khi nào chọn

- Skill mapping framework (658 YH) mà ID sai sẽ làm coverage/compliance sai
- Muốn pipeline chặn ID revoked/deprecated tự động
- Có skill parser + curator + osv-check sẵn — YK thêm verifier + gate
- Nối packages/skills skill.ts (extract ID) + curator.ts (chạy trong pipeline) + osv-check.ts (pattern dataset check) + cron (refresh dataset); guard dataset-version (ghi version dataset vào provenance), fresh-data (ATT&CK mới → tải lại, không verify bằng data cũ), và false-block (ID hợp lệ ngoài dataset → whitelist + report); YK = verified IDs, kết hợp 658 YH multi-framework-mapping (ID source) + 659 YI coverage-matrix-autogen (matrix dùng ID đã verify)
