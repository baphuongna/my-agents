# Hướng AIX: Librarian Skill Evidence-Citation — research library với evidence-backed answers: phân loại request, batch tool calls một turn, mọi claim phải có GitHub permalink

> **Nguồn gốc:** pi-web-access | **Coupling:** 🟢 — skill layer, không đụng runtime | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có skill-store + web tools; chưa có librarian skill) | **Effort:** 2 tuần

## Nguồn gốc

**pi-web-access** có **librarian skill** — research library với **evidence-backed answers**: (1) **phân loại request** (conceptual/implementation/context/comprehensive — mỗi loại chiến lược tìm khác nhau); (2) **batch tool calls một turn** để **tiết kiệm LLM round-trip** (gọi nhiều tool song song trong một turn thay vì từng cái một); (3) **mọi claim phải có GitHub permalink đến đúng dòng code** — không trả lời mơ hồ, mỗi khẳng định gắn nguồn cụ thể.

Nguyên tắc: **research phải evidence-backed** — claim không có permalink là claim chưa kiểm chứng; **phân loại request quyết định chiến lược** — "khái niệm" tìm docs, "implementation" tìm code line, "context" tìm README/history; **batch tool calls** — parallel trong một turn giảm latency + token (LLM round-trip đắt hơn tool call).

## Mô tả

Với mya, pattern = **librarian skill trên skill-store + web tools**: (1) **skill mới `librarian`** (SKILL.md — nối `packages/skills` SkillStore, progressive disclosure: index trong stable tier, body load khi invoke); (2) **phân loại request** — classifier (heuristic hoặc LLM nhỏ — nối `packages/ai` model-routing small tier) → strategy map; (3) **batch tool calls** — một turn gọi song song `web_search` + `github_explore` (AIS clone) + `code_search` (nếu có) — dùng `runToolBatch` (`tools/src/dispatch.ts` aggregate đã có); (4) **evidence extraction** — kết quả chứa permalink GitHub (owner/repo/blob/ref/path#L<line>); (5) **answer builder** — mọi claim kèm permalink; không đủ evidence → nói rõ "chưa kiểm chứng". Lưu library (citations) vào `packages/memory` (governance trust + retrieve) để tái dùng.

## Kiến trúc (ASCII)

```
  REQUEST
    │
    ▼ CLASSIFY (librarian skill)
    ├─ conceptual ────► docs/README/architecture
    ├─ implementation ► github_explore (clone) + code_search (AIS)
    ├─ context ───────► history/CHANGELOG/releases
    └─ comprehensive ─► tất cả + cross-reference
    │
    ▼ BATCH TOOL CALLS MỘT TURN (runToolBatch — parallel)
    ├─ web_search + github_explore + code_search (song song)
    └─ aggregate kết quả (dispatch aggregate có sẵn)
    │
    ▼ EVIDENCE EXTRACTION (GitHub permalink owner/repo/blob/ref/path#L<line>)
    ▼ ANSWER BUILDER
    ├─ claim 1 ──► permalink (đúng dòng code)
    ├─ claim 2 ──► permalink
    └─ thiếu evidence ──► "chưa kiểm chứng" (không bịa)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills skill.ts + curator.ts — SkillStore, SKILL.md parse,
//   progressive disclosure (index/body), provenance gating
// ✅ packages/tools dispatch.ts — runToolBatch + aggregate (batch tool calls)
// ✅ packages/tools web/search — web_search/web_extract (provider chain)
// ✅ packages/tools codegraph.ts — code relevance (nền implementation search)
// ✅ packages/memory governance.ts — trust score + recall weight (nền evidence)
// ✅ packages/ai model-routing.ts — small tier (nền classifier model)

// ❌ THIẾU: librarian SKILL.md (phân loại request + strategy)
// ❌ THIẾU: evidence extraction (GitHub permalink từ kết quả)
// ❌ THIẾU: answer builder ràng buộc claim-permalink
```

## Implementation

```typescript
// packages/skills/src/librarian.ts (NEW) — helper cho librarian SKILL.md
export type RequestKind = "conceptual" | "implementation" | "context" | "comprehensive";

/** Phân loại request → chiến lược tìm (heuristic, không LLM). */
export function classifyRequest(request: string): RequestKind {
  const q = request.toLowerCase();
  if (/\b(how to|implement|write|code|function|api of|signature)\b/.test(q)) return "implementation";
  if (/\b(what is|concept|explain|architecture|pattern)\b/.test(q)) return "conceptual";
  if (/\b(changelog|version|history|release|why was)\b/.test(q)) return "context";
  return "comprehensive";
}

/** GitHub permalink từ kết quả tìm — owner/repo/blob/ref/path#L<line>. */
export function toPermalink(
  owner: string, repo: string, ref: string, path: string, line: number,
): string {
  return `https://github.com/${owner}/${repo}/blob/${ref}/${path}#L${line}`;
}

/** Mọi claim phải có permalink — thiếu evidence thì báo rõ, không bịa. */
export function buildEvidenceAnswer(claims: Array<{ text: string; permalink?: string }>): string {
  return claims
    .map((c) => (c.permalink ? `- ${c.text} (${c.permalink})` : `- ${c.text} _(chưa kiểm chứng — cần nguồn)_`))
    .join("\n");
}
// Librarian SKILL.md: gọi classifyRequest → batch runToolBatch(web_search +
// github_explore + code_search) → toPermalink → buildEvidenceAnswer.
// Library lưu citations vào memory (governance trust — evidence tốt lên trust).
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Evidence-backed — mọi claim có permalink, không bịa | ❌ Permalink cần clone/explore — chậm hơn trả lời nhanh |
| ✅ Batch tool calls — tiết kiệm LLM round-trip | ❌ Phân loại heuristic có thể sai loại → strategy lệch |
| ✅ Library tái dùng (memory trust) | ❌ Request comprehensive tốn nhiều tool calls |
| ✅ Nối skill-store progressive disclosure | ❌ Permalink stale nếu ref thay đổi (cần pin ref) |

## Khác các hướng gần

| | AIX Librarian Evidence | AJQ Grilling Interview | AIS Clone-Not-Scrape |
|---|---|---|---|
| Trọng tâm | Research evidence-backed | Align trước khi code | Code explore |
| Cơ chế | Classify + batch + permalink | Interview loop | git clone + code-search |
| Quan hệ | Người tiêu thụ AIS | Phase plan | Cung cấp evidence |

## Khi nào chọn

- Agent làm research/review code — cần trả lời có nguồn chính xác
- Đã có skill-store + web tools + dispatch batch — thêm librarian layer
- Muốn claim không bịa — permalink là gate bắt buộc
- Guard: classify rõ strategy, batch một turn, thiếu evidence phải nói "chưa kiểm chứng"