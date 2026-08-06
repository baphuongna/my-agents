# Hướng MMMMMM: Skill Marketplace — phát hành/mua bán/dùng chung skill agent

> **Nguồn gốc:** Manus "Agent Skills open standard" (SKILL.md, one-click import); agent-skills.cc (63k+ skills); Agensi "Skill Store for AI Agents"; KDnuggets "Top 5 Agent Skill Marketplaces" (SkillsMP 425k+); Skywork "AI Skill Marketplace Guide"
> **Coupling:** 🟢 — thêm kênh nạp skill, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (skills package + registry + supply chain IIIIII sẵn; thiếu marketplace layer)
> **Effort:** 1-2 tuần

## Nguồn gốc

Skill marketplace: **nơi phát hành, khám phá, cài đặt skill agent tái dùng** — Manus: "the open Agent Skills standard — one-click import from anywhere, free to export — no vendor lock-in" (SKILL.md chuẩn mở); agent-skills.cc: "63,000+ Free AI Agent Skills... largest collection for Claude Code, Codex CLI, ChatGPT"; KDnuggets: SkillsMP "425,000+ skills" — hệ sinh thái đang nổ; Agensi: "Sell one-time skills or ship software as subscription" — có cả thương mại. Điểm khác **NNN tool registry** (danh mục tool nội bộ mya) và **AA tool maker** (agent tự viết tool) — MMMMMM *hệ sinh thái ngoài*: publish skill của mình (chuẩn mở SKILL.md), import skill người khác (1 click — Manus), có đánh giá/rating, version, publisher (nối IIIIII supply chain — ký + verify trước khi nạp). Khác registry: registry = nội bộ danh mục đã có; marketplace = kênh ngoài tìm/cài mới. Nối NNN (registry đích), IIIIII (verify skill từ ngoài), BBB (MCP — skill gọi external), FFFF (versioning skill), PP (eval skill trước khi dùng).

## Mô tả

mya marketplace: (1) **chuẩn mở** — skill = thư mục SKILL.md + script theo chuẩn Manus/Agent Skills (không vendor-lock); (2) **discovery** — tìm skill theo task/tag/rating từ marketplace (SkillsMP/agent-skills.cc hoặc self-host); (3) **verify trước khi nạp** — IIIIII: chữ ký publisher, hash, SBOM, đánh giá → mới cho nạp vào NNN registry; (4) **eval trước khi dùng** — PP: skill mới chạy test nhỏ trước khi dùng thật (tránh skill xấu hỏng việc); (5) **publish** — skill mya hay đóng gói publish (chuẩn mở, export tự do — Manus); (6) **vòng đời** — update skill từ marketplace có version (FFFF), thu hồi skill lỗi; (7) **chống** — skill không verify không nạp (IIIIII), skill "độc" trong thị trường mở — cần trust system (đánh giá + publisher identity).

## Kiến trúc

```
  MARKETPLACE (Manus/agent-skills.cc/SkillsMP — chuẩn mở SKILL.md)
        │ discover theo task/tag/rating
        ▼
  VERIFY (IIIIII): chữ ký publisher · hash · SBOM → mới được nạp
        │
        ▼
  EVAL TRƯỚC (PP): test nhỏ → đạt mới dùng thật
        │
        ▼
  NẠP vào NNN registry (nội bộ) — versioned (FFFF) · thu hồi được
        │
        ▼
  PUBLISH ngược: skill mya → đóng gói chuẩn mở (Manus — export tự do)
```

```
mya: skills + NNN + IIIIII SẸN — thiếu: marketplace client + verify + eval-before-install
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ skills package — SKILL.md rồi (chuẩn Manus tương thích)
// ✅ NNN tool registry — nơi nạp skill (đích)
// ✅ IIIIII supply chain — verify (chữ ký + hash) khi nạp từ ngoài
// ✅ FFFF versioning — skill có version
// ✅ PP eval — đánh giá trước khi dùng

// ❌ THIẾU: marketplace client (tìm/cài skill từ ngoài)
// ❌ THIẾU: eval-before-install gate (PP trước khi nạp)
// ❌ THIẾU: publish packager (đóng gói skill mya chuẩn mở)
```

## Implementation

```typescript
// packages/marketplace/src/client.ts (NEW)
export class MarketplaceClient {
  async search(task: string): Promise<Skill[]> {
    return this.mkt.list({ query: task, sort: "rating" }); // SkillsMP-style
  }
  async install(id: string, ctx: TrustCtx): Promise<Skill> {
    const s = await this.fetch(id);
    await this.verify(s);          // IIIIII — chữ ký/hash/SBOM
    await this.eval(s);            // PP — test nhỏ trước (tránh skill xấu)
    return registry.install(s);    // NNN — versioned (FFFF), thu hồi được
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không tự viết lại skill có sẵn (63k+ — agent-skills.cc) | ❌ Skill từ ngoài không verify = rủi ro (IIIIII bắt buộc) |
| ✅ Chuẩn mở (Manus) — không bị khóa vendor | ❐ Skill xấu/outdated — cần eval trước (PP) |
| ✅ Chia sẻ skill mya — đóng góp ngược cộng đồng | ❌ Thị trường mở nhiễu (425k skills — lọc khó) |
| ✅ Xây trên skills + NNN + IIIIII | ❌ Update theo marketplace — version rời rạc |

## Khác các hướng gần

| | NNN Registry | AA Tool Maker | MMMMMM: Marketplace |
|---|---|---|---|
| Phạm vi | Nội bộ (đã có) | Agent tự viết | **Kênh ngoài (cài mới)** |
| Mục đích | Danh mục | Sinh tool | **Khám phá + cài skill chuẩn mở** |
| Cần thêm | — | — | **Verify (IIIIII) + eval (PP) trước khi nạp** |

## Khi nào chọn

- Không muốn viết lại skill phổ biến (git/CI/code review...)
- Có skill hay muốn chia sẻ (publish chuẩn mở)
- Đã có skills + NNN + IIIIII — thêm marketplace client + eval-before-install
- Muốn mở rộng năng lực agent nhanh (1-click import — Manus)