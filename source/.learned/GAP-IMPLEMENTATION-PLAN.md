# GAP-IMPLEMENTATION-PLAN.md — Kế hoạch thực hiện 12 gaps

> **Nguồn:** DETAILED-COMPARISON.md gap analysis
> **Phạm vi:** Gaps 1-13 (trừ gap 14 — channel adapters)
> **Gap 7:** PWA web app (thay native mobile)
> **Cập nhật:** 2026-07-14

---

## Tổng quan phases

```
Phase A: Memory Refactor (1-3)     ████████████  Foundation
Phase B: Code Intelligence (5)      ████          High-leverage
Phase C: PWA Mobile (7)             ██████        User-facing
Phase D: Automation (6, 10)         ████████      Tool expansion
Phase E: Voice + Audio (8, 9)       ██████        Channel expansion
Phase F: Scripting + Integ (4,11,12)████████      Platform
Phase G: Security (13)              ███           Crypto
```

---

## Phase A: Memory Architecture Refactor (Gaps 1-3)

> **Lý do nhóm:** 3 gaps tightly coupled — MemoryManager cần roles, roles cần tree hierarchy. Làm cùng nhau tránh refactor 3 lần.

### Gap 1: MemoryManager Orchestrator

**Vấn đề:** Brain hiện là single monolithic class — facts/takes/tombstones/backlinks/consolidate/purge/extractFacts/embed/lint/orphans/schemaSuggest đều trong 1 file 450+ dòng.

**Giải pháp:** MemoryManager làm single integration point (hermes pattern).

```ts
// packages/memory/src/manager.ts (enhance existing)
export class MemoryManager {
  constructor(
    private brain: Brain,
    private roles: MemoryRole[],
    private backends: MemoryBackend[],
    private dreamCycle: DreamCycle,
  ) {}

  // Single entry points (agent loop chỉ gọi THESE)
  recall(query: string, opts?: RecallOpts): Promise<MemorySnapshot>
  record(fact: Omit<Fact, "id" | "createdAt">): Fact
  consolidate(): Promise<DreamResult>        // delegates to DreamCycle
  snapshot(): MemorySnapshot                  // for prompt volatile tier
  sync(remote: SyncEndpoint): Promise<SyncResult>
}
```

**Files:**
- `packages/memory/src/manager.ts` — enhance (hiện có basic version)
- `packages/agent/src/index.ts` — thay `brain.recordFact()` → `memory.record()`
- `packages/prompts/src/assembler.ts` — volatile tier gọi `memory.snapshot()`

**Effort:** 2 ngày

---

### Gap 2: Memory Roles as Separate Modules

**Vấn đề:** Brain gộp tất cả memory logic. openhuman có 13 modules tách biệt.

**Giải pháp:** Split Brain thành role modules, mỗi role 1 concern.

```
packages/memory/src/roles/
├── archivist.ts      — Lưu trữ facts, TTL management, purge scheduling
├── tree.ts           — L0/L1/L2 hierarchy (gap 3)
├── diff.ts           — Fact diffing, conflict detection
├── goals.ts          — Active goals tracking, systemPromptBlock
├── sync.ts           — HLC timestamps, LWW resolution, push/pull
├── graph.ts          — Knowledge graph edges, backlinks, orphans
├── conversations.ts  — Conversation history, context windowing
├── search.ts         — Semantic search, BM25, RRF fusion
├── sources.ts        — Push-based context sources (ragfs scanner)
├── entities.ts       — Entity extraction, schema suggestion
├── store.ts          — Backend persistence (file/SQLite/vector)
├── tools.ts          — Tool-result memory, skill-output caching
└── queue.ts          — Write queue, batch consolidation
```

**Interface chung:**
```ts
export interface MemoryRole {
  name: string;
  init(brain: Brain): void;
  record(fact: Fact): void;
  recall(query: string): MemoryEntry[];
  consolidate(now: number): ConsolidationResult;
}
```

Brain giữ lại core data structures (facts/takes/tombstones Maps) nhưng delegate logic cho roles.

**Files:**
- `packages/memory/src/roles/*.ts` — 13 new files
- `packages/memory/src/brain.ts` — slim down, delegate to roles
- `packages/memory/src/index.ts` — export roles

**Effort:** 4 ngày

---

### Gap 3: Memory Tree L0/L1/L2 Hierarchy

**Vấn đề:** Hiện chỉ có flat facts + takes. Thiếu hierarchical memory (gbrain pattern).

**Giải pháp:** 3-tier hierarchy với promotion rules.

```
L0 (Events)     — Raw facts, ephemeral, session-scoped
                  TTL: 24h hoặc until consolidated
                  Store: in-memory + ragfs scratch

L1 (Takes)      — Consolidated facts, cross-session
                  Promotion: ≥3 L0 facts per (source,entity) bucket
                  Store: persistent (file/SQLite)

L2 (Pages)      — Compiled truth, cross-project, durable
                  Promotion: ≥2 L1 takes cosine-similar → 1 BrainPage
                  Store: persistent + vector-indexed
```

**Promotion pipeline:**
```
L0 fact → consolidate() → L1 take → compile() → L2 page
                ↑                          ↑
          DreamCycle                   manual/LLM
```

**Files:**
- `packages/memory/src/tree.ts` — new MemoryTree class
- `packages/memory/src/roles/tree.ts` — tree role (gap 2 overlap)
- `packages/memory/src/brain.ts` — wire tree into consolidate()

**Effort:** 2 ngày

**Phase A tổng:** 8 ngày · **Dependencies:** None (foundational)

---

## Phase B: Code Intelligence (Gap 5)

### Gap 5: Codegraph Symbol-Level

**Vấn đề:** Hiện chỉ có file-relevance (BM25 + RRF). Thiếu symbol/reference/call-graph.

**Giải pháp:** Tree-sitter-based symbol extraction + reference graph.

**Architecture:**
```
packages/codenav/src/
├── codegraph.ts          — Graph queries (existing, enhance)
├── symbol-extractor.ts   — Tree-sitter parse → symbols (new)
├── reference-graph.ts    — Symbol refs/calls (new)
└── graph-store.ts        — Persistent graph (SQLite/JSON) (new)
```

**Symbol extraction (tree-sitter):**
```ts
interface Symbol {
  id: string;              // file:line:col:name
  name: string;
  kind: "function" | "class" | "method" | "variable" | "type" | "import";
  file: string;
  range: { start: { line: number; col: number }; end: { ... } };
  parentId?: string;       // enclosing scope
}

interface Reference {
  symbolId: string;        // referenced symbol
  fromFile: string;
  fromRange: { ... };
  kind: "call" | "read" | "write" | "import" | "definition";
}
```

**Query API:**
```ts
findDefinitions(symbolName: string): Symbol[]
findReferences(symbolId: string): Reference[]
getCallGraph(functionId: string): { callers: Symbol[]; callees: Symbol[] }
getRelatedFiles(filePath: string): string[]   // via shared symbols
```

**Tree-sitter grammars:** TS/JS (built-in), Rust, Python, Go — via `tree-sitter` npm or Rust natives.

**Files:**
- `packages/codenav/src/symbol-extractor.ts` — new
- `packages/codenav/src/reference-graph.ts` — new
- `packages/codenav/src/graph-store.ts` — new
- `packages/codenav/src/codegraph.ts` — enhance with symbol queries

**Effort:** 3 ngày · **Dependencies:** None

---

## Phase C: PWA Web App (Gap 7)

> **Quyết định:** Thay vì native iOS/Android, biến web dashboard thành PWA — installable, offline, push notifications. Một codebase, chạy mọi platform.

### Gap 7: PWA Web App

**Vấn đề:** Web dashboard hiện là SPA basic. Thiếu mobile experience, offline, install prompt.

**Giải pháp:** Full PWA với:
1. **Web App Manifest** — installable, standalone display
2. **Service Worker** — offline caching, background sync
3. **Push Notifications** — Web Push API (chat/message alerts)
4. **Responsive mobile-first** — touch-friendly UI, bottom nav
5. **App shortcuts** — quick actions (New session, Send message)

**Architecture:**
```
packages/web/
├── public/
│   ├── manifest.json         — PWA manifest (name, icons, display:standalone)
│   ├── sw.js                 — Service Worker (cache-first + network fallback)
│   ├── icons/                — 192x192, 512x512, maskable
│   └── offline.html          — Fallback page
├── src/
│   ├── pwa-register.ts       — SW registration + update prompt
│   ├── push-subscription.ts  — Web Push subscribe/unsubscribe
│   ├── mobile-nav.ts         — Bottom tab bar (Sessions/Chat/Settings)
│   ├── install-prompt.ts     — beforeinstallprompt handler
│   └── components/
│       ├── mobile-header.ts  — Sticky header with back button
│       ├── chat-view.ts      — Full-screen chat (mobile-optimized)
│       └── swipe-gestures.ts — Swipe between sessions
```

**Manifest.json:**
```json
{
  "name": "mya",
  "short_name": "mya",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#0a0a0a",
  "theme_color": "#0a0a0a",
  "icons": [
    { "src": "/icons/192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/maskable.png", "sizes": "512x512", "purpose": "maskable" }
  ],
  "shortcuts": [
    { "name": "New Session", "url": "/?action=new" },
    { "name": "Channels", "url": "/?tab=channels" }
  ]
}
```

**Service Worker strategy:**
- App shell: cache-first (HTML/JS/CSS)
- API calls: network-first, fallback to cache
- WebSocket: auto-reconnect on online
- Push events: show notification, open relevant session

**Gateway push support:**
```
POST /push/subscribe    — Save subscription (endpoint + keys)
POST /push/unsubscribe  — Remove subscription
GET  /push/vapid-key    — Public VAPID key for client
```

Gateway gửi push khi:
- Channel message received (Telegram/Discord/etc.)
- Agent turn completed
- Approval needed
- Cron job finished

**Mobile UI components:**
- Bottom nav bar (Sessions | Chat | Settings) — thumb-friendly
- Full-screen chat view with swipe-back
- Pull-to-refresh session list
- Haptic feedback (navigator.vibrate) on send/approve
- Safe area insets (notch support)

**Files:**
- `packages/web/public/manifest.json` — new
- `packages/web/public/sw.js` — new
- `packages/web/src/pwa-register.ts` — new
- `packages/web/src/push-subscription.ts` — new
- `packages/web/src/mobile-nav.ts` — new
- `packages/web/src/dashboard.ts` — enhance (responsive + mobile components)
- `packages/gateway/src/push.ts` — new (Web Push sender)
- `packages/gateway/src/index.ts` — add push endpoints

**Effort:** 4 ngày · **Dependencies:** None (web dashboard đã có)

---

## Phase D: Automation (Gaps 6, 10)

### Gap 6: Screen Intelligence (OCR + Layout)

**Vấn đề:** Chỉ có screenshot tool (capture raw image). Thiếu text extraction, layout analysis.

**Giải pháp:** OCR pipeline với layout awareness.

**Architecture:**
```ts
// packages/tools/src/screen.ts
interface ScreenCapture {
  image: Buffer;              // PNG/JPEG
  width: number;
  height: number;
  text?: ScreenTextRegion[];  // OCR results
  layout?: LayoutInfo;        // bounding boxes, regions
}

interface ScreenTextRegion {
  text: string;
  bbox: { x: number; y: number; w: number; h: number };
  confidence: number;
}

// Tools:
captureScreen(opts?: { ocr?: boolean; region?: BBox }): Promise<ScreenCapture>
extractText(image: Buffer): Promise<ScreenTextRegion[]>
findOnScreen(text: string): Promise<ScreenTextRegion[]>  // locate UI element by text
```

**OCR engine options (ranked):**
1. **Tesseract.js** — pure JS, no native deps, ~OK accuracy
2. **Rust `tesseract-rs`** — faster, via napi (fits our Rust gate)
3. **External API** (Google Vision / AWS Textract) — best accuracy, needs creds

**Recommendation:** Tesseract.js for zero-dependency MVP, Rust `tesseract-rs` for performance (gate: hot inner loop over screenshots).

**Files:**
- `packages/tools/src/screen.ts` — new (captureScreen, extractText, findOnScreen)
- `crates/natives/src/ocr.rs` — new (if Rust path chosen)

**Effort:** 2 ngày

---

### Gap 10: Browser Automation (CDP)

**Vấn đề:** Không có browser automation. Agent không thể navigate/click/scrape web pages.

**Giải pháp:** Chrome DevTools Protocol (CDP) client.

**Architecture:**
```ts
// packages/tools/src/browser.ts
class BrowserAutomation {
  async launch(opts?: { headless?: boolean }): Promise<BrowserSession>
  async navigate(url: string): Promise<PageInfo>
  async click(selector: string): Promise<void>
  async type(selector: string, text: string): Promise<void>
  async screenshot(): Promise<Buffer>
  async extractText(): Promise<string>
  async evaluate(js: string): Promise<unknown>
  async waitFor(selector: string, timeout?: number): Promise<void>
  async close(): Promise<void>
}
```

**CDP implementation options:**
1. **`chrome-launcher` + `chrome-remote-interface`** — pure JS CDP client
2. **Playwright** — full-featured, bundled browser binaries
3. **Puppeteer** — Google-maintained, Chrome-only

**Recommendation:** `chrome-remote-interface` (lightweight, no bundled browser, uses system Chrome/Chromium). Sandbox trong Docker profile (not default).

**Tools exposed to agent:**
```ts
browser_navigate(url)      — Go to URL
browser_click(selector)    — Click element
browser_type(selector, text) — Type into field
browser_screenshot()       — Capture page
browser_extract()          — Get page text/HTML
browser_eval(js)           — Run JS in page context
browser_close()            — Close session
```

**Permission:** `browser_*` tools require `Prompt` mode by default (network access = trust boundary).

**Files:**
- `packages/tools/src/browser.ts` — new
- `packages/tools/src/builtin.ts` — register browser tools

**Effort:** 3 ngày

**Phase D tổng:** 5 ngày · **Dependencies:** None

---

## Phase E: Voice + Audio (Gaps 8, 9)

### Gap 8: On-Device MLX TTS (Production)

**Vấn đề:** MLX backend đã có detection (`detectBackend`) nhưng chưa production-grade — thiếu model management, streaming, caching.

**Giải pháp:** Full MLX TTS pipeline.

**Architecture:**
```ts
// packages/tts/src/mlx.ts
class MlxTtsBackend {
  // Model management
  async ensureModel(modelId: string): Promise<string>   // download if missing
  async listModels(): Promise<MlxModel[]>
  async setDefaultModel(modelId: string): void

  // Synthesis
  async synthesize(text: string, opts?: {
    voice?: string;
    speed?: number;
    stream?: boolean;
  }): Promise<AudioStream | Buffer>

  // Streaming (chunked audio for real-time)
  async *synthesizeStream(text: string): AsyncGenerator<Buffer>
}
```

**MLX models supported:**
- `barkan-mlx` — fast, multilingual
- `parler-tts-mlx` — descriptive, voice cloning
- `kokoro-mlx` — high-quality, lightweight

**Model storage:** `~/.mya/models/tts/<modelId>/`

**CLI integration:** `mlx-tts --model barkan --text "hello" --output -` (stdout streaming)

**Files:**
- `packages/tts/src/mlx.ts` — new (production MLX backend)
- `packages/tts/src/index.ts` — enhance (wire MlxTtsBackend)
- `packages/tts/src/model-manager.ts` — new (download/cache/verify)

**Effort:** 2 ngày

---

### Gap 9: Voice Call (Twilio/Telnyx)

**Vấn đề:** Không có voice call capability. Agent không thể call/answer phone.

**Giải pháp:** Voice channel adapter với WebRTC + PSTN bridge.

**Architecture:**
```ts
// packages/channels/src/voice-call.ts
class VoiceCallChannel implements Channel {
  // Inbound (PSTN → agent)
  async handleIncomingCall(callSid: string, from: string): Promise<void>

  // Outbound (agent → PSTN)
  async placeCall(to: string, opts?: VoiceCallOpts): Promise<string>

  // Real-time audio
  async *streamAudio(callSid: string): AsyncGenerator<Buffer>   // caller → agent
  async playAudio(callSid: string, audio: Buffer): Promise<void> // agent → caller

  // Control
  async hangup(callSid: string): Promise<void>
  async hold(callSid: string): Promise<void>
}
```

**Providers (ranked):**
1. **Twilio** — most documented, Voice API + Media Streams (real-time audio)
2. **Telnyx** — cheaper, Call Control API
3. **Plivo** — alternative, similar API

**Recommendation:** Twilio first (best docs + Media Streams for real-time bidirectional audio).

**Real-time flow:**
```
Caller → Twilio → WebSocket (Media Stream) → Gateway → TTS/STT → Agent
                                                    ↓
                                              Agent response
                                                    ↓
Caller ← Twilio ← WebSocket (Media Stream) ← Gateway ← TTS audio
```

**Gateway WebSocket endpoint:**
```
WS /voice/stream/:callSid  — Bidirectional audio stream (mulaw 8kHz)
```

**Config:**
```bash
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+1234567890
```

**Files:**
- `packages/channels/src/voice-call.ts` — new
- `packages/gateway/src/voice-stream.ts` — new (WebSocket media stream handler)

**Effort:** 3 ngày

**Phase E tổng:** 5 ngày · **Dependencies:** Phase A (MemoryManager for conversation context)

---

## Phase F: Scripting + Integrations (Gaps 4, 11, 12)

### Gap 4: Embedded Scripting (Rhai)

**Vấn đề:** Workflows dùng Node `vm` module — not truly sandboxed, JS-only. openhuman uses Rhai (safe, embedded).

**Giải pháp:** Rhai engine in Rust natives, exposed via napi.

**Architecture:**
```rust
// crates/natives/src/rhai.rs
#[napi]
pub fn eval_rhai(script: String, context: serde_json::Value) -> NativeResult<serde_json::Value> {
    let mut engine = rhai::Engine::new();
    // Register agent-safe API: read_file, write_file, http_get, log
    // NO: process::exit, std::fs unrestricted, network raw
    let result = engine.eval::<rhai::Dynamic>(&script)?;
    // Convert to JSON-safe output
}
```

**Why Rhai over alternatives:**
- ✅ Sandboxed by design (no file/network access unless registered)
- ✅ Tiny (no deps), fast compilation
- ✅ Rust-native (fits our napi pattern)
- ❌ Smaller ecosystem than Lua/JS

**Alternative:** Lua via `mlua` crate (if Rhai proves limiting).

**Workflow integration:**
```ts
// packages/workflows/src/runner.ts
async function runWorkflowStep(step: WorkflowStep): Promise<StepResult> {
  if (step.type === "rhai") {
    return await evalRhai(step.script, context);  // napi call
  }
  if (step.type === "js") {
    return await runInVm(step.script, context);   // existing, kept for compat
  }
}
```

**Registered API in Rhai:**
```rhai
// Available functions (sandbox-safe)
fn read_file(path) -> string      // workspace-scoped
fn write_file(path, content)      // workspace-scoped, permission-checked
fn http_get(url) -> string        // allowlist domains
fn http_post(url, body) -> string
fn log(level, message)
fn emit_event(kind, payload)
```

**Files:**
- `crates/natives/src/rhai.rs` — new
- `crates/natives/src/lib.rs` — register rhai module
- `crates/natives/Cargo.toml` — add `rhai = "1.19"`
- `packages/workflows/src/runner.ts` — add rhai step type
- `packages/natives/src/index.ts` — expose evalRhai

**Effort:** 3 ngày

---

### Gap 11: Composio Integrations

**Vấn đề:** Không có external integration platform. Mỗi tool (Notion/Linear/Jira/etc.) cần custom adapter.

**Giải pháp:** Composio client — 250+ pre-built integrations via 1 SDK.

**Architecture:**
```ts
// packages/tools/src/composio.ts
class ComposioClient {
  constructor(apiKey: string)

  // Auth (OAuth flow)
  async initiateAuth(userId: string, toolkit: string): Promise<AuthUrl>
  async handleCallback(code: string): Promise<ConnectedAccount>

  // Tool discovery
  async listTools(toolkit?: string): Promise<ComposioTool[]>
  async getToolSchema(toolName: string): Promise<ToolSchema>

  // Execution
  async executeTool(toolName: string, params: unknown, connectedAccountId: string): Promise<ToolResult>
}
```

**Integration with mya tool registry:**
```ts
// Auto-register Composio tools as agent tools
for (const tool of await composio.listTools()) {
  registry.register({
    name: `composio_${tool.name}`,
    description: tool.description,
    schema: tool.schema,
    handler: (args) => composio.executeTool(tool.name, args, accountId),
    permission: "prompt",  // external API = trust boundary
  });
}
```

**Config:**
```bash
COMPOSIO_API_KEY=...
COMPOSIO_ENABLED_TOOLKITS=notion,linear,github,slack  # opt-in
```

**Gateway endpoints:**
```
GET  /composio/toolkits     — List available toolkits
POST /composio/auth/start   — Initiate OAuth
GET  /composio/auth/status  — Check connection
```

**Files:**
- `packages/tools/src/composio.ts` — new
- `packages/tools/src/registry.ts` — enhance (auto-register)
- `packages/gateway/src/index.ts` — add composio endpoints

**Effort:** 2 ngày

---

### Gap 12: OpenTelemetry + Langfuse Export

**Vấn đề:** Telemetry hiện chỉ có internal `AuditLog`. Thiếu structured observability export.

**Giải pháp:** OTLP exporter + Langfuse integration.

**Architecture:**
```ts
// packages/core/src/telemetry.ts (enhance)
export interface TelemetryExporter {
  startSpan(name: string, attrs?: SpanAttrs): Span
  flush(): Promise<void>
}

class OtelExporter implements TelemetryExporter {
  // OTLP/HTTP or OTLP/gRPC
  // Spans: agent.turn, tool.call, provider.stream, memory.recall
}

class LangfuseExporter implements TelemetryExporter {
  // Langfuse API (trace + generation + event)
  // Maps: agent.turn → trace, provider.stream → generation, tool.call → event
}
```

**Instrumented spans:**
```
agent.turn (root span)
├── prompt.assemble
├── provider.stream (attributes: model, tokens_in, tokens_out, latency, cost)
├── tool.call (attributes: name, subject, permission_mode, duration, success)
│   └── tool.repair (if applicable)
├── memory.recall (attributes: query, results_count, latency)
└── memory.consolidate (if dream triggered)
```

**Config:**
```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=...
OTEL_SERVICE_NAME=mya

LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_HOST=https://cloud.langfuse.com
```

**Files:**
- `packages/core/src/telemetry.ts` — enhance (OTLP + Langfuse exporters)
- `packages/core/src/loop.ts` — instrument spans
- `packages/ai/src/fallback.ts` — instrument provider calls
- `packages/tools/src/dispatch.ts` — instrument tool calls

**Effort:** 2 ngày

**Phase F tổng:** 7 ngày · **Dependencies:** None (cross-cutting)

---

## Phase G: Security (Gap 13)

### Gap 13: Device Pairing (X25519 + HKDF)

**Vấn đề:** Không có device pairing. Multi-device trust requires manual token sharing.

**Giải pháp:** ECDH key exchange + HKDF derivation + QR pairing flow.

**Architecture:**
```ts
// packages/secrets/src/pairing.ts
class DevicePairing {
  // Device A (existing device, has master secret)
  async createPairingRequest(): Promise<PairingQR> {
    // 1. Generate ephemeral X25519 keypair
    // 2. Encode: deviceId + pubkey + nonce + signature
    // 3. Return QR code data
  }

  // Device B (new device, scans QR)
  async acceptPairing(qr: PairingQR): Promise<PairedDevice> {
    // 1. Generate ephemeral X25519 keypair
    // 2. ECDH(DeviceA.pubkey, DeviceB.privkey) → shared secret
    // 3. HKDF-SHA256(shared secret, salt=nonce) → session key
    // 4. Exchange credentials over encrypted channel
    // 5. Store paired device identity
  }

  // Verify paired device on reconnect
  async verifyDevice(deviceId: string, signature: Buffer): Promise<boolean>
}
```

**Crypto primitives (node:crypto):**
```ts
import { diffieHellman, createECDH, createHmac, randomBytes } from "node:crypto";

// X25519 ECDH
const ecdh = createECDH("X25519");
const publicKey = ecdh.generateKeys();
const sharedSecret = ecdh.computeSecret(peerPublicKey);

// HKDF-SHA256
const sessionKey = hkdfSync(sharedSecret, 32, { salt: nonce, info: "mya-pairing-v1" });
```

**Pairing flow:**
```
Device A (trusted)              Device B (new)
─────────────────              ──────────────
createPairingRequest()          │
        │                       │
        ▼                       │
   ┌─────────┐                  │
   │ QR Code │ ◄── scan ─────── │ acceptPairing(qr)
   └─────────┘                  │       │
        │                       │       ▼
        │   ECDH + HKDF ◄──────►│ compute session key
        │                       │
        ▼                       ▼
   verifyDevice(B)          store PairedDevice(A)
        │                       │
        └───── TRUST ◄──────────┘
```

**Gateway endpoints:**
```
POST /pair/request     — Create pairing QR (returns pairingId + qr data)
POST /pair/accept      — Accept pairing (new device submits ECDH pubkey)
GET  /pair/devices     — List paired devices
DELETE /pair/devices/:id — Revoke device
```

**Launcher UI:** Status tab shows paired devices, option to generate QR.

**Files:**
- `packages/secrets/src/pairing.ts` — new
- `packages/gateway/src/index.ts` — add pairing endpoints
- `packages/secrets/src/index.ts` — export pairing

**Effort:** 2 ngày · **Dependencies:** None

---

## Dependency Graph

```
Phase A (Memory 1-3) ──────┬──► Phase E (Voice 8,9) [needs MemoryManager]
                           │
Phase B (Codegraph 5) ─────┼──► (independent)
                           │
Phase C (PWA 7) ───────────┼──► (independent)
                           │
Phase D (Automation 6,10)──┼──► (independent)
                           │
Phase F (Script+Integ 4,11,12)► (independent)
                           │
Phase G (Pairing 13) ──────┴──► (independent)
```

**Critical path:** Phase A → Phase E (voice needs memory context)

**Parallelizable:** B, C, D, F, G can all run in parallel after A.

---

## Effort Summary

| Phase | Gaps | Effort | Parallelizable |
|---|---|---|---|
| A: Memory Refactor | 1, 2, 3 | 8 ngày | No (foundational) |
| B: Code Intelligence | 5 | 3 ngày | Yes |
| C: PWA Mobile | 7 | 4 ngày | Yes |
| D: Automation | 6, 10 | 5 ngày | Yes |
| E: Voice + Audio | 8, 9 | 5 ngày | After A |
| F: Scripting + Integ | 4, 11, 12 | 7 ngày | Yes |
| G: Security | 13 | 2 ngày | Yes |
| **Total** | **12 gaps** | **34 ngày** | |

**With parallelism (B+C+D+F+G after A):**
```
Week 1-2:   Phase A (Memory)     ████████
Week 2-3:   Phase B+C+D+F+G      (parallel) ██████
Week 3:     Phase E (Voice)      ████
                                ≈ 3 weeks total
```

---

## Risk Assessment

| Risk | Phase | Mitigation |
|---|---|---|
| Memory refactor breaks existing tests | A | Incremental: add roles first, keep Brain API as facade, migrate callers one-by-one |
| Rhai ecosystem too small | F-4 | Fallback: Lua via `mlua` (same napi pattern) |
| CDP browser heavy dep | D-10 | Use `chrome-remote-interface` (no bundled browser), make optional |
| Composio API changes | F-11 | Pin SDK version, wrap in adapter |
| MLX macOS-only | E-8 | Auto-detect, graceful fallback to provider TTS on Linux/Windows |
| Twilio costs | E-9 | Telnyx as cheaper alternative, sandbox mode |
| PWA iOS limitations | C-7 | Test on Safari iOS specifically (push requires iOS 16.4+) |

---

## Testing Strategy

Each phase MUST:
1. **Unit tests** for new modules (roles, codegraph queries, browser tools, etc.)
2. **Integration tests** with gateway endpoints
3. **3-round review** (code + security + cold-verify) after each phase
4. **Build + bundle verify** before commit

**Test targets:**
- Phase A: +30 tests (13 roles × 2 + tree promotion)
- Phase B: +15 tests (symbol extraction, reference graph)
- Phase C: +10 tests (SW caching, push subscription, mobile components)
- Phase D: +15 tests (OCR, browser automation)
- Phase E: +12 tests (TTS synthesis, voice stream)
- Phase F: +20 tests (Rhai eval, composio tools, telemetry spans)
- Phase G: +10 tests (ECDH, HKDF, pairing flow)
- **Total: +112 tests** (477 → ~589)
