# Hướng ADO: Headroom Learn Mines Failures — phân tích session thất bại bằng LLM, tự viết corrections vào guidance

> **Nguồn gốc:** headroom | **Coupling:** 🟡 — pipeline sau session, đọc logs và ghi guidance files | **Agent-agnostic:** ✅ — làm việc với mọi agent | **Code sẵn:** ⚠️ (sẵn memory + prompts; thiếu failure analyzer) | **Effort:** 2 tuần

## Nguồn gốc

**headroom** có lệnh **`headroom learn`**: phân tích **session thất bại bằng LLM** — không dùng regex/heuristic để đoán lỗi mà để LLM đọc transcript và suy luận. Pipeline 4 bước: **Scanner** (quét session logs/failures) → **Digest Builder** (gói gọn thành digest) → **LLM** (phân tích nguyên nhân, đề xuất) → **Recommendations** (corrections cụ thể). Kết quả **tự viết vào CLAUDE.local.md** (gitignored — không pollute repo) hoặc **CLAUDE.md/AGENTS.md** (guidance chia sẻ).

Đây là **feedback loop từ failure vào persistent guidance**: mỗi lần agent thất bại theo một pattern, lần sau guidance đã có correction — agent không lặp lại lỗi. Khác với memory (ghi fact), pattern này ghi **hướng dẫn hành vi** (do/avoid) vào chính file mà agent đọc khi khởi động.

## Mô tả

Với mya, pipeline nối vào **audit + memory**: `packages/audit` đã ghi AuditRecord (tool/approval/repair/channel) — Scanner đọc đó; `packages/memory` Brain lưu digest; LLM phân tích qua `packages/ai`; recommendations ghi vào **AGENTS.md** hoặc skill mới (`packages/skills` — correction dạng SKILL.md có frontmatter). Cần **gate an toàn**: correction phải có bằng chứng (session cụ thể), không được tự ghi vào AGENTS.md khi thiếu context — nối ADN story verify để chứng minh correction hiệu quả.

## Kiến trúc (ASCII)

```
  SESSION LOGS / FAILURES
    │
    ▼ SCANNER (đọc audit records, transcripts)
    ▼ DIGEST BUILDER (gói thành digest nhỏ)
    ▼ LLM (phân tích nguyên nhân — không regex)
    ▼ RECOMMENDATIONS (corrections cụ thể: do/avoid)
    │
    ▼ GHI VÀO GUIDANCE
    ├─ CLAUDE.local.md / CLAUDE.md / AGENTS.md (do/avoid rules)
    └─ hoặc skill mới (SKILL.md có frontmatter)
            │
            ▼
  AGENT KHỞI ĐỘNG LẦN SAU đọc guidance → không lặp lỗi
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/audit — AuditLog (AuditKind: tool/approval/repair/channel)
//   (nguồn cho Scanner)
// ✅ packages/memory — Brain + SQLite (lưu digest + kết quả phân tích)
// ✅ packages/ai — ProviderRegistry + OpenAIAdapter (LLM phân tích)
// ✅ packages/skills — SkillStore + parseSkillMarkdown (correction dạng skill)
// ✅ packages/prompts — assemblePrompt (nơi AGENTS.md được nạp vào context)

// ❌ THIẾU: failure scanner (đọc audit → chọn session thất bại)
// ❌ THIẾU: LLM analyzer (digest → recommendations có bằng chứng)
// ❌ THIẾU: guidance writer có gate (chỉ ghi khi correction có session proof)
```

## Implementation

```typescript
// packages/audit/src/learn.ts (NEW)
export interface Correction {
  rule: string;               // "KHÔNG dùng regex để parse JSON từ LLM"
  evidence: string;           // session id + lỗi cụ thể
  target: "local" | "shared"; // CLAUDE.local.md vs AGENTS.md
}

export async function learnFromFailures(records: AuditRecord[], llm: Llm): Promise<Correction[]> {
  // 1. Scanner: lọc record thất bại (repair/approval-denied/tool-error)
  const failures = records.filter((r) => r.kind === "repair" || r.kind === "tool");
  if (failures.length < 3) return [];          // không đủ data thì không học

  // 2. Digest Builder: gói gọn thành digest nhỏ (tiết kiệm token)
  const digest = failures.slice(-10).map((r) => ({
    kind: r.kind, payload: redact(r.payload),
  }));

  // 3. LLM: phân tích nguyên nhân + đề xuất corrections
  const out = await llm.complete(`
    Phân tích các failure sau, đề xuất correction dạng do/avoid
    ngắn gọn, kèm evidence từng rule. ${JSON.stringify(digest)}
  `);

  // 4. Ghi có gate: chỉ giữ correction có evidence session cụ thể
  return parseCorrections(out.text).filter((c) => failures.some((f) =>
    f.id === c.evidence));
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Học từ failure bằng LLM — hiểu ngữ cảnh, không regex | ❌ LLM có thể hallucinate nguyên nhân |
| ✅ Tự viết guidance — feedback loop kín | ❌ Ghi vào AGENTS.md cần gate an toàn |
| ✅ CLAUDE.local.md gitignored — không pollute repo | ❌ Correction cũ không tự hết hạn |
| ✅ Nối skill store — correction thành skill dùng được | ❌ Tốn token phân tích session dài |

## Khác các hướng gần

| | ADO Learn Failures | AEC Apply Log | ADK Trace |
|---|---|---|---|
| Nguồn | Session thất bại | Thay đổi từng dòng | Hành trình turn |
| Output | Corrections vào guidance | Bảng Verified | Score + friction |
| Vòng lặp | Failure → guidance | Audit trail | Friction → harness fix |

## Khi nào chọn

- Agent lặp lại cùng pattern lỗi nhiều lần
- Muốn guidance tự tiến hóa từ thất bại thật
- Đã có audit records + memory + ai — thêm analyzer
- Chấp nhận gate thủ công cho correction ghi vào shared files