# Hướng ZY: Compressed Subagent Output — ba preset subagent (cavecrew-investigator/builder/reviewer) trả về output contract nén (path:line — symbol) nên tool result đưa vào main context nhỏ ~60%, kéo dài tuổi thọ context qua nhiều lần delegation
> **Nguồn gốc:** caveman (skills/cavecrew/SKILL.md) | **Coupling:** 🟢 — output contract nén cho subagent result | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (agent subagent + output-compress — chưa có preset contract) | **Effort:** 1-2 tuần

## Nguồn gốc

**caveman** dùng **3 preset subagent** — (1) **cavecrew-investigator** — điều tra (đọc file, tìm hiểu); (2) **cavecrew-builder** — xây dựng (viết code, sửa); (3) **cavecrew-reviewer** — review (kiểm tra, đánh giá) — mỗi preset có **output contract nén**: thay vì trả toàn bộ nội dung, trả **`path:line — symbol`** (vd `src/a.ts:42 — validateInput`) hoặc danh sách kết quả tối giản. Tool result của subagent đưa vào main context **nhỏ ~60%** (so với output đầy đủ) → main context **sống lâu hơn** qua nhiều lần delegation (mỗi lần delegation không "ăn" hết context). Nguyên tắc: **subagent trả contract nén (path:line — symbol), không trả prose dài**.

## Mô tả

mya compressed subagent output: (1) **3 preset** — investigator (điều tra), builder (xây), reviewer (review) — mỗi preset có system prompt + output contract. (2) **Output contract** — format nén: `path:line — symbol` (investigator), `path — diff summary` (builder), `findings: severity — where — why` (reviewer). (3) **Compress result** — subagent result qua transform → compact (nối output-compress). (4) **Main context saving** — tool result nhỏ → context sống lâu hơn. mya có agent index.ts (spawn subagent) + tools/output-compress.ts — ZY thêm **preset registry (3)** + **output contract format** + **compress-on-return**.

## Kiến trúc

```
  MAIN AGENT ──delegate──▶ SUBAGENT (preset)
  ┌──────────────────────────────────────────────┐
  │  investigator: đọc/tìm hiểu                    │
  │    → contract: "path:line — symbol"            │
  │  builder: viết/sửa                            │
  │    → contract: "path — diff summary"           │
  │  reviewer: review                             │
  │    → contract: "severity — where — why"        │
  └────────────────────┬─────────────────────────┘
                       ▼ tool result (nén ~60% nhỏ)
  ┌── MAIN CONTEXT ─────────────────────────────┐
  │  subagent result = compact contract           │
  │  → mỗi delegation ăn ít context                │
  │  → main context sống qua NHIỀU delegation     │
  └──────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/agent index.ts — spawn subagent + SubagentHandle (nền — ZY preset)
// ✅ packages/tools output-compress.ts — compressCommandOutput (nền — ZY nén result)
// ✅ packages/tools output-compress.ts — estimateTokens (nền — ZY đo % tiết kiệm)
// ✅ packages/core session-branch.ts — classifyChildSession "delegate" (nền — ZY delegate marker)
// ✅ packages/council adversarial.ts — review (nền — ZY reviewer preset)

// ❌ THIẾU: 3 preset subagent registry (investigator/builder/reviewer)
// ❌ THIẾU: output contract format (path:line — symbol)
// ❌ THIẾU: compress-on-return (subagent result nén trước khi vào main context)
```

## Implementation

```typescript
// packages/agent/src/subagent-presets.ts (MỚI)

type PresetName = "investigator" | "builder" | "reviewer";

interface Preset {
  name: PresetName;
  system: string;                       // hướng dẫn + output contract
  contract: (raw: string) => string;    // nén result về contract
}

const PRESETS: Record<PresetName, Preset> = {
  investigator: {
    name: "investigator",
    system: "Bạn là investigator. Điều tra rồi trả KẾT QUẢ dạng nén: `path:line — symbol` mỗi dòng. Không prose dài.",
    contract: (raw) => raw.split("\n")
      .map(l => l.trim())
      .filter(l => /\.\w+:\d+\s*—/.test(l))     // giữ dòng đúng contract path:line — symbol
      .slice(0, 50)
      .join("\n"),
  },
  builder: {
    name: "builder",
    system: "Bạn là builder. Xây/sửa rồi trả `path — diff summary` (file + tóm tắt thay đổi). Không dán code dài.",
    contract: (raw) => raw.split("\n")
      .map(l => l.trim())
      .filter(l => /\.\w+\s*—/.test(l))
      .slice(0, 30)
      .join("\n"),
  },
  reviewer: {
    name: "reviewer",
    system: "Bạn là reviewer. Review rồi trả `severity — where — why` mỗi finding 1 dòng. Không giải thích dài.",
    contract: (raw) => raw.split("\n")
      .map(l => l.trim())
      .filter(l => /^(error|warning|info)\s*—/.test(l))
      .slice(0, 40)
      .join("\n"),
  },
};

class SubagentPresets {
  // Spawn với preset → result nén theo contract trước khi về main context
  async spawn(
    spawnFn: (goal: string, opts: { system?: string }) => Promise<string>,
    preset: PresetName,
    goal: string,
  ): Promise<string> {
    const p = PRESETS[preset];
    const raw = await spawnFn(goal, { system: p.system });
    return p.contract(raw);               // compress-on-return — result nhỏ ~60%
  }
}
// Usage:
// const presets = new SubagentPresets();
// const symbols = await presets.spawn(spawnSubagent, "investigator", "điều tra src/payment/");
// // → "src/payment/validate.ts:12 — validateInput\n..." — compact, context sống lâu
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Main context nhỏ ~60% (sống qua nhiều delegation) | ❌ Contract regex có thể lọc mất thông tin quan trọng |
| ✅ Preset chuẩn (investigator/builder/reviewer rõ vai) | ❌ Output contract cứng (domain khác phải thêm preset) |
| ✅ Compress-on-return tự động (không cần nhắc) | ❌ Result nén quá → main agent thiếu chi tiết để quyết định |
| ✅ Nhiều lần delegation không "ăn" hết context | ❌ Subagent phải được prompt đúng contract (lệch → filter rỗng) |

## Khác các hướng gần

| | Full output | Summarize sau | ZY: Contract nén |
|---|---|---|---|
| Kích thước | Lớn | Vừa | **~60% nhỏ hơn** |
| Format | Tự do | Tự do | **Chuẩn per preset** |
| Context life | Ngắn | Vừa | **✅ dài** |

## Khi nào chọn

- Agent hay delegate nhiều lần (context bị ăn dần) — cần result nhỏ
- Muốn subagent output có format chuẩn (path:line — symbol) dễ parse
- Muốn preset vai rõ (investigator/builder/reviewer) kèm contract
- Nối packages/agent index.ts + tools output-compress.ts + core session-branch.ts + council adversarial.ts; guard contract-regex (pattern khớp output thật, không filter trắng), preset-prompt (subagent được hướng dẫn đúng format), và fallback (regex rỗng → giữ raw slice đầu, không mất hết); ZY = compressed subagent output, kết hợp 698 ZV caveman-output-compression (nén prose) + 682 ZF evidence-driven-completion (contract vẫn giữ evidence)
