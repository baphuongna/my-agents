# Hướng ZV: Caveman Output Compression — chế độ nén token theo mức cường độ (lite/full/ultra/wenyan) bỏ filler, hedging, pleasantries nhưng giữ nguyên code, URL, error string và thuật ngữ kỹ thuật; state kéo dài mọi response cho tới khi user tắt
> **Nguồn gốc:** caveman (skills/caveman/SKILL.md) | **Coupling:** 🟢 — output transform mode trong prompt/print pipeline | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (tools/output-compress + prompts/compress — chưa có style-compression state) | **Effort:** 1-2 tuần

## Nguồn gốc

**caveman** skill có chế độ **nén token theo cường độ**: (1) **lite** — nén nhẹ, bỏ pleasantries; (2) **full** — nén mạnh, bỏ filler + hedging ("có lẽ", "tôi nghĩ"); (3) **ultra** — nén cực mạnh, bỏ mọi thứ trừ ý chính; (4) **wenyan** — chế độ cực đoan kiểu văn ngôn (tối giản tối đa). Quan trọng: **giữ nguyên code, URL, error string, thuật ngữ kỹ thuật** — chỉ nén prose. **State kéo dài** — chế độ áp dụng **mọi response** cho tới khi user tắt (không phải 1 lần). Nguyên tắc: **nén prose không nén technical content; state persist tới khi tắt**.

## Mô tả

mya caveman output compression: (1) **Intensity levels** — lite/full/ultra/wenyan (config). (2) **Transform rule** — bỏ filler/hedging/pleasantries; **giữ nguyên** code/URL/error/tech terms. (3) **Stateful** — chế độ inject vào prompt (system) và persist qua các turn cho tới khi tắt. (4) **Apply** — mọi response qua pipeline nén style. mya có tools/output-compress.ts (nén command output) + prompts/compress.ts (nén history) — ZV thêm **style compression levels** + **technical-content preserve rule** + **persistent state**.

## Kiến trúc

```
  USER: "bật caveman full"
  ┌──────────────────────────────────────────────┐
  │  STATE: caveman = "full" (persist mọi turn)    │
  │  → inject vào prompt: "trả lời nén, bỏ filler,  │
  │    giữ nguyên code/URL/error/tech terms"       │
  └────────────────────┬─────────────────────────┘
                       ▼ mọi response
  ┌── TRANSFORM (per response) ──────────────────┐
  │  prose: bỏ filler/hedging/pleasantries         │
  │  code/URL/error/tech-term: GIỮ NGUYÊN          │
  │  lite: nhẹ | full: mạnh | ultra: cực | wenyan  │
  └──────────────────────────────────────────────┘
  → tắt khi user yêu cầu (state clear)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools output-compress.ts — compressCommandOutput + reducers (nền — ZV nén output)
// ✅ packages/tools output-compress.ts — estimateTokens (nền — ZV đo hiệu quả)
// ✅ packages/prompts compress.ts — history compression (nền — ZV nén context)
// ✅ packages/prompts assembler.ts — assemblePrompt (nền — ZV inject style)
// ✅ packages/prompts drift.ts — DriftGrader (relate — ZV style persistence)

// ❌ THIẾU: style compression levels (lite/full/ultra/wenyan)
// ❌ THIẾU: technical-content preserve rule (giữ code/URL/error)
// ❌ THIẾU: persistent state (kéo dài tới khi tắt)
```

## Implementation

```typescript
// packages/prompts/src/caveman-mode.ts (MỚI)

type CavemanLevel = "lite" | "full" | "ultra" | "wenyan";

const LEVEL_PROMPTS: Record<CavemanLevel, string> = {
  lite:   "Trả lời gọn, bỏ pleasantries (hello/sure/no problem).",
  full:   "Nén mạnh: bỏ filler, hedging, pleasantries. Giữ nguyên code, URL, error string, thuật ngữ kỹ thuật.",
  ultra:  "Nén cực: chỉ ý chính + technical content (code/URL/error/terms). Không giải thích thừa.",
  wenyan: "Tối giản tối đa kiểu văn ngôn: vài chữ cho mỗi ý. Code/URL/error giữ nguyên tuyệt đối.",
};

class CavemanMode {
  private level: CavemanLevel | null = null;   // state — kéo dài tới khi tắt

  enable(level: CavemanLevel): string { this.level = level; return LEVEL_PROMPTS[level]; }
  disable(): void { this.level = null; }

  // Inject vào prompt mỗi turn (state persist)
  inject(systemPrompt: string): string {
    if (!this.level) return systemPrompt;
    return `${systemPrompt}\n\n[OUTPUT MODE — ${this.level}]\n${LEVEL_PROMPTS[this.level]}`;
  }

  // Post-transform an toàn: bảo vệ technical content trước khi nén prose
  compress(text: string): string {
    if (!this.level || this.level === "lite") return text;
    // placeholder: giữ code block/URL/error nguyên — nén prose bên ngoài
    const codeBlocks = new Map<string, string>();
    let t = text.replace(/```[\s\S]*?```/g, m => {
      const k = `\u0000CB${codeBlocks.size}\u0000`;
      codeBlocks.set(k, m);
      return k;
    });
    t = t.replace(/\b(https?:\/\/\S+|error:\s*.+|`[^`]+`)\b/g, m => {
      const k = `\u0000TC${codeBlocks.size}\u0000`;
      codeBlocks.set(k, m);
      return k;
    });
    t = t.split("\n").map(l => l.trim()).filter(Boolean).join("\n");  // nén prose đơn giản
    for (const [k, v] of codeBlocks) t = t.replaceAll(k, v);          // khôi phục nguyên vẹn
    return t;
  }
}
// Usage:
// const caveman = new CavemanMode();
// caveman.enable("full");            // state kéo dài
// systemPrompt = caveman.inject(systemPrompt);   // mọi turn đều nén
// const out = caveman.compress(agentOutput);     // prose nén, code/URL giữ nguyên
// caveman.disable();                 // tắt khi user yêu cầu
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tiết kiệm token mỗi response (prose nén) | ❌ Nén quá → mất nuance/context quan trọng |
| ✅ Technical content giữ nguyên (code/URL/error) | ❌ Transform regex có thể nuốt nhầm prose |
| ✅ State persist (không phải nhắc lại mỗi turn) | ❌ User quên tắt → mọi response nén (khó đọc) |
| ✅ Nhiều mức (lite → wenyan) linh hoạt | ❌ Wenyan/ultra khó hiểu cho người đọc |

## Khác các hướng gần

| | Output truncate | Prompt nén history | ZV: Caveman Mode |
|---|---|---|---|
| Mục tiêu | Cắt dài | Nén context cũ | **Style nén prose** |
| State | Không | Không | **✅ persist tới khi tắt** |
| Technical giữ | Có thể mất | Có | **✅ giữ nguyên** |

## Khi nào chọn

- Context hẹp / token đắt — muốn nén response prose mà không mất technical content
- User thích trả lời tối giản (developer power user)
- Muốn state bật 1 lần, áp dụng mọi turn
- Nối packages/prompts assembler.ts + compress.ts + tools output-compress.ts + drift.ts; guard technical-preservation (code/URL/error không bị nén nhầm), level-appropriateness (wenyan/ultra chỉ khi user chọn), và state-clear (tắt rõ ràng khi user yêu cầu); ZV = caveman output compression, kết hợp 701 ZY compressed-subagent-output (nén output subagent) + 676 YZ bilingual-consistency-ci (nén không phá consistency)
