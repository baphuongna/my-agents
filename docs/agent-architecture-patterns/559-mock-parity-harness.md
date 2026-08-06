# Hướng UM: Mock-Parity Harness — mock API service + compat-harness + scenarios JSON để deterministic replay và diff so với reference CLI

> **Nguồn gốc:** claw-code `mock-anthropic-service` (`mock_service.ts`, `compat-harness.ts`, `mock_parity_scenarios.json`); "deterministic replay"; "diff vs reference CLI"; "request/response capture"; "fixture parity" | **Coupling:** 🟡 — thêm mock-service layer + scenario fixtures vào test harness (chặn API call → trả fixture cố định) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (eval + tool-mocking sẵn — chưa có deterministic scenario replay + CLI diff) | **Effort:** 3-4 tuần

## Nguồn gốc

**claw-code** khi port/rewrite một reference CLI cần chứng minh **parity** (đầu ra giống reference). Nhưng gọi API thật thì **non-deterministic** (model có thể trả khác nhau mỗi lần → không diff được). Giải pháp: **mock-anthropic-service** — một HTTP server giả lập API, **capture** request/response lần đầu (ghi vào `mock_parity_scenarios.json`), rồi **replay** cố định (cùng request → trả đúng response đã capture). Khi đó cả **reference CLI** và **đang-port CLI** đều gọi mock → **đầu ra deterministic** → **diff** được. Nguyên tắc: **capture once, replay forever** — loại bỏ non-determinism để test parity chính xác.

## Mô tả

mya mock-parity harness: (1) **Mock service**: HTTP server chặn API call (Anthropic/OpenAI), trả response từ fixture. (2) **Capture**: lần đầu gọi API thật → ghi request+response vào `scenarios.json` (key = hash request). (3) **Replay**: lần sau, cùng request → trả response đã capture (deterministic, không gọi thật). (4) **Compat-harness**: chạy cả reference CLI và mya, mỗi cái gọi mock → capture đầu ra. (5) **Diff**: so sánh đầu ra reference vs mya → phát hiện parity gap. mya có eval + tool-mocking — UM thêm **deterministic mock service** + **scenario capture/replay** + **CLI diff harness**.

## Kiến trúc

```
  ┌─── COMPAT-HARNESS (chạy 2 CLI song song) ────────────┐
  │  reference CLI ──┐                          ┐ mya CLI │
  └──────────────────┼──────────────────────────┼─────────┘
                     │ (cả 2 gọi API)           │
                     ▼                          ▼
  ┌─── MOCK SERVICE (chặn API call) ─────────────────────┐
  │  request → hash key → lookup scenarios.json           │
  │  HIT  → return captured response (deterministic)      │
  │  MISS → call real API → CAPTURE → store → return      │
  └───────────────────────┬─────────────────────────────┘
                          │ (cả 2 cùng response)
                          ▼
  ┌─── DIFF (reference vs mya output) ───────────────────┐
  │  ref output:  "Result: 42"                             │
  │  mya output:  "Result: 42"                             │
  │  → MATCH ✓ (parity OK) / DIFFER ✗ (parity gap)        │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/eval — benchmark harness (nền — UM compat-harness)
// ✅ 098 tool-mocking — mock tool output (nền — UM mock service)
// ✅ packages/ai provider — API call (nền — UM chặn + capture)

// ❌ THIẾU: mock HTTP service (chặn API → trả fixture)
// ❌ THIẾU: scenario capture/replay (hash key → lookup/capture)
// ❌ THIẾU: CLI diff harness (chạy ref + mya → so sánh)
// ❌ THIẾU: deterministic normalizer (canonicalize trước diff)
```

## Implementation

```typescript
// packages/eval/src/mock-parity-harness.ts (MỚI)
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

interface Scenario { key: string; request: unknown; response: unknown }
interface MockService {
  handle(req: unknown): Promise<unknown>; // lookup or capture
  save(): Promise<void>;
}

class ScenarioStore {
  private scenarios = new Map<string, Scenario>();
  constructor(private path: string) {}
  static async load(path: string): Promise<ScenarioStore> {
    const s = new ScenarioStore(path);
    try {
      const raw = JSON.parse(await readFile(path, 'utf8')) as Scenario[];
      for (const sc of raw) s.scenarios.set(sc.key, sc);
    } catch { /* empty store */ }
    return s;
  }
  key(req: unknown): string { return createHash('sha256').update(JSON.stringify(req)).digest('hex').slice(0, 16); }
  has(key: string): boolean { return this.scenarios.has(key); }
  get(key: string): Scenario | undefined { return this.scenarios.get(key); }
  put(sc: Scenario): void { this.scenarios.set(sc.key, sc); }
  async save(): Promise<void> { await writeFile(this.path, JSON.stringify([...this.scenarios.values()], null, 2)); }
}

function makeMockService(store: ScenarioStore, realApi: (req: unknown) => Promise<unknown>): MockService {
  return {
    async handle(req) {
      const k = store.key(req);
      if (store.has(k)) return store.get(k)!.response; // replay (deterministic)
      const response = await realApi(req); // miss → capture
      store.put({ key: k, request: req, response });
      await store.save();
      return response;
    },
    save: () => store.save(),
  };
}

// compat-harness: chạy reference + mya qua cùng mock → diff
async function parityDiff(
  runCli: (mock: MockService) => Promise<string>,
  ref: MockService, mya: MockService,
): Promise<{ ok: boolean; refOut: string; myaOut: string }> {
  const refOut = await runCli(ref);
  const myaOut = await runCli(mya);
  return { ok: refOut === myaOut, refOut, myaOut }; // match = parity
}

// Usage:
// const mock = makeMockService(await ScenarioStore.load('scenarios.json'), realApi);
// ref + mya cùng gọi mock → deterministic → diff parity
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Deterministic (capture → replay, loại non-determinism) | ❌ Capture cold-start (lần đầu gọi API thật) |
| ✅ Parity measurable (diff reference vs mya chính xác) | ❌ Fixture staleness (model update → response cũ) |
| ✅ Reproducible test (cùng scenario → cùng output) | ❌ Request-hash collision (key khác request giống) |
| ✅ Offline test (sau capture, không cần API key) | ❌ Non-deterministic field (timestamp/uuid → normalize) |

## Khác các hướng gần

| | 098 Tool-Mocking | 091 Synthetic-Eval | UM: Mock-Parity-Harness |
|---|---|---|---|
| Cái gì | Mock tool output | Sinh data test | **Capture/replay API + diff CLI** |
| Mục đích | Cô lập tool | Đa dạng test | **Parity vs reference** |
| Deterministic | ⚠️ (static stub) | ✅ | **✅ capture-replay** |

## Khi nào chọn

- Port/rewrite một reference CLI → cần chứng minh parity đầu ra
- Test non-deterministic (model output) → cần deterministic replay
- Muốn offline test (sau capture, không cần API key)
- Nối packages/eval + 098 tool-mocking + packages/ai provider; guard deterministic normalizer (canonicalize timestamp/uuid trước diff), fixture freshness (re-capture khi model update), và request-keying stability (hash theo field cố định, bỏ volatile); UM = mock-parity harness, kết hợp 091 synthetic-eval (đa dạng scenario) + 94 trajectory-replay (replay để verify)
