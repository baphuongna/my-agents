# Hướng UG: Harness Adapter Matrix — compliance matrix so cấu hình hooks/plugins/session giữa Claude/Codex/Cursor/Zed

> **Nguồn gốc:** ECC `docs/architecture/cross-harness.md` (cross-harness compliance matrix, hooks/plugins/session config comparison); "maintain compliance matrix across harnesses", "compare hooks/plugins/session config", "Claude vs Codex vs Cursor vs Zed" | **Coupling:** 🟢 — thêm compliance matrix doc + generator | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (harness context sẵn — chưa có cross-harness matrix + generator) | **Effort:** 2 tuần

## Nguồn gốc

**ECC** `docs/architecture/cross-harness.md` duy trì **compliance matrix** — bảng so sánh cấu hình giữa các coding harness (Claude Code, Codex CLI, Cursor, Zed). Mỗi **capability** (vd: hooks, plugins, session restore, MCP, permission, custom command) được đánh dấu **mỗi harness hỗ trợ thế nào**: ✅ native, ⚠️ partial/workaround, ❌ không hỗ trợ. Mục đích: khi port tính năng sang harness khác, biết ngay **capability gap** — harness nào thiếu gì, cần adapter nào. Matrix này sống như **living document** — cập nhật khi harness thay đổi. Nguyên tắc: **capability visibility** — không đoán mò, có bảng rõ ràng.

## Mô tả

mya harness adapter matrix: (1) **Capability catalog**: liệt kê capability (hooks, plugins, session, MCP, permission, command). (2) **Per-harness support**: mỗi capability × mỗi harness → ✅/⚠️/❌ + note. (3) **Gap analysis**: capability thiếu ở harness X → adapter cần thiết. (4) **Living doc**: `cross-harness.md` cập nhật khi harness/config thay. mya có harness context — UG thêm **capability-catalog** + **support-matrix** + **gap-analyzer** + **matrix-generator**.

## Kiến trúc

```
  COMPLIANCE MATRIX (capability × harness)
  ┌──────────────┬────────┬───────┬────────┬──────┐
  │ Capability   │ Claude │ Codex │ Cursor │ Zed  │
  ├──────────────┼────────┼───────┼────────┼──────┤
  │ hooks        │   ✅    │  ⚠️   │   ❌    │  ❌  │
  │ plugins      │   ✅    │  ✅   │   ⚠️    │  ❌  │
  │ session      │   ✅    │  ✅   │   ✅    │  ⚠️  │
  │ MCP          │   ✅    │  ✅   │   ✅    │  ✅  │
  │ permission   │   ✅    │  ⚠️   │   ⚠️    │  ❌  │
  └──────────────┴────────┴───────┴────────┴──────┘
        │ (gap analysis)
        ▼
  ┌─── ADAPTER PLAN ─────────────────────────────────────────┐
  │  Cursor thiếu hooks → cần external watcher adapter        │
  │  Zed thiếu permission → cần wrapper/CI gate               │
  │  Codex permission partial → cần config-layer enforcement   │
  └────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools permission.ts — permission (nền — UG matrix row)
// ✅ packages/agent sdk.ts — agent session (nền — UG session row)
// ✅ packages/skills — plugin/skill (nền — UG plugin row)
// ✅ packages/channels — transport (nền — UG harness mapping)

// ❌ THIẾU: capability-catalog (hooks/plugins/session/permission/...)
// ❌ THIẾU: support-matrix (capability × harness → ✅/⚠️/❌)
// ❌ THIẾU: gap-analyzer (thiếu → adapter cần)
// ❌ THIẾU: matrix-generator (markdown table → cross-harness.md)
```

## Implementation

```typescript
// packages/agent/src/harness-adapter-matrix.ts (MỚI)
type Support = 'native' | 'partial' | 'none';
const GLYPH: Record<Support, string> = { native: '✅', partial: '⚠️', none: '❌' };

interface CapabilityEntry { capability: string; harnesses: Record<string, { support: Support; note?: string }> }

class HarnessAdapterMatrix {
  constructor(private entries: CapabilityEntry[]) {}

  // generate markdown table → cross-harness.md
  toMarkdown(): string {
    const harnesses = Object.keys(this.entries[0].harnesses);
    const header = `| Capability | ${harnesses.join(' | ')} |`;
    const sep = `|---|${harnesses.map(() => '---').join('|')}|`;
    const rows = this.entries.map(e =>
      `| ${e.capability} | ${harnesses.map(h => `${GLYPH[e.harnesses[h].support]}${e.harnesses[h].note ? ' ' + e.harnesses[h].note : ''}`).join(' | ')} |`,
    );
    return [header, sep, ...rows].join('\n');
  }

  // gap analysis: capability thiếu (none/partial) → adapter
  gapAnalysis(): { capability: string; gaps: { harness: string; support: Support; adapter: string }[] }[] {
    return this.entries.map(e => {
      const gaps = Object.entries(e.harnesses)
        .filter(([, v]) => v.support !== 'native')
        .map(([h, v]) => ({ harness: h, support: v.support, adapter: v.support === 'none' ? 'external-wrapper' : 'config-layer' }));
      return { capability: e.capability, gaps };
    }).filter(g => g.gaps.length > 0);
  }
}

// Usage:
// const matrix = new HarnessAdapterMatrix([...]);
// fs.writeFileSync('docs/cross-harness.md', matrix.toMarkdown());
// matrix.gapAnalysis() → [{capability:'hooks', gaps:[{harness:'Cursor', support:'none', adapter:'external-wrapper'}]}]
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Capability visibility (biết gap ngay, không đoán) | ❌ Matrix maintenance (harness thay → cập nhật) |
| ✅ Adapter plan (gap → adapter cụ thể) | ❌ Harness version variance (mỗi version support khác) |
| ✅ Living doc (cross-harness.md auto-gen) | ❌ Subjective support rating (partial = ở đâu?) |
| ✅ Port roadmap (capability → harness → effort) | ❌ Niche harness coverage (matrix phình) |

## Khác các hướng gần

| | Per-harness docs | Ad-hoc comparison | UG: Adapter-Matrix |
|---|---|---|---|
| Cái gì | Doc từng harness riêng | So thủ công khi cần | **Structured matrix + gap analysis** |
| Gap visible | ❌ (phải đọc nhiều doc) | ⚠ | **✅ bảng rõ** |
| Auto-gen | ❌ | ❌ | **✅ markdown table** |

## Khi nào chọn

- Hỗ trợ đa harness → cần biết capability gap để port
- Muốn living doc (matrix auto-gen, không thủ công)
- Cần adapter roadmap (gap → adapter effort)
- Nối packages/tools permission.ts + packages/skills + packages/channels + packages/agent sdk.ts; guard matrix-freshness (review định kỳ khi harness update), support-rating-consistency (rõ tiêu chí native/partial/none), và harness-version-scope (note version range được đánh giá); UG = harness adapter matrix, kết hợp 552 UF mcp-inventory (MCP row trong matrix) + 546 TZ harness-import-firewall (harness boundary knowledge)
