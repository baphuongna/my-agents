# Đánh giá lại: SSSF có thực sự phù hợp với mya?

> Critical re-evaluation — challenging the previous analysis.
> Không phải xác nhận, mà là đặt câu hỏi.

---

## Phân tích trước đó sai ở đâu

Phân tích trước (sssf-analysis.md) đánh giá 4 patterns là "P0/P1 nên áp dụng". Nhưng nó mắc lỗi cơ bản: **pattern-matching mà không đánh giá use case thực tế**.

Nó nhìn SSSF có gates → mya không có gates → GAP. Nhưng không hỏi: **mya có cần gates không?**

---

## Sự thật về cách mya hoạt động

### 1. Workflow system gần như không được dùng

```typescript
// mya-bridge.ts:1485 — run_workflow tool
const wfCtx = {
  tools: { execute: async () => [] },   // ← STUB: không thực thi tools
  provider: { stream: async () => ({ events: [] }) },  // ← STUB
  // spawn ĐƯỢC wire (qua pi-subagent)
};

// mya-bridge.ts:1922 — /workflow command
const wfCtx = {
  tools: { execute: async () => [] },   // ← STUB
  // spawn KHÔNG được wire
};
```

Workflow runner tồn tại nhưng:
- Tools executor là stub (không gọi được tools)
- `/workflow` command không wire spawn (không spawn agent được)
- Chỉ `run_workflow` tool (LLM-invocable) wire spawn thật
- Không có cron workflow nào dùng system này
- **Không có multi-agent pipeline nào tồn tại trong thực tế**

### 2. Roles là overlay đơn giản, không phải agents riêng

```json
// reviewer.json
{
  "promptAppend": "Do NOT edit files — review only",
  "toolsAllowed": ["read", "grep", "find", "ls", "bash"]
}
```

- 4 roles: coder, default, researcher, reviewer
- reviewer nói "không edit files" trong prompt — nhưng **bash vẫn chạy `git checkout`**
- Tất cả share 1 brain (memoryScope: "global")
- Không có state isolation giữa roles
- **Roles KHÔNG phải pipeline agents — chúng là personality overlays**

### 3. Trust model cố ý: NO SANDBOX

```
AGENTS.md: "no sandbox, the agent runs in the user's environment
            with their privileges"
```

Đây là **design choice có chủ đích**. Write permission enforcement trực tiếp mâu thuẫn với nguyên tắc này.

### 4. User là người kiểm soát

- Interactive mode: user thấy output ngay, verify bằng mắt
- Agent đọc AGENTS.md → biết `npx vitest run --testTimeout=5000`
- Không cần agent "rediscover" lệnh test (nó đã được viết trong system prompt)
- **User chính là gate**

---

## SSSF vs mya: Hai sản phẩm khác nhau

| Đặc điểm | SSSF | mya |
|---|---|---|
| **Loại** | CI/CD pipeline cho AI agents | Personal AI assistant platform |
| **Chế độ chính** | One-shot scripts (`uv run adw_plan.py`) | Interactive TUI + gateway 24/7 |
| **Kiểm soát** | Code owns pipeline, agents bounded | User owns pipeline, agent assists |
| **Trust model** | Untrusted pipelines (CI-like) | Trusted agents (user's env) |
| **Multi-agent** | Plan→Build→Test→Review→Document | Single agent + role delegation |
| **Verification** | Automated gates (mechanical) | Human-in-the-loop (visual) |
| **Observability** | SQLite trace + polling visualizer | WS push + Brain + dashboard |

**SSSF giải quyết**: "Làm sao chạy multi-agent SDLC pipeline tự động, có verification, có audit trail?"

**mya giải quyết**: "Làm sao có một AI assistant cá nhân thông minh, có memory, chạy 24/7, đa channel?"

Đây là **hai bài toán khác nhau**.

---

## Đánh giá từng pattern: Thực sự cần không?

### ❌ Typed Envelopes — KHÔNG cần

**Lý do**: mya không có multi-agent pipeline. `ctx.spawn(goal)` trả về `string` — và điều đó OK vì:
- Workflow scripts hiếm khi được dùng
- Khi dùng, output là text (log, summary), không phải structured handoff
- Không có "agent A output → agent B input" chain

**Nếu port**: Tạo types + validation cho một use case không tồn tại. Code chết.

### ❌ Gate System — KHÔNG cần

**Lý do**: User là gate. Trong interactive mode:
- Agent: "Tôi đã tạo `src/health.ts`"
- User: nhìn vào file explorer → thấy file → OK

Không cần automated gate để verify "file có tồn tại không" khi user NHÌN THẤY file.

Trong automated mode (cron): cron jobs làm operational tasks (check status, summarize), không làm file-creation cần verification.

**Nếu port**: Gate functions đẹp về mặt lý thuyết, nhưng không có consumer. Thêm vào rồi không ai gọi.

### 🟡 Quality-as-Code — ĐÚNG nhưng overhyped

SSSF nói: "Agent rediscovering `bun test` costs a fortune."

**Thực tế mya**: Agent đọc AGENTS.md lúc startup. Lệnh test được ghi rõ:
```
Lệnh: `npx vitest run --testTimeout=5000`
```

Agent KHÔNG "rediscover" — nó đã biết. Argument của SSSF không áp dụng.

**Nhưng**: `runQuality()` helper là một utility hợp lệ cho workflow scripts. Nó chỉ là `child_process.execFile()` + error capture. ~20 dòng. Không cần gọi nó là "pattern" — nó là một helper function.

**Nếu port**: OK như 1 helper function nhỏ. Không build cả subsystem quanh nó.

### ❌ Write Permission — TRÁI với triết lý mya

**Lý do 1**: Trust model. AGENTS.md nói rõ "no sandbox, user's privileges". Thêm write boundary = thay đổi design philosophy cốt lõi.

**Lý do 2**: Threat model sai. SSSF cần write boundary vì chạy untrusted pipelines (CI triggers, external requests). mya chạy trusted agents cho 1 user. Không có threat.

**Lý do 3**: Risk cao. Rollback logic (git checkout + delete untracked) có thể xóa work của user. Trong monorepo với worktrees, snapshot/diff phức tạp.

**Lý do 4**: `reviewer.json` đã có `toolsAllowed: ["read", "grep", "find", "ls", "bash"]`. Nếu muốn reviewer thực sự read-only → bỏ `bash` khỏi toolsAllowed. Đơn giản hơn git tree snapshot.

**Nếu port**: Thêm complexity + risk cho threat không tồn tại. Trái design philosophy.

### ❌ Structured Trace — mya đã có tốt hơn

SSSF: SQLite trace tables + polling visualizer.

mya: WS real-time push + Brain (SQLite WAL) + CostTracker + dashboard 38 pages.

mya's observability ĐÃ MẠNH HƠN SSSF. Không cần port.

### ❌ Full ADW System — Sai paradigm

SSSF's ADW (plan→build→test→review→document) là software development pipeline.

mya không phải CI tool. Không cần.

---

## Vậy SSSF có giá trị gì cho mya?

### Giá trị DUY NHẤT: Mental model

**"Known commands are code, not agents"** — đây là insight prompt engineering, không phải code.

mya đã thực hiện điều này một phần:
- AGENTS.md ghi rõ commands (`npx vitest run`, `npx tsc --noEmit`)
- Agent đọc instructions → chạy trực tiếp
- Workflow runner có `phase()` primitive

Có thể strengthen bằng cách thêm vào AGENTS.md hoặc system prompt:
```
Khi cần chạy test/lint/typecheck, dùng lệnh trực tiếp (đã có trong docs),
không hỏi "how to run tests".
```

Zero code change. Zero risk.

### Utility nhỏ (optional): runQuality helper

Nếu workflow scripts cần chạy deterministic checks:

```typescript
// packages/workflows/src/quality.ts — ~30 dòng
export async function runQuality(specs, cwd) {
  // execFile each spec, capture output, return structured result
}
```

Đây là utility function, không phải "pattern port". Thêm nếu cần, không thêm cũng được.

---

## Kết luận thẳng thắn

**Phân tích trước (sssf-analysis.md) over-enthusiastic.** Nó map SSSF concepts → mya gaps mà không đánh giá xem gaps đó có matter không.

**Sự thật**: SSSF và mya giải quyết hai bài toán khác nhau. SSSF là CI pipeline cho AI agents. mya là personal AI assistant. Port SSSF patterns = thêm complexity cho use cases không tồn tại.

**Khuyến nghị sửa đổi**:

| Pattern | Đánh giá lại | Hành động |
|---|---|---|
| Typed Envelopes | ❌ Không có consumer | Bỏ |
| Gate System | ❌ User là gate | Bỏ |
| Quality-as-Code | 🟡 Helper OK, không phải subsystem | Optional 30-line utility |
| Write Permission | ❌ Trái trust model | Bỏ |
| Structured Trace | ❌ mya đã tốt hơn | Bỏ |
| ADW System | ❌ Sai paradigm | Bỏ |
| "Known commands are code" | ✅ Mental model | Thêm 1 dòng vào AGENTS.md |

**Tỷ lệ effort/impact thực tế**: Gần như toàn bộ SSSF không phù hợp. Pattern duy nhất đáng giá là một câu prompt engineering.

---

## Hồi đáp: "Nhưng tương lai thì sao?"

Lập luận có thể là: "Nếu mya sau này muốn thêm automated SDLC pipelines, SSSF patterns sẽ hữu ích."

**Phản hồi**: Đúng, NHƯNG:
1. Đừng build infrastructure trước khi có use case (YAGNI)
2. Khi use case thực sự xuất hiện, port lúc đó — với yêu cầu cụ thể
3. Hiện tại, effort tốt hơn dành cho: memory quality, runtime stability, E2E coverage
4. SSSF's code sẽ tiếp tục evolve — port sớm = technical debt

**Nguyên tắc**: Build for real users solving real problems, not for hypothetical futures.
