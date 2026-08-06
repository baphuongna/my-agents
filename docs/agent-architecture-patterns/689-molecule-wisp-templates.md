# Hướng ZM: Molecule-Wisp Templates — workflow template "proto" có variable {{name}} instantiate thành mol (persistent, audit được) hoặc wisp (ephemeral, tự burn/squash) — phân loại artifact theo vòng đời
> **Nguồn gốc:** beads (MOLECULES.md qua research.md) | **Coupling:** 🟢 — template instantiation + lifecycle tag | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (workflows runner + skills — chưa có proto/mol/wisp lifecycle) | **Effort:** 1-2 tuần

## Nguồn gốc

**beads** dùng **workflow template "proto"** — mẫu có biến `{{name}}` (vd `{{project}}-sprint`). Template **instantiate** (điền biến) thành 2 loại artifact với **vòng đời khác nhau**: (1) **mol** — **persistent**, audit được, sống lâu (vd sprint thật, project thật — cần lịch sử, cần truy vết); (2) **wisp** — **ephemeral**, tự **burn/squash** (vd thử nghiệm, scratch — dùng xong tự xóa, không để lại rác). Cùng 1 template nhưng quyết định vòng đời khi instantiate: **mol khi cần giữ, wisp khi chỉ dùng tạm**. Nguyên tắc: **phân loại artifact theo vòng đời ngay từ lúc instantiate**.

## Mô tả

mya molecule-wisp templates: (1) **Proto template** — markdown/JSON có `{{var}}` placeholder + meta lifecycle default. (2) **Instantiate** — điền biến → tạo artifact; chọn mode **mol** (persistent store + audit) hoặc **wisp** (ephemeral + burn policy). (3) **Wisp burn** — wisp hết hạn/tự squash (sau N ngày hoặc khi task xong). (4) **Mol audit** — mol giữ vĩnh viễn, ghi audit mọi thay đổi. mya có workflows/runner.ts + skills/skill.ts + memory store — ZM thêm **proto parser** + **instantiate (mol/wisp)** + **wisp burn scheduler**.

## Kiến trúc

```
  PROTO TEMPLATE (có {{var}})
  ┌───────────────────────────────────────────────┐
  │  # Sprint {{project}}                          │
  │  owner: {{owner}}   goal: {{goal}}             │
  └────────────────────┬──────────────────────────┘
                       ▼ instantiate({ project: "mya", owner: "bom", ... })
  ┌─────────────┬──────────────────────────────────┐
  │  MOL (persistent)      WISP (ephemeral)         │
  │  ├ lưu store vĩnh viễn ├ lưu tạm (scratch)      │
  │  ├ audit mọi thay đổi   ├ tự burn sau TTL        │
  │  └ dùng cho việc thật   └ dùng cho thử nghiệm    │
  └────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/workflows runner.ts — workflow runner (nền — ZM chạy template)
// ✅ packages/skills skill.ts — parseSkillMarkdown (nền — ZM proto parser analog)
// ✅ packages/memory sqlite-store.ts — persistent store (nền — ZM mol store)
// ✅ packages/memory retention.ts — retention policy (nền — ZM wisp burn)
// ✅ packages/audit index.ts — AuditLog (nền — ZM mol audit)

// ❌ THIẾU: proto template parser ({{var}} placeholder)
// ❌ THIẾU: instantiate mol/wisp (lifecycle mode khi tạo)
// ❌ THIẾU: wisp burn scheduler (ephemeral tự xóa)
```

## Implementation

```typescript
// packages/workflows/src/molecule-wisp.ts (MỚI)

type Lifecycle = "mol" | "wisp";

interface ProtoTemplate { body: string; vars: string[]; defaultLifecycle: Lifecycle }
interface Artifact { id: string; lifecycle: Lifecycle; content: string; createdAt: number; expiresAt?: number }

class MoleculeWisp {
  constructor(
    private store: { saveMol(a: Artifact): Promise<void>; saveWisp(a: Artifact): Promise<void>; deleteWisp(id: string): Promise<void> },
    private audit: (rec: { action: string; id: string; lifecycle: Lifecycle }) => void,
  ) {}

  // Parse proto: tìm {{var}} placeholder
  parseProto(body: string): ProtoTemplate {
    const vars = [...body.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]);
    return { body, vars, defaultLifecycle: /wisp|ephemeral/i.test(body) ? "wisp" : "mol" };
  }

  // Instantiate: điền biến → mol (persistent) hoặc wisp (ephemeral)
  async instantiate(proto: ProtoTemplate, values: Record<string, string>, lifecycle?: Lifecycle): Promise<Artifact> {
    const mode = lifecycle ?? proto.defaultLifecycle;
    let content = proto.body;
    for (const v of proto.vars) content = content.replaceAll(`{{${v}}}`, values[v] ?? "");
    const art: Artifact = {
      id: `${mode}-${Date.now()}`,
      lifecycle: mode,
      content,
      createdAt: Date.now(),
      expiresAt: mode === "wisp" ? Date.now() + 7 * 24 * 3600_000 : undefined,  // wisp tự burn sau 7 ngày
    };
    if (mode === "mol") { await this.store.saveMol(art); this.audit({ action: "create", id: art.id, lifecycle: "mol" }); }
    else { await this.store.saveWisp(art); }
    return art;
  }

  // Burn: wisp hết hạn → xóa (không audit — ephemeral)
  async sweepWisps(now = Date.now()): Promise<number> {
    let burned = 0;
    // (trong thực tế: query wisp có expiresAt < now từ store)
    for (const w of await this.listExpiredWisps(now)) {
      await this.store.deleteWisp(w.id);
      burned++;
    }
    return burned;
  }
  private async listExpiredWisps(now: number): Promise<Artifact[]> { return []; } // nối store
}
// Usage:
// const mw = new MoleculeWisp(sqliteStore, auditLog.append.bind(auditLog));
// const proto = mw.parseProto("# Sprint {{project}} — owner {{owner}}");
// await mw.instantiate(proto, { project: "mya", owner: "bom" }, "mol");   // giữ lâu + audit
// await mw.instantiate(proto, { project: "scratch-x" }, "wisp");          // tự burn 7 ngày
// await mw.sweepWisps();  // dọn wisp hết hạn
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Phân loại vòng đời ngay khi tạo (mol giữ/wisp xóa) | ❌ Chọn nhầm mode → mol thành rác / wisp mất việc quan trọng |
| ✅ Wisp tự burn (không rác, không tốn store) | ❌ Burn sớm → mất kết quả thử nghiệm đang dùng |
| ✅ Mol audit được (truy vết mọi thay đổi) | ❌ Template var thiếu → instantiate ra nội dung rỗng |
| ✅ Cùng template, nhiều vòng đời (linh hoạt) | ❌ Sweep scheduler phải chạy định kỳ |

## Khác các hướng gần

| | Static doc | Scratch dir thủ công | ZM: Mol/Wisp |
|---|---|---|---|
| Lifecycle | Không biết | Thủ công | **✅ khai khi instantiate** |
| Dọn dẹp | Không | Human | **Wisp tự burn** |
| Audit | Không | Không | **✅ mol audit** |

## Khi nào chọn

- Workflow template dùng cho cả việc thật lẫn thử nghiệm (cần 2 vòng đời)
- Muốn ephemeral artifact tự dọn (không rác thủ công)
- Muốn persistent artifact audit được
- Nối packages/workflows runner.ts + skills skill.ts + memory sqlite-store.ts + retention.ts + audit index.ts; guard lifecycle-choice (mặc định đúng cho từng loại template), burn-safety (wisp quan trọng không bị burn nhầm), và var-completeness (thiếu var → cảnh báo trước instantiate); ZM = molecule-wisp templates, kết hợp 686 ZJ process-library-composable (template trong library) + 688 ZL compaction-survival-notes (mol = persistent note)
