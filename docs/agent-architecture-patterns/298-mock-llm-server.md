# Hướng KL: Mock LLM Server — LLM giả replay deterministic, test agent offline

> **Nguồn gốc:** WireMock; MSW (Mock Service Worker); VCR; nock; OpenAPI mock server
> **Coupling:** 🟢 — test layer, không đụng runtime
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (eval-harness sẵn — thiếu mock LLM endpoint)
> **Effort:** 1 tuần

## Nguồn gốc

**Mock server** (WireMock/MSW): đứng trước API thật, trả response cố định theo request matching — test không cần service thật, deterministic, offline. WireMock: stub mapping (request pattern → response), record/replay. MSW: intercept fetch ở service-worker layer. VCR: record HTTP call 1 lần, replay mỗi test. Nguyên tắc: test agent **không cần LLM thật** — mock đứng trước LLM endpoint, trả completion cố định theo prompt. Nhanh (không network), rẻ (không token), deterministic (cùng prompt → cùng output). Bổ sung 98 tool-mocking (mock tool) — KL mock **LLM**.

## Mô tả

mya mock LLM server: một HTTP server giả OpenAI/Anthropic endpoint. Theo prompt (hoặc prompt-hash) → trả completion đã record. Agent trỏ `baseURL` sang mock → chạy offline, không tốn token. Hai chế độ: **replay** (record 1 lần, replay — giống VCR) và **scripted** (map prompt pattern → response cố định, kể cả lỗi 429/500 để test 203 recovery). Nối 297 golden-trace (cần mock deterministic) + 91 synthetic-eval-data. Khác 98 tool-mocking (mock tool): KL mock **LLM** — agent loop chạy thật, chỉ LLM giả.

## Kiến trúc

```
  TEST ──► AGENT (loop thật: 57 plan-execute)
              │ baseURL → mock
              ▼
        ┌──────────────────┐
        │  MOCK LLM SERVER │  (giả OpenAI endpoint)
        │                  │
        │  match prompt    │
        │   ├─ replay mode:  record 1 lần → replay (VCR)
        │   └─ scripted mode: pattern → fixed response
        │       (kể cả 429/500 → test 203 recovery)
        └────────┬─────────┘
                 ▼ fixed completion (deterministic)
  Agent xử lý response thật → gọi tool (mock 98) → output
  = agent loop THẬT, chỉ LLM/tool là giả → test hành vi offline
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 41 eval-harness — eval (nơi chạy mock)
// ✅ 91 synthetic-eval-data — sinh data test (tiền đề)
// ✅ 98 tool-mocking — mock tool (KL mock LLM — bổ sung)
// ✅ 297 golden-trace — cần mock deterministic
// ✅ 05 llm-proxy — proxy LLM (có thể chèn mock)

// ❌ THIẾU: mock LLM HTTP server (giả endpoint)
// ❌ THIẾU: replay/scripted mode (match prompt → response)
// ❌ THIẾU: fault injection (429/500 → test recovery)
// ❌ THIẾU: record-once flow (capture response thật 1 lần)
```

## Implementation

```typescript
// packages/eval/src/mock-llm.ts (NEW)
import { createServer } from "node:http";

type Mode = "replay" | "scripted";
const tapes = new Map<string, { prompt: string; response: string; status?: number }>();

// record 1 lần từ LLM thật, replay mỗi test (VCR-style)
async function record(prompt: string): Promise<void> {
  const response = await realLLM.complete({ prompt });
  tapes.set(hash(prompt), { prompt, response });
}

function startMock(port: number, mode: Mode): void {
  createServer((req, res) => {
    let body = ""; req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { messages } = JSON.parse(body);
      const prompt = messages.map((m) => m.content).join("\n");
      const tape = tapes.get(hash(prompt));
      if (!tape) return res.writeHead(404).end("no tape"); // chưa record

      if (mode === "scripted" && tape.status) {
        return res.writeHead(tape.status).end(); // 429/500 → test 203
      }
      res.writeHead(200, { "content-type": "application/json" })
         .end(JSON.stringify({ choices: [{ message: { content: tape.response } }] }));
    });
  }).listen(port);
}
// Agent: baseURL = http://localhost:PORT → offline, deterministic, 0 token
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Test offline (không network/LLM thật — WireMock/MSW) | ❌ Mock ≠ LLM thật (miss behavior thật) |
| ✅ Deterministic — cùng prompt → cùng output (297) | ❌ Tape phải record/cập nhật khi prompt đổi |
| ✅ Rẻ — 0 token, chạy mỗi PR (CI) | ❌ Phải cover đủ pattern prompt |
| ✅ Fault injection (429/500 → test 203 recovery) | ❌ Scripted mode cần map thủ công |
| ✅ Nối 98 (tool) + KL (LLM) = toàn mock | |

## Khác các hướng gần

| | 98 Tool Mocking | 94 Trajectory Replay | KL: Mock LLM Server |
|---|---|---|---|
| Mock gì | Tool | Toàn session | **LLM endpoint** |
| Agent loop | Có | Replay (không chạy) | **Chạy thật** (chỉ LLM giả) |
| Mode | Schema-driven | Record cố định | **Replay + scripted + fault** |
| Mục | Test recovery tool | Debug | **Test agent offline, deterministic** |

## Khi nào chọn

- Test agent loop mà không muốn tốn token/online
- Cần deterministic cho 297 golden trace + 299 regression gate
- Muốn test 203 recovery (inject 429/500)
- CI cần chạy nhanh (mock, không đợi LLM thật)
