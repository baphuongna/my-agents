# Hướng ADP: Wrap Proxy Zero-Change — bọc agent hiện có qua proxy local, không đổi code

> **Nguồn gốc:** headroom | **Coupling:** 🟡 — proxy chặn giữa agent và LLM | **Agent-agnostic:** ✅ — hoạt động với claude/codex/copilot/... | **Code sẵn:** ⚠️ (sẵn ai bridge; thiếu proxy layer) | **Effort:** 2-3 tuần

## Nguồn gốc

**headroom** có **`headroom wrap claude|codex|copilot|...`** — bọc agent CLI hiện có chạy qua **proxy local**, không cần đổi code của agent. Proxy đứng giữa agent và LLM endpoint, cho phép chèn observability, policy, prompt transformation mà agent không biết.

Điểm đặc sắc: **`wrap` hot-sync settings** vào proxy đang chạy qua loopback **`POST /admin/runtime-env`** — thay đổi cấu hình (model, temperature, prompt) áp dụng ngay **không cần restart** (không mất cache). Đây là khác biệt với pattern thay thế agent: zero-change nghĩa là agent cũ, workflows cũ, cache cũ đều giữ nguyên — chỉ đường đi LLM đổi.

## Mô tả

Với mya, proxy layer là một **HTTP server local** (nền `packages/rpc` hoặc tcp-server) đứng trước LLM calls: agent ngoài (codex/claude) gọi endpoint proxy thay vì provider thật. Proxy xử lý: (1) **inject context** — AGENTS.md/myaguidance từ `packages/prompts`; (2) **policy** — deny tool/prompt pattern từ `packages/tools` permission; (3) **observability** — mọi request/response ghi vào `packages/audit`; (4) **admin endpoint** — hot-sync settings qua `POST /admin/runtime-env` không restart. `packages/ai` đã có `PiAiProviderBridge` — nền cho việc bọc provider.

## Kiến trúc (ASCII)

```
  AGENT CLI (codex / claude / copilot — không đổi code)
    │  LLM calls
    ▼
  PROXY LOCAL (headroom wrap)
    ├─ inject context (AGENTS.md, guidance)
    ├─ policy check (permission, deny patterns)
    ├─ observability (audit log request/response)
    └─ /admin/runtime-env (hot-sync settings — không restart)
            │
            ▼
  LLM PROVIDER THẬT (OpenAI/Anthropic/...)
            ▲
            │
  CACHE giữ nguyên (proxy không restart — cache không mất)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/rpc — RpcServer + tcp-server (nền proxy HTTP/TCP local)
// ✅ packages/ai — PiAiProviderBridge + streamWithFallback
//   (nền bọc provider — inject/policy/observability)
// ✅ packages/prompts — assemblePrompt (inject guidance vào request)
// ✅ packages/tools — permission.ts (policy check tái dùng)
// ✅ packages/audit — AuditLog (ghi request/response)

// ❌ THIẾU: proxy server nhận LLM calls từ agent ngoài
// ❌ THIẾU: /admin/runtime-env hot-sync (đổi settings không restart)
// ❌ THIẾU: protocol adapter cho từng agent CLI (codex vs claude khác nhau)
```

## Implementation

```typescript
// packages/rpc/src/proxy.ts (NEW)
export interface ProxySettings {
  model: string;
  temperature: number;
  injectGuidance: boolean;
  denyPatterns: RegExp[];
}

export class LocalProxy {
  private settings: ProxySettings = defaultSettings();

  constructor(
    private llm: ProviderProfile,
    private audit: AuditLog,
    private prompt: PromptAssembler,
  ) {}

  async handle(req: LlmRequest): Promise<LlmResponse> {
    // policy: deny pattern trước khi gọi LLM
    for (const p of this.settings.denyPatterns) {
      if (p.test(req.prompt)) return { denied: true, reason: p.source };
    }
    const final = this.settings.injectGuidance
      ? { ...req, prompt: this.prompt.assemble(req.prompt) }
      : req;
    const resp = await this.llm.complete(final);
    this.audit.log("tool", { kind: "proxy", prompt: redact(req.prompt), resp: redact(resp) });
    return resp;
  }

  // hot-sync — POST /admin/runtime-env, không restart, không mất cache
  updateSettings(patch: Partial<ProxySettings>): ProxySettings {
    this.settings = { ...this.settings, ...patch };
    return this.settings;
  }
}

export function startProxy(): http.Server {
  return createServer(async (req, res) => {
    if (req.url === "/admin/runtime-env" && req.method === "POST") {
      proxy.updateSettings(JSON.parse(await readBody(req)));
    } else {
      res.end(JSON.stringify(await proxy.handle(JSON.parse(await readBody(req)))));
    }
  });
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Zero-change — agent/cache/workflow giữ nguyên | ❌ Proxy là single point of failure |
| ✅ Hot-sync settings không restart | ❌ Mỗi agent CLI cần protocol adapter riêng |
| ✅ Chèn observability/policy không đụng code agent | ❌ SSL/streaming phức tạp khi bọc |
| ✅ Audit mọi request/response | ❌ Thêm hop — latency nhỏ nhưng có |

## Khác các hướng gần

| | ADP Wrap Proxy | ADF Madmax Profile | AEA Context Save |
|---|---|---|---|
| Đổi gì | Đường LLM (proxy) | Flags khởi động | Checkpoint state |
| Đổi code agent | Không | Không | Không |
| Mục đích | Chèn policy/observability | Mạnh execution | Resume công việc |

## Khi nào chọn

- Muốn áp dụng policy/observability cho agent ngoài không sửa được
- Cần đổi settings nóng (không restart, giữ cache)
- Đã có rpc + ai bridge + audit — thêm proxy server
- Team dùng nhiều agent CLI khác nhau cần một điểm chèn chung