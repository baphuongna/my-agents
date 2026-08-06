# Hướng AHN: Output-Head-Truncation — kết quả subagent chỉ là text; output quá `DEFAULT_MAX_BYTES` bị truncate phần đầu (head-truncated) trước khi trả về parent, parent được khuyến khích bảo subagent `write` artifact rồi trả path

> **Nguồn gốc:** pi-subagents | **Coupling:** 🟢 — contract output subagent | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có text output + kill; chưa có head-truncate + artifact-path contract) | **Effort:** 1 tuần

## Nguồn gốc

**pi-subagents** quy định kết quả subagent **chỉ là text** — không có file handoff tự động; output quá `DEFAULT_MAX_BYTES` sẽ bị **truncate phần đầu** (head-truncated) trước khi trả về parent. Nguyên tắc: **text là channel duy nhất** giữa parent ↔ subagent — đơn giản, test được; **giới hạn cứng** tránh parent nuốt output khổng lồ làm bùng context window; **artifact qua path** — khi output lớn, subagent `write` file rồi trả path (parent `read` khi cần) thay vì inline.

Cốt lõi: **bounded handoff** — kết quả subagent phải fit trong một budget cố định; phần dôi dư phải hạ cánh xuống filesystem rồi tham chiếu bằng path, không bao giờ nhồi nguyên văn vào conversation parent.

## Mô tả

Với mya, pattern = **output contract cho `spawnSubagent`**: (1) mya đã có `sub.wait()` trả text (`sub.output`) và `killSubagent` (packages/agent) — đúng channel text; (2) AHN thêm **`DEFAULT_MAX_BYTES`** (vd 32 KiB) — khi `output.length > MAX` thì **head-truncate**: giữ phần **đầu** (context quan trọng — goal + reasoning), bỏ phần cuối, kèm marker `… [truncated N bytes, write to artifact and return path]`; (3) **artifact-path protocol** — subagent có tool `write` (natives/mya-bridge) → ghi file rồi trả path; parent nhận path → `read` nếu cần chi tiết; (4) **prompt hint** — task description khuyến khích subagent viết artifact khi output lớn. Truncate chọn head (không phải tail) vì phần đầu thường chứa goal/reasoning mà parent cần quyết định.

## Kiến trúc (ASCII)

```
  PARENT ──spawn(goal)──► SUBAGENT
                              │  ... chạy, sinh output dài ...
                              ▼
                         OUTPUT (text-only, no file handoff)
                              │
                       length > DEFAULT_MAX_BYTES?
                         ├─ NO  ─► trả nguyên văn
                         └─ YES ─► HEAD-TRUNCATE
                                   ┌─ giữ đầu (goal + reasoning) ─┐
                                   │ … [truncated N bytes]        │
                                   │ ↳ write artifact, return path│
                                   └──────────────────────────────┘
                              ▼
  PARENT ◄──text (head) hoặc path──┘
            └─► nếu cần chi tiết: read(path)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/agent — spawnSubagent trả handle { id, status, output, goal,
//   startedAt, endedAt }; sub.wait() → text (channel text duy nhất)
// ✅ packages/agent — killSubagent / killAllSubagents (lifecycle)
// ✅ packages/agent pool.ts — AgentSessionEntry (output capture nền)
// ✅ natives/mya-bridge — tool `write` (subagent có thể ghi artifact)

// ❌ THIẾU: DEFAULT_MAX_BYTES + head-truncate logic
// ❌ THIẾU: artifact-path contract (prompt hint + path return)
// ❌ THIẾU: marker thông báo truncate cho parent
```

## Implementation

```typescript
// packages/agent/src/output-truncate.ts (NEW)
export const DEFAULT_MAX_BYTES = 32_768; // 32 KiB

/** Head-truncate subagent output: giữ đầu, bỏ đuôi, kèm marker. */
export function truncateSubagentOutput(text: string, maxBytes = DEFAULT_MAX_BYTES): string {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= maxBytes) return text;
  // Giữ phần đầu (goal + reasoning) — cắt theo byte-safe boundary.
  const head = Buffer.from(text, "utf8").subarray(0, maxBytes - 256).toString("utf8");
  const cut = bytes - (maxBytes - 256);
  return (
    head +
    `\n\n… [truncated ${cut} bytes] — output quá lớn. ` +
    `Quy tắc: \`write\` artifact rồi trả path thay vì inline.`
  );
}
// packages/agent index.ts: trong sub.wait(), trước khi resolve output:
//   const out = truncateSubagentOutput(rawOutput);
//   return out;
// Prompt template (task description): "Nếu output dài, hãy write artifact rồi
// trả path — parent sẽ read khi cần." → giảm truncate.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Bounded handoff — parent không bùng context window | ❌ Truncate mất phần cuối (có thể chứa kết quả quan trọng) |
| ✅ Head-truncate giữ reasoning/decision | ❌ Parent phải read path thêm 1 round-trip |
| ✅ Channel text đơn giản, test được | ❌ DEFAULT_MAX_BYTES phải calibrate theo context budget |
| ✅ Artifact path ↔ natives write sẵn | ❌ Path phải stable; parent chết giữa chừng = mồ côi file |

## Khác các hướng gần

| | AHN Output-Head-Truncation | AHO Recursive-Context-Isolation | AIB Bounded-Context-Inheritance |
|---|---|---|---|
| Trọng tâm | Bound output subagent → parent | Subagent không kế thừa context | Parent context nén truyền cho subagent |
| Cơ chế | Head-truncate + artifact path | Separate process + task-only context | Extract text + compaction summary |
| Quan hệ | Đầu ra của subagent | Cách subagent khởi động | Đầu vào của subagent |

## Khi nào chọn

- Subagent thường sinh output lớn (report, log, diff) → cần bound để bảo parent
- Muốn channel handoff đơn giản (text) nhưng vẫn hỗ trợ artifact lớn
- Đã có spawnSubagent + write tool — thêm truncate + path protocol
- Guard: DEFAULT_MAX_BYTES < context budget, head-truncate (không tail), marker rõ, calibrate theo model
