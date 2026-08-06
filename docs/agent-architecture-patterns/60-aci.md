# Hướng BH: Agent-Computer Interface (ACI) — giao diện agent↔máy là sản phẩm

> **Nguồn gốc:** SWE-agent — Yang et al., NeurIPS 2024 (arXiv 2405.15793); Anthropic khuyên dùng
> **Coupling:** 🟢 — interface độc lập với model
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (1 phần — tool set sẵn; thiếu observation format chuẩn)
> **Effort:** 1-2 tuần

## Nguồn gốc

SWE-agent (Princeton, NeurIPS 2024) định nghĩa **Agent-Computer Interface (ACI)**: bộ công cụ + định dạng quan sát mà agent dùng để tương tác với máy tính — được *thiết kế như một sản phẩm riêng*, không phải mặc định shell. SWE-agent đạt +12% trên SWE-bench so với cùng model dùng shell thô. Anthropic "Building Effective Agents" nhấn: "carefully craft your ACI through thorough tool documentation and testing". Bài học chính: **tool quyết định năng lực agent nhiều hơn model** — file viewer hơn `cat`, editor có line numbers hơn sed.

## Mô tả

mya hiện expose tool set rời (kanban, intercom, git, MCP...) — chưa có ACI chuẩn: định dạng quan sát nhất quán (output tối giản, có line number, khác biệt rõ thành công/lỗi), quy ước tool (mỗi tool 1 việc, trả về struct chuẩn `{ ok, output }` — mya đã có `ToolResult`!), và *tool documentation* cho model. SWE-agent phát hiện: agent dùng tool hiệu quả hơn khi output ngắn gọn, có line numbers, không kèm boilerplate. Khác OO Tool Registry (đăng ký/quyền) — ACI là *thiết kế giao diện*: observation format, tool ergonomics, docs.

## Kiến trúc

```
  LLM ◄──► ACI LAYER ◄──► máy tính
           │
           ├─ TOOL SET (thiết kế cho agent, không cho người):
           │    kanban-sqlite · git-ipc · intercom · search · edit (có line numbers)
           ├─ OBSERVATION FORMAT (nhất quán mọi tool):
           │    { ok, output, context } — tối giản, đánh dấu diff/lỗi
           └─ TOOL DOCS (spec cho model):
                mô tả 1-2 dòng · khi nào dùng · ví dụ · giới hạn
```

```
mya: ToolResult { ok, output } đã có (AGENTS.md) — nền ACI sẵn
     thiếu: line-number viewer/editor, output normalization, tool docs có kỷ luật
```

## mya ĐÃ CÓ (phần lớn)

```typescript
// ✅ ToolResult { ok, output } — chuẩn output đã nhất quán (AGENTS.md)
// ✅ packages/tools — tool set: kanban-sqlite, intercom, git-as-ipc, MCP search
// ✅ packages/ai/src/model-routing.ts — tier cho model phù hợp tool nặng/nhẹ
// ✅ packages/print/src/role-subagent-spawn.ts — tool theo role

// ❌ THIẾU: observation format chuẩn (line numbers, diff highlight, error codes)
// ❌ THIẾU: ACI spec cho từng tool (khi nào dùng, giới hạn) — docs cho model
// ❌ THIẾU: benchmark đối chiếu tool design (đổi 1 tool → đo pass rate)
```

## Implementation

```typescript
// packages/tools/src/aci.ts (NEW) — chuẩn hoá giao diện
interface AciToolSpec {                       // docs cho model (auto-gen)
  name: string;
  when: string;                                // khi nào dùng (không khi nào)
  usage: string;                               // 1 ví dụ ngắn
  limits: string;                              // giới hạn, phạm vi
}

// Observation format: output tối giản, có context
interface Observation {
  ok: boolean;
  errorCode?: string;                          // E_NO_LINE, E_TAINTED...
  output: string;                              // ngắn, line-numbered khi là file
  hints?: string[];                            // gợi ý bước tiếp (SWE-agent style)
}

// Rule SWE-agent: 1 tool = 1 việc; file viewer ≠ editor ≠ terminal
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ +12% pass rate SWE-bench (cùng model, ACI tốt) | ❌ Thiết kế tool là việc thủ công, cần thử nghiệm |
| ✅ Output tối giản → ít token hơn (NN cache hỗ trợ) | ❌ ACI kém → model loay hoay dù model xịn |
| ✅ ToolResult sẵn → chỉ chuẩn hoá format | ❌ Cần benchmark riêng (PP) để đo tool design |
| ✅ Đổi model không phải đổi ACI (agent-agnostic) | ❌ Docs cho model phải cập nhật khi tool đổi |
| ✅ Nền để làm mọi hướng khác tốt hơn | |

## Khác các hướng gần

| | OO Tool Registry | D Shell+MCP | III: ACI |
|---|---|---|---|
| Quan tâm | Đăng ký + permission | Expose qua MCP | **Thiết kế giao diện** cho model |
| Output | Đủ | Đủ | Tối giản, line-numbered, hints |
| Docs | Meta data | Schema | Khi nào dùng + giới hạn |
| Đo lường | Có tool | Có tool | **Pass rate thay đổi** |

## Khi nào chọn

- Muốn cải thiện năng lực agent mà không đổi model
- Tool set đang phình to, output rối
- Muốn benchmark tool design (đổi tool → đo pass rate)
- Sẵn sàng viết ACI spec + observation format chuẩn