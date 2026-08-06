# Hướng AFB: Provider-Specific Guidance — load CLAUDE.md/CODEX.md/GEMINI.md theo provider, dedup với AGENTS.md đã load

> **Nguồn gốc:** pi-extensions2 | **Coupling:** 🟢 — prompt assembly layer | **Agent-agnostic:** ⚠️ — phụ thuộc tên file theo provider (CLAUDE.md/CODEX.md/GEMINI.md) | **Code sẵn:** ⚠️ (sẵn AGENTS.md load + assembler; thiếu provider-conditional + dedup) | **Effort:** 1 tuần

## Nguồn gốc

**pi-extensions2** (agent-guidance/agent-guidance.ts): **agent-guidance load CLAUDE.md / CODEX.md / GEMINI.md theo provider đang dùng** — agent chạy Claude → load CLAUDE.md (guidance riêng cho Claude), chạy Codex → CODEX.md, Gemini → GEMINI.md; và **dedup với AGENTS.md đã load bởi core** — **so sánh nội dung giống nhau thì skip** (tránh đưa cùng nội dung vào context 2 lần, tốn token). Kết quả: **context đúng người đúng nghề** — mỗi provider nhận guidance viết cho nó, không nhận guidance của provider khác, không trùng lặp với AGENTS.md.

Giá trị: (1) **provider-conditional** — guidance khác nhau theo model (Claude thích X, Codex thích Y) — không nhồi tất cả; (2) **chống token lãng phí** — dedup nội dung giống nhau → không 2 bản trong context; (3) **tương thích ecosystem** — tận dụng convention file guidance đã có (CLAUDE.md là chuẩn Claude Code); (4) **core vẫn trung lập** — core load AGENTS.md (chung), extension thêm provider-specific (riêng).

## Mô tả

Với mya, pattern = **provider-conditional context injection**: (1) mya đã có **AGENTS.md load** — `packages/prompts/assembler.ts`: `ctxFiles` (AGENTS.md + project files) qua `scanInject` → context tier (SystemPrompt 3-tier stable/context/volatile); (2) pattern thêm **provider map** — `{ claude: "CLAUDE.md", codex: "CODEX.md", gemini: "GEMINI.md" }`; (3) **chọn file theo provider profile** (`packages/core` Session.profiles — ProviderProfile đã có); (4) **dedup** — so sánh **nội dung** (hash/chuỗi) với AGENTS.md đã load → trùng thì skip (có thể CLAUDE.md copy nguyên AGENTS.md); (5) **scan trước inject** — file guidance cũng là untrusted context → qua `scanInject` (đã sẵn) như AGENTS.md. Đây là pattern **context personalization per runtime**: cùng repo, mỗi provider nhìn thấy guidance riêng — nhưng vẫn giữ một nguồn chung (AGENTS.md).

## Kiến trúc (ASCII)

```
  PROVIDER PROFILE (core Session.profiles — đã có)
  ├─ claude ──► CLAUDE.md
  ├─ codex  ──► CODEX.md
  └─ gemini ──► GEMINI.md
    │
    ▼ LOAD FILE THEO PROVIDER (agent-guidance)
    ▼ DEDUP với AGENTS.md (core đã load)
  ├─ nội dung GIỐNG nhau ──► SKIP (không 2 bản — tiết kiệm token)
  └─ nội dung KHÁC ──► thêm vào context tier
    │
    ▼ SCAN (prompts/inject.ts scanInject — guidance = untrusted context)
    ▼ ASSEMBLE (SystemPrompt stable/context/volatile)
  (context đúng người đúng nghề — không nhồi guidance mọi provider)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/prompts/src/assembler.ts — load AGENTS.md + scanInject → context tier
//   (pipeline đọc context file — nơi chèn provider guidance)
// ✅ packages/core/src/types.ts — Session.profiles: ProviderProfile[]
//   (biết provider đang dùng — chọn file theo đây)
// ✅ packages/prompts/src/request-context.ts — rebuilder hook
//   (thêm guidance qua rebuilder — P1-P7)
// ✅ packages/core/src/threat-scan.ts + prompts/inject.ts — scan (guidance untrusted)
// ✅ packages/core/src/canonical-json.ts — hash nội dung (nền dedup)

// ❌ THIẾU: provider → file map (claude/codex/gemini)
// ❌ THIẾU: load + dedup theo nội dung với AGENTS.md
// ❌ THIẾU: nối assembler context tier (hoặc rebuilder)
```

## Implementation

```typescript
// packages/prompts/src/agent-guidance.ts (NEW)
export const PROVIDER_GUIDANCE_FILES: Record<string, string> = {
  claude: "CLAUDE.md",
  codex: "CODEX.md",
  gemini: "GEMINI.md",
};

export interface GuidanceOptions {
  provider: string;                       // từ Session.profiles[0]
  readFile: (p: string) => Promise<string | null>;
  alreadyLoaded: string[];                // AGENTS.md + ctxFiles (core đã load)
}

/** Load guidance theo provider — dedup nội dung giống nhau thì skip. */
export async function loadProviderGuidance(opts: GuidanceOptions): Promise<string | null> {
  const file = PROVIDER_GUIDANCE_FILES[opts.provider];
  if (!file) return null;                 // provider không có file riêng → không thêm

  const content = await opts.readFile(file);
  if (content === null) return null;

  // DEDUP: nội dung giống AGENTS.md/ctxFiles đã load → skip (tiết kiệm token).
  const norm = content.trim();
  if (opts.alreadyLoaded.some((c) => c.trim() === norm)) return null;

  return norm;   // → scanInject (untrusted) → context tier qua assembler/rebuilder
}

/** Nối assembler: thêm guidance vào context tier sau scan. */
export async function injectGuidance(
  session: { profiles: Array<{ id?: string; name?: string }> },
  readFile: (p: string) => Promise<string | null>,
  alreadyLoaded: string[],
): Promise<string | null> {
  const provider = (session.profiles[0]?.id ?? session.profiles[0]?.name ?? "").toLowerCase();
  const guidance = await loadProviderGuidance({ provider, readFile, alreadyLoaded });
  return guidance === null ? null : scanInject([guidance]);   // scan trước khi vào prompt
}
// Core giữ trung lập: AGENTS.md chung — extension thêm CLAUDE.md/CODEX.md/GEMINI.md
// P4/P6 (request-context): guidance qua rebuilder — no-op giữ cache-stable
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Context đúng provider — không nhồi guidance mọi model | ❌ Tên file theo convention (CLAUDE.md…) — provider khác không có |
| ✅ Dedup nội dung — không 2 bản trùng (tiết kiệm token) | ❌ So trùng chuỗi đơn giản — khác whitespace/comment là không dedup |
| ✅ Tận dụng ecosystem guidance file có sẵn | ❌ Provider map phải cập nhật khi provider mới |
| ✅ Core vẫn trung lập — extension thêm riêng | ❌ Guidance file cũng là untrusted — bắt buộc scan |

## Khác các hướng gần

| | AFB Provider Guidance | ADQ Rewrite Registry | AFA Subset Loading |
|---|---|---|---|
| Trọng tâm | Context theo provider | Quyết định rewrite | Tải extension theo yêu cầu |
| Cơ chế | Provider map + dedup content | 3 đường quyết định | Settings filter + exports |
| Quan hệ | Prompt assembly (prompts) | Khác miền (output) | Khác miền (pkg) |

## Khi nào chọn

- Dùng nhiều provider/model — mỗi model có guidance riêng
- CLAUDE.md/CODEX.md/GEMINI.md đã tồn tại trong repo (ecosystem convention)
- Đã có AGENTS.md load + scanInject — thêm provider map + dedup
- Muốn core trung lập (AGENTS.md chung), extension thêm riêng theo provider