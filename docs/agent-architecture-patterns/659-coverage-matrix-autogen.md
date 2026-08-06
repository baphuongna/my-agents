# Hướng YI: Coverage Matrix Autogen — ATTACK_COVERAGE.md sinh tự động map 291 technique ATT&CK → danh sách skill, hiện coverage gap theo tactic để ưu tiên phát triển (ATTACK_COVERAGE.md)

> **Nguồn gốc:** Anthropic-Cybersecurity-Skills (ATTACK_COVERAGE.md) | **Coupling:** 🟢 — file sinh tự động từ mapping, không đổi runtime | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có skill index + curator — chưa có matrix generator) | **Effort:** 1-2 tuần

## Nguồn gốc

**Anthropic-Cybersecurity-Skills** sinh **ATTACK_COVERAGE.md** tự động: map toàn bộ **291 technique ATT&CK** → danh sách skill cover từng technique (dữ liệu từ frontmatter mapping — 658 YH). File hiển thị **coverage gap theo tactic** (Reconnaissance, Initial Access, Execution...) — tactic nào ít skill cover là biết ngay. File **không viết tay**: script đọc skill frontmatter + framework index → sinh markdown. Mục đích: coverage là **số đo sống**, mỗi skill mới chạy lại script là cập nhật — và gap theo tactic định hướng **ưu tiên phát triển skill kế tiếp**.

## Mô tả

mya áp dụng coverage-matrix-autogen: script `generate-coverage.mjs` đọc toàn bộ skill (frontmatter frameworks — 658 YH) + danh sách technique ATT&CK (từ 661 YK verified) → sinh bảng: mỗi tactic một section, mỗi technique liệt kê skill cover + trạng thái `✅ covered` / `⚠️ partial` (skill map nhưng mô tả không khớp keyword) / `❌ gap`. Chạy trong CI (nối 670 YT cron) — file commit mỗi khi skill thay đổi. Gap theo tactic → gợi ý skill cần viết tiếp (ưu tiên tactic ít cover nhất). mya có sẵn skills curator (liệt kê skill), skill-description (mô tả), scripts/ (chạy script) — YI thêm **matrix generator** + **tactic gap ranking**.

## Kiến trúc

```
  skills/*/SKILL.md (frontmatter frameworks — 658 YH)
                    │
                    ▼
  generate-coverage.mjs ──► ATTACK_COVERAGE.md
                    │
  mitreattack techniques (291, verify — 661 YK)
                    │
                    ├─ per tactic (Recon, Initial Access, ...):
                    │    technique → skill[] + status
                    │      ✅ covered  (≥1 skill map)
                    │      ⚠️ partial  (skill map nhưng keyword lệch)
                    │      ❌ gap      (0 skill)
                    │
                    └─ gap ranking: tactic ít cover nhất → ưu tiên viết skill
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills curator.ts — đọc mọi skill từ dir (nền — YI input)
// ✅ packages/skills skill.ts — frameworks field (nền — YI data source, sau 658 YH)
// ✅ packages/skills skill-description.ts — mô tả skill (nền — YI keyword so khớp)
// ✅ scripts/ — runner script (nền — YI generate-coverage.mjs)
// ✅ packages/cron — chạy định kỳ (nền — YI regenerate mỗi đêm)

// ❌ THIẾU: matrix generator (tactic → technique → skill table)
// ❌ THIẾU: gap ranking (tactic ít cover → ưu tiên)
```

## Implementation (TS)

```typescript
// packages/skills/src/coverage-matrix.ts (MỚI)
export interface Technique { id: string; tactic: string; name: string; } // "T1566.001" | "Initial Access"
export type CoverageStatus = "covered" | "partial" | "gap";
export interface CoverageRow { technique: Technique; skills: string[]; status: CoverageStatus; }

export class CoverageMatrix {
  constructor(
    private techniques: Technique[],
    private skillMaps: Array<{ skill: string; ids: string[]; desc: string }>,
  ) {}

  build(): CoverageRow[] {
    return this.techniques.map((t) => {
      const matched = this.skillMaps.filter((s) => s.ids.includes(t.id));
      const status: CoverageStatus =
        matched.length === 0 ? "gap"
        : matched.some((m) => m.desc.toLowerCase().includes(t.name.toLowerCase())) ? "covered"
        : "partial";
      return { technique: t, skills: matched.map((m) => m.skill), status };
    });
  }

  toMarkdown(rows: CoverageRow[]): string { // autogen — commit mỗi khi skill đổi
    const out = ["# ATT&CK Coverage (autogen)", ""];
    const byTactic = new Map<string, CoverageRow[]>();
    for (const r of rows) {
      const list = byTactic.get(r.technique.tactic) ?? [];
      list.push(r);
      byTactic.set(r.technique.tactic, list);
    }
    for (const [tactic, list] of byTactic) {
      out.push(`## ${tactic}`, "");
      for (const r of list) {
        const mark = r.status === "covered" ? "✅" : r.status === "partial" ? "⚠️" : "❌";
        out.push(`| ${mark} | ${r.technique.id} | ${r.technique.name} | ${r.skills.join(", ") || "—"} |`);
      }
      out.push("");
    }
    return out.join("\n");
  }

  rankGaps(rows: CoverageRow[]): Array<{ tactic: string; gapCount: number }> {
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (r.status === "gap") counts.set(r.technique.tactic, (counts.get(r.technique.tactic) ?? 0) + 1);
    }
    return [...counts.entries()].map(([tactic, gapCount]) => ({ tactic, gapCount })).sort((a, b) => b.gapCount - a.gapCount);
  }
}

// Usage:
// const matrix = new CoverageMatrix(attck291, skillMaps);
// const rows = matrix.build();
// writeFile("ATTACK_COVERAGE.md", matrix.toMarkdown(rows));
// const gaps = matrix.rankGaps(rows); // → Initial Access 23 gap → viết skill đó trước
```

## Được

- ✅ Sinh tự động — không viết tay, không stale (chạy lại mỗi skill mới)
- ✅ Coverage theo tactic — gap hiện rõ, ưu tiên phát triển có dữ liệu
- ✅ 3 trạng thái — covered/partial/gap phân biệt mức độ thật

## Mất

- ❌ Phụ thuộc mapping chuẩn — 658 YH map sai → matrix sai (cần 661 YK)
- ❌ Status heuristic — "partial" đo bằng keyword dễ lệch
- ❌ File lớn — 291 technique × 14 tactic, markdown dài cần chia

## Khác các hướng gần

| | Coverage doc viết tay | Skill index đơn giản | YI: Matrix Autogen |
|---|---|---|---|
| Cập nhật | tay (stale) | load động | **sinh tự động + commit** |
| Gap | không thấy | không | **theo tactic + ranking** |
| Status | có/không | chỉ tên skill | **covered/partial/gap** |

## Khi nào chọn

- Muốn coverage security skill là số đo sống, không doc tay
- Cần ưu tiên phát triển skill theo gap tactic (không viết theo cảm hứng)
- Có skill curator + scripts + cron sẵn — YI thêm generator + ranking
- Nối packages/skills curator.ts (liệt kê skill) + skill.ts (frameworks — 658 YH) + scripts/ (chạy) + cron (regenerate đêm); guard data-validity (technique ID từ nguồn verify — 661 YK), heuristic-drift (partial keyword calibrate bằng golden set), và commit-hook (file sinh phải commit cùng skill change — CI check); YI = coverage matrix, kết hợp 658 YH multi-framework-mapping (nguồn data) + 661 YK verified-framework-ids (ID chuẩn) + 670 YT cron-auto-curation (chạy định kỳ)
