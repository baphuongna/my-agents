# Hướng NNN: Tool Maker — agent tạo tool mới khi thiếu

> **Nguồn gốc:** Cai et al., 2023 "Large Language Models as Tool Makers" (arXiv 2305.17126)
> **Coupling:** 🟢 — tool mới là module độc lập qua ToolRegistry
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (skills + tool registry sẵn; thiếu tool-generation loop)
> **Effort:** 1-2 tuần

## Nguồn gốc

Tool Maker (Cai et al. 2023): agent không chỉ *dùng* tool mà **tự viết tool khi thiếu**. Paper: LLM làm **Tool Maker** — nhận bài toán → viết hàm Python (reusable function, không phải prompt) → **Tool Verifier** chạy test sinh ra để xác minh → nếu pass: lưu vào **tool library** + cache → lần sau bài tương tự dùng lại (không phải viết lại). Giảm cost đáng kể so với giải trực tiếp từng bài (reusable: 1 tool dùng nhiều lần). Khác **YY Knowledge Compilation** (compile thành *skill text/prompt*) — Tool Maker tạo **executable code + test**; khác **III ACI** (thiết kế tool cho agent — Tool Maker là agent *tự sinh* tool).

## Mô tả

mya gặp task lặp lại dạng "chuyển đổi format X→Y", "parse log kiểu Z" → không có tool → **Tool Maker phase**: agent viết hàm (TS) + 3-5 test case → chạy verify trong sandbox/worker → pass: đăng ký vào **OO ToolRegistry** (kèm metadata: tác giả, test, input/output schema) → lần sau task tương tự: **tool selection** (RR) thấy tool phù hợp → dùng luôn (cost = 1 tool call thay vì N lượt LLM). Tool hỏng khi dùng thật → gỡ + quay lại maker phase. Kết hợp QQ circuit-breaker: tool taint → không route tới nữa.

## Kiến trúc

```
  task lặp lại, chưa có tool ──► TOOL MAKER (agent viết hàm + tests)
                                    │ verify (PP eval: chạy tests)
                                    │ pass
                                    ▼
                         OO ToolRegistry.register(tool, {author, tests})
                                    │
  task tương tự ──► RR: chọn tool ──► dùng lại (1 tool call, không N lượt LLM)
                                    │ fail khi dùng thật
                                    ▼
                         QQ: taint ──► gỡ tool ──► maker phase lại
```

```
mya: OO ToolRegistry + PP eval + QQ taint sẵn — nền đủ
     thiếu: maker phase (viết code + test + verify tự động) + policy duyệt tool
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools ToolRegistry (OO) — nơi đăng ký tool mới + metadata
// ✅ packages/eval (PP) — verify tool bằng test
// ✅ packages/ai registry.ts — TaintedProfile (đánh dấu tool hỏng — QQ)
// ✅ packages/skills — học tri thức (YY) — tool maker là dạng executable của YY

// ❌ THIẾU: maker phase — agent viết tool + sinh test + chạy verify tự động
// ❌ THIẾU: chính sách duyệt (tool tự sinh là trust boundary — ai duyệt?)
// ❌ THIẾU: tiêu chí "task này đáng viết tool" (không viết tool 1 lần)
```

## Implementation

```typescript
// packages/tools/src/tool-maker.ts (NEW)
interface MadeTool {
  name: string;
  fn: string;                        // source TS (hoặc JS eval qua worker)
  tests: string[];                   // test cases sinh kèm
}

async function makeTool(task: string, examples: Example[]): Promise<Tool | null> {
  const draft = await llmWriteTool(task, examples);      // Tool Maker phase
  const ok = await verifyTool(draft);                    // Tool Verifier: chạy tests
  if (!ok) return null;
  await registry.register({ ...draft, author: "agent", approvedBy: "owner" });
  return registry.get(draft.name);
}

// RR: tool selection ưu tiên tool đã verify — chỉ maker phase khi không có
// QQ: tool bị taint trong runtime → deregister + quay lại maker phase
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Task lặp lại → 1 tool call thay vì N lượt LLM (giảm cost lớn) | ❌ Tool tự sinh là **trust boundary** (chạy code lạ) — cần verify + duyệt |
| ✅ Verify bằng test (PP) trước khi dùng | ❌ Tool kém → sai âm thầm, cần runtime taint (QQ) |
| ✅ ToolRegistry + eval + taint sẵn | ❌ Quyết định "đáng viết tool?" khó tự động hoàn hảo |
| ✅ Tool library học dần theo thời gian (như dev thật) | ❌ Code sinh có thể dùng lib không có trong runtime |
| ✅ Khác YY: executable + test, không phải prompt text | |

## Khác các hướng gần

| | YY Knowledge Compilation | III ACI | NNN: Tool Maker |
|---|---|---|---|
| Sản phẩm | Skill text/prompt | Thiết kế tool (thủ công) | **Tool executable + tests** |
| Ai làm | Compile từ tri thức | Kỹ sư | **Agent tự sinh** |
| Verify | Không bắt buộc | Benchmark | Bắt buộc (test chạy được) |
| Trust | Thấp | Thấp | Cao (code thực thi) |

## Khi nào chọn

- Task lặp lại dạng chuyển đổi/parse/hàm thuần — học được 1 lần
- Đã có ToolRegistry (OO) + eval (PP) + taint (QQ)
- Chấp nhận policy duyệt tool tự sinh (trust boundary)
- Muốn tận dụng tri thức dạng executable, không chỉ prompt