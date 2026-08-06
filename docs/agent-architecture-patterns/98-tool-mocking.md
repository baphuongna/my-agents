# Hướng CT: Tool Mocking & Simulation — test agent với tool giả có kiểm soát

> **Nguồn gốc:** Zod Contract Mock Forge MCP (2026); specmatic mock server 2026; n8n/agentbase simulation guides
> **Coupling:** 🟢 — tầng test, không đụng runtime
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (tool registry sẵn; thiếu mock layer)
> **Effort:** 1 tuần

## Nguồn gốc

Tool mocking: **thay tool thật bằng mock sinh từ schema** để test agent không side-effect — Zod Contract Mock Forge (MCP server 2026): "turns Zod schemas into mocks, violations, and contract tests — so your AI agent can reason about API contracts without manually crafting fixtures"; specmatic: mock server driven by API spec (contract testing). Với agent: mock đóng 2 vai — (1) **test nhanh** (không cần server thật, không tốn API thật, không side-effect — dev.agentbase 2026); (2) **sinh violations** (mock trả lỗi cố ý — timeout, validation, 500) → test **RRRR recovery** đúng đường. Khác **UUU…** — mock từ *schema* (cùng TTTT contract) — không phải hand-written stub; khác **QQQQ stub** (replay dùng kết quả cũ cố định) — UUUU sinh *động theo schema* (kể cả case lỗi, edge). Nối: TTTT (phát hiện drift) + UUUU (test trước khi vỡ — CI SSSS) + RRRR (test đường lỗi).

## Mô tả

mya test layer: **mock registry** — mỗi tool (MCP/local) sinh mock từ schema: (1) **happy mock** — trả output hợp schema (từ fixture/sinh hợp lệ); (2) **violation mocks** — lỗi có cấu trúc: timeout, validation, auth, not-found, business (khớp RRRR classify); (3) **edge mocks** — args trống, kết quả rỗng, trễ (n8n 2026: "agent should handle empty results"). Agent chạy trong môi trường toàn-mock → test hành vi (recovery, tool selection, fallback) không đụng hệ thống thật → chạy trong SSSS CI mỗi PR (rẻ, deterministic — mock không cần LLM nhiều). Khi server version đổi (TTTT) → mock sinh lại theo schema mới → contract test chạy.

## Kiến trúc

```
  TOOL SCHEMA (MCP/local) ──► MOCK FORGE (sinh từ schema — Zod Contract)
        ├─ happy mock: output hợp schema (fixture/sinh hợp lệ)
        ├─ violation mocks: timeout · validation · auth · not-found · business
        └─ edge mocks: rỗng · trễ · args thiếu
              │
              ▼
  AGENT TEST (toàn-mock, không side-effect)
    ├─ test tool selection đúng (RR/DD)
    ├─ test RRRR recovery trên violation (sửa params/đổi tool)
    └─ test fallback/escalate (CCC)
              │
              ▼
  SSSS CI: chạy mỗi PR — deterministic, rẻ
  TTTT drift: server đổi version → mock sinh lại → contract test
```

```
mya: tool registry + schema SẴN — thiếu: mock forge + violation generator
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools OO — registry + schema (nền mock)
// ✅ gateway/mcp-client — schema tool (nguồn mock)
// ✅ RRRR recovery — đường lỗi (cần violation mocks để test)
// ✅ SSSS CI + PP eval — nơi chạy mock tests
// ✅ QQQQ replay — stub tĩnh (bổ sung bằng mock động UUUU)

// ❌ THIẾU: mock forge (sinh happy/violation/edge từ schema)
// ❌ THIẾU: violation generator khớp RRRR classify
// ❌ THIẾU: test runner toàn-mock trong CI
```

## Implementation

```typescript
// packages/eval/src/mock-tools.ts (NEW)
interface MockTool { run(args): Promise<ToolResult>; }

function forgeMock(schema: ToolSchema, mode: MockMode): MockTool {
  switch (mode) {
    case "happy": return () => ok(genValid(schema));          // hợp schema
    case "violation": return () => fail(genViolation(schema)); // khớp RRRR kinds
    case "edge": return () => ok(genEmpty(schema));            // rỗng/trễ
  }
}

// agent chạy toàn-mock: recovery path test không side-effect
// SSSS CI: mỗi PR chạy suite mock (deterministic, rẻ — không cần server)
// TTTT: schema đổi → forgeMock sinh lại → contract test tự động
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Test không side-effect (không đụng production) | ❌ Mock khác thật — behavior lệch (khi server thật) |
| ✅ Violation mock sinh được — test đường lỗi đủ | ❐ Mock forge cần schema chuẩn (TTTT giữ) |
| ✅ Deterministic + rẻ → chạy mỗi PR (SSSS) | ❌ Overhead tạo fixture cho happy path |
| ✅ Tự sinh lại khi schema đổi (TTTT) | ❌ Mock ổn quá — miss lỗi integration thật |
| ✅ Nguồn: Zod Contract Mock Forge 2026 | |

## Khác các hướng gần

| | QQQQ Replay Stub | TTTT Drift | UUUU: Mock Forge |
|---|---|---|---|
| Dữ liệu | Kết quả cũ cố định | Diff schema | **Sinh động từ schema** |
| Mục đích | Chạy lại trace | Chặn gọi sai | **Test đường happy/lỗi** |
| Động lực | Trace thật | Detection | **Simulation (CI)** |
| Mối quan hệ | Bổ sung | Trigger UUUU | **Consumer của TTTT** |

## Khi nào chọn

- Nhiều tool external — test không muốn gọi thật
- Muốn test RRRR recovery (violation cases)
- Đã có schema + eval + CI — thêm mock layer ngắn
- Cần deterministic tests trong SSSS gate