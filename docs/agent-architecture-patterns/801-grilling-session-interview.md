# Hướng ADU: Grilling Session Interview — relentless interview để sharpen plan trước khi code

> **Nguồn gốc:** mattpocock-skills | **Coupling:** 🟢 — skill ở phase plan, không đụng runtime | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn prompts; thiếu interview skill) | **Effort:** 1 tuần

## Nguồn gốc

**mattpocock-skills** có skill **grill-me** / **grill-with-docs** chạy **`/grilling` session** — một cuộc phỏng vấn **relentless** (hỏi liên tục, không nương tay) để **sharpen plan/design TRƯỚC khi code**. Agent đóng vai interviewer: hỏi về giả định, cạnh tranh, rủi ro, edge cases, cho tới khi plan đủ sắc. Khi đi, session tạo **ADR + glossary** — quyết định được ghi lại, thuật ngữ được định nghĩa.

Failure mode pattern này giải quyết: "**agent không hiểu ý người dùng**" (misalignment) — agent nhận prompt mơ hồ rồi code theo hiểu lầm, tốn vòng lặp sửa. Grilling ép người dùng (và agent) làm rõ trước — chi phí hỏi rẻ hơn chi phí code sai.

## Mô tả

Với mya, grilling là **phase plan bắt buộc cho task lớn**: sau intake (nối ADI) và trước execution, agent chạy interview loop: hỏi 1 câu → người dùng trả lời → hỏi tiếp (tối đa N vòng hoặc tới khi không còn giả định chưa kiểm). Output: **plan đã sharpen + ADR (quyết định) + glossary (thuật ngữ)**. Lưu vào `packages/memory` Brain (decisions) — nối ADK trace decisions_made. `packages/prompts` có request-context; skill này là prompt-driven interview protocol. Chỉ áp dụng task ≥ ngưỡng — task nhỏ grill sẽ phiền (nối ADH lane chooser).

## Kiến trúc (ASCII)

```
  TASK (mơ hồ)
    │
    ▼ /grilling SESSION (grill-me / grill-with-docs)
    LOOP:
      ├─ agent hỏi 1 câu sắc (giả định? cạnh tranh? edge?)
      ├─ người dùng trả lời
      └─ chưa đủ? ──► hỏi tiếp
            │
            ▼ đủ sắc (không còn giả định chưa kiểm)
  OUTPUT
    ├─ PLAN đã sharpen (sẵn sàng code)
    ├─ ADR (quyết định đã chốt)
    └─ GLOSSARY (thuật ngữ đã định nghĩa)
            │
            ▼
  EXECUTION — code theo plan đã rõ (ít misalignment)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/prompts — assemblePrompt + request-context (nền interview prompt)
// ✅ packages/memory — Brain + governance (lưu ADR + glossary)
// ✅ packages/agent — runTurn (chạy interview như turn đặc biệt)
// ✅ packages/audit — AuditLog (ghi session interview)
// ✅ packages/workflows — runner (grilling như stage — nối ADF stages)

// ❌ THIẾU: interview protocol (vòng hỏi có luật dừng)
// ❌ THIẾU: ADR + glossary writer (đầu ra session)
// ❌ THIẾU: gate task ≥ ngưỡng mới grill (tránh phiền task nhỏ)
```

## Implementation

```typescript
// packages/agent/src/grilling.ts (NEW)
export interface GrillSession {
  questions: Array<{ q: string; rationale: string }>;
  answers: string[];
  adr: string[];        // quyết định đã chốt
  glossary: Map<string, string>;
}

const MAX_ROUNDS = 8;

export async function runGrilling(
  task: string,
  turn: (prompt: string) => Promise<string>,
): Promise<GrillSession> {
  const s: GrillSession = { questions: [], answers: [], adr: [], glossary: new Map() };
  for (let i = 0; i < MAX_ROUNDS; i++) {
    const q = await turn(`
      Bạn là interviewer. Task: ${task}.
      Đã hỏi: ${s.questions.map((x) => x.q).join(" | ") || "(chưa có)"}
      Đã trả lời: ${s.answers.join(" | ") || "(chưa có)"}
      Hỏi MỘT câu sắc nhất về giả định/rủi ro/edge case chưa kiểm.
      Nếu không còn giả định chưa kiểm, trả lời "DONE" + tóm plan.`);
    if (q.startsWith("DONE")) {
      // chốt ADR + glossary từ session
      s.adr = extractDecisions(q);
      s.glossary = extractGlossary(q);
      return s;
    }
    s.questions.push({ q, rationale: "unknown" });
    const a = await turn(`Người dùng trả lời câu hỏi sau: ${q}`);
    s.answers.push(a);
  }
  return s;  // đạt MAX_ROUNDS — plan chưa hoàn hảo nhưng đã sắc hơn
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Giảm misalignment — hiểu ý trước khi code | ❌ Tốn vòng lặp hỏi — phiền cho task nhỏ |
| ✅ ADR + glossary là bằng chứng quyết định | ❌ Người dùng bận không muốn trả lời nhiều |
| ✅ Rủi ro/edge case lộ ra sớm | ❌ Agent hỏi dở → câu hỏi vô nghĩa |
| ✅ Nối trace decisions (ADK) | ❌ Giới hạn vòng hỏi — plan vẫn có thể thiếu |

## Khác các hướng gần

| | ADU Grilling | ADI Intake | ADH Acceptance |
|---|---|---|---|
| Phase | Trước code (sharpen plan) | Trước mọi prompt (phân loại) | Trước execution (pass/fail) |
| Output | Plan + ADR + glossary | Work item + lane | Criteria list |
| Nối | ADI → ADU → ADH | ADU (task lớn) | Verify cuối turn |

## Khi nào chọn

- Task lớn/mơ hồ — misalignment đắt hơn chi phí hỏi
- Người dùng sẵn sàng trả lời vài vòng hỏi
- Đã có workflow runner + memory — thêm interview protocol
- Muốn ADR + glossary tự sinh khi thiết kế