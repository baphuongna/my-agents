# Hướng YN: Vendor-Grouped Skill Org — tổ chức skill theo nhóm vendor (Anthropic, Google Labs, Vercel, Stripe, Cloudflare...) giúp đánh giá độ tin cậy nguồn — taxonomy theo provenance (research.md)

> **Nguồn gốc:** awesome-agent-skills (research.md) | **Coupling:** 🟢 — taxonomy tổ chức, không đổi runtime | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có provenance + curator — chưa có vendor taxonomy) | **Effort:** 1 tuần

## Nguồn gốc

**awesome-agent-skills** tổ chức danh sách skill theo **nhóm vendor**: Anthropic, Google Labs, Vercel, Stripe, Cloudflare... — thay vì theo chức năng (coding, web, data). Lý do: **provenance là tiêu chí tin cậy** — skill từ team chính thức của Anthropic có độ tin cậy khác skill từ cá nhân; người dùng muốn đánh giá "skill này đáng tin không" trước khi xét "skill này làm gì". Taxonomy theo vendor giúp: (1) đánh giá độ tin cậy nguồn nhanh; (2) theo dõi một vendor ra nhiều skill ra sao; (3) phát hiện skill mạo danh vendor (fake official).

## Mô tả

mya áp dụng vendor-grouped-skill-org: skill store chia tầng theo **vendor** — `vendor: { name, official: boolean, url }` trong provenance. Thư mục/tag: `skills/@anthropic/*`, `skills/@google-labs/*`, `skills/@community/*`. Query: "skill nào của Anthropic?" → filter vendor; "vendor nào official?" → danh sách tổ chức đã xác minh (kèm domain/org check — nối 661 YK tinh thần verify). Dashboard hiển thị coverage theo vendor. Skill mới phải khai vendor; vendor chưa biết → `@community` tạm. Trust đánh giá theo vendor: official vendor skill được ưu tiên hiển thị, community cần review thêm. mya có sẵn skill.ts provenance (kind: source path / agentskills.io), curator (quản lý skill) — YN thêm **vendor schema** + **vendor index**.

## Kiến trúc

```
  Provenance: { kind: "github" | "agentskills.io" | ..., vendor: { name, official, url } }

  ORGANIZE:
    skills/
      @anthropic/      ← official (domain/org đã xác minh)
      @google-labs/
      @vercel/
      @stripe/
      @cloudflare/
      @community/      ← chưa xác minh / cá nhân

  QUERY:
    theo vendor  → "skill Anthropic nào?" → filter vendor.name
    trust filter → official vendor → hiển thị ưu tiên
                   community → cần review badge (663 YM)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills skill.ts — SkillProvenance (nền — YN thêm vendor field)
// ✅ packages/skills curator.ts — load skill từ dir (nền — YN organize theo vendor)
// ✅ packages/skills index — index skill (nền — YN vendor index phụ)
// ✅ packages/skills curator.ts provenance audit (nền — YN verify official)

// ❌ THIẾU: vendor schema (name/official/url trong provenance)
// ❌ THIẾU: vendor index + trust filter
```

## Implementation (TS)

```typescript
// packages/skills/src/vendor-org.ts (MỚI)
export interface Vendor {
  name: string;      // "Anthropic"
  official: boolean; // đã xác minh tổ chức chính thức
  url: string;       // "https://anthropic.com"
}

export interface VendorSkill {
  skill: string;
  vendor: Vendor;
}

const OFFICIAL_DOMAINS = new Set(["anthropic.com", "google.com", "vercel.com", "stripe.com", "cloudflare.com"]);

export class VendorIndex {
  private byVendor = new Map<string, VendorSkill[]>();

  add(skill: string, vendor: Vendor): void {
    const list = this.byVendor.get(vendor.name) ?? [];
    list.push({ skill, vendor });
    this.byVendor.set(vendor.name, list);
  }

  /** Verify official: url domain thuộc danh sách tổ chức chính thức. */
  static isOfficial(url: string): boolean {
    try {
      const host = new URL(url).hostname;
      return OFFICIAL_DOMAINS.has(host) || host.endsWith(".official");
    } catch { return false; }
  }

  listByVendor(name: string): VendorSkill[] {
    return this.byVendor.get(name) ?? [];
  }

  /** Trust filter: official trước, community sau (kèm badge 663 YM). */
  trusted(vendor: Vendor): number {
    return vendor.official ? 2 : 1; // 2 = ưu tiên, 1 = cần review thêm
  }

  summary(): string {
    return [...this.byVendor.entries()]
      .map(([v, skills]) => `${v} (${skills[0]?.vendor.official ? "official" : "community"}): ${skills.length} skills`)
      .join("\n");
  }
}

// Usage:
// const idx = new VendorIndex();
// idx.add("claude-skills", { name: "Anthropic", official: VendorIndex.isOfficial("https://anthropic.com"), url: "https://anthropic.com" });
// idx.listByVendor("Anthropic"); // → [claude-skills]
// idx.trusted(v) === 2;          // official ưu tiên hiển thị
```

## Được

- ✅ Tin cậy theo nguồn — official vendor rõ ràng, community minh bạch
- ✅ Taxonomies theo provenance — không lẫn lộn chất lượng các nguồn
- ✅ Verify official bằng máy — domain/org check, chống mạo danh
- ✅ Query theo vendor — "skill của X?" trả lời ngay
- ✅ Trust filter — official ưu tiên, community review thêm

## Mất

- ❌ Vendor chết — tổ chức đổi tên/đóng → taxonomy cũ
- ❌ Domain check hời — vendor official qua domain phụ (community) bị nhầm
- ❌ Chồng lấn — skill multi-vendor (fork, contribution) khó xếp 1 vendor

## Khác các hướng gần

| | Taxonomy theo chức năng | Tag tự do | YN: Vendor Group |
|---|---|---|---|
| Tiêu chí | làm gì | tùy ý | **ai làm (provenance)** |
| Tin cậy | không phản ánh | không | **official/community rõ** |
| Query | theo chức năng | tag | **theo vendor** |

## Khi nào chọn

- Skill store có nhiều nguồn (Anthropic, community...) cần phân tầng tin cậy
- Muốn user/agent đánh giá "skill đáng tin không" trước khi dùng
- Có provenance + curator sẵn — YN thêm vendor schema + index
- Nối packages/skills skill.ts (provenance → vendor) + curator.ts (organize) + 663 YM (badge bổ trợ trust); guard vendor-death (vendor đổi tên — cron re-check url), domain-spoof (official chỉ qua domain chính thức, không subdomain lạ), và multi-vendor (skill fork → primary vendor + contributors list); YN = vendor org, kết hợp 663 YM badge-category-curation (badge + vendor) + 664 YO companion-list-pattern (mỗi vendor/lớp một danh sách)
