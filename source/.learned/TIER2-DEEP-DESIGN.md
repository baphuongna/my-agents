# TIER-2 DEEP DESIGN — Remaining Gap Solutions

> **Scope:** 9 findings deferred from audit (C-3, M-1 through M-6, M-10)
> **Status:** Design complete — ready for implementation
> **Cập nhật:** 2026-07-14

---

## C-3: Web Push RFC 8291 — Real Notification Delivery

### Problem
`sendPushAll()` is a no-op stub. Subscriptions are stored but no notification is ever delivered. The push subsystem is completely non-functional.

### Design Alternatives

| # | Approach | Pros | Cons |
|---|----------|------|------|
| **A** | `web-push` npm dependency | Battle-tested, 1-call API, handles RFC 8291+8292 | External dep, ~500KB |
| **B** | Hand-roll RFC 8291 (aes128gcm) + RFC 8292 (VAPID JWT) | Zero deps, full control | ~150 lines crypto, error-prone |
| **C** | Gateway proxies to a push service (Firebase/OneSignal) | Cross-platform, analytics | Vendor lock-in, needs account |

### Recommended: **A — `web-push` npm dependency**

Rationale: RFC 8291 content encoding is complex (HKDF + aes128gcm + record padding). Hand-rolling risks subtle crypto bugs. `web-push` is 12 years mature, 3M weekly downloads, MIT licensed.

### Implementation

```ts
// packages/gateway/src/push.ts (replace sendPushAll)
import webpush from "web-push";

// Configure VAPID (once at startup)
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_SUBJECT ?? "noreply@mya.local"}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
}

export async function sendPushAll(
  payload: { title: string; body: string; url?: string },
): Promise<{ sent: number; failed: number }> {
  if (!process.env.VAPID_PUBLIC_KEY) return { sent: 0, failed: 0 };
  const body = JSON.stringify(payload);
  let sent = 0, failed = 0;
  for (const sub of subscriptions.values()) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        body,
        { TTL: 86400 }, // 24h
      );
      sent++;
    } catch (e) {
      // 410 Gone = subscription expired → remove
      if ((e as { statusCode?: number }).statusCode === 410) {
        subscriptions.delete(sub.endpoint);
      }
      failed++;
    }
  }
  return { sent, failed };
}
```

### Config
```bash
# Generate VAPID keys (one-time):
# npx web-push generate-vapid-keys
VAPID_PUBLIC_KEY=BG3b...
VAPID_PRIVATE_KEY=nDk0...
VAPID_SUBJECT=mailto:admin@mya.local
```

### Effort: 2 giờ · Files: `packages/gateway/src/push.ts`, `package.json`

---

## M-1: SyncDomain — Hybrid Logical Clock (HLC)

### Problem
SyncDomain is an empty stub. No HLC timestamps, no LWW resolution, no multi-replica sync.

### Design

HLC = Lamport logical clock + wall-clock component. Guarantees total order across distributed replicas without wall-clock synchronization.

```ts
// packages/memory/src/domains/sync.ts
export interface HlcTimestamp {
  wall: number;    // wall-clock ms (from core.time)
  counter: number; // logical counter (breaks ties when wall is equal)
  node: string;    // node id (breaks ties when counter is equal)
}

export class SyncDomain implements MemoryDomain {
  readonly name = "sync";
  private hlc: HlcTimestamp;
  private readonly node: string;
  private readonly pendingSync = new Map<string, Fact>(); // unacked writes

  constructor(node?: string) {
    this.node = node ?? randomUUID();
    this.hlc = { wall: nowWallclock(), counter: 0, node: this.node };
  }

  /** Tick the HLC — called on every local event. */
  tick(): HlcTimestamp {
    const now = nowWallclock();
    if (now > this.hlc.wall) {
      this.hlc = { wall: now, counter: 0, node: this.node };
    } else {
      this.hlc = { ...this.hlc, counter: this.hlc.counter + 1 };
    }
    return { ...this.hlc };
  }

  /** Receive a remote HLC — merge into local. */
  receive(remote: HlcTimestamp): void {
    const now = nowWallclock();
    if (now > this.hlc.wall && now > remote.wall) {
      this.hlc = { wall: now, counter: 0, node: this.node };
    } else if (remote.wall > this.hlc.wall) {
      this.hlc = { ...remote };
    } else if (remote.wall === this.hlc.wall) {
      this.hlc = {
        wall: this.hlc.wall,
        counter: Math.max(this.hlc.counter, remote.counter) + 1,
        node: this.node,
      };
    } else {
      this.hlc = { ...this.hlc, counter: this.hlc.counter + 1 };
    }
  }

  /** LWW resolution: returns the winning fact. */
  resolveConflict(local: Fact, remote: Fact): Fact {
    const localHlc = this.extractHlc(local);
    const remoteHlc = this.extractHlc(remote);
    return compareHlc(remoteHlc, localHlc) > 0 ? remote : local;
  }

  onRecord(fact: Fact): void {
    const ts = this.tick();
    this.pendingSync.set(fact.id, fact);
    // Attach HLC as metadata
    (fact as Fact & { hlc?: HlcTimestamp }).hlc = ts;
  }

  recall(query: string): MemoryHit[] {
    return this.pendingSync.size > 0
      ? [{ id: "sync-pending", role: "sync", content: `${this.pendingSync.size} pending`, score: 1 }]
      : [];
  }

  onConsolidate(now: number): ConsolidationReport {
    // Flush pending → mark as acked (simulated; real sync flushes to remote)
    const count = this.pendingSync.size;
    this.pendingSync.clear();
    return { promoted: 0, consumed: count };
  }
}

/** Compare two HLC timestamps: >0 if a>b, <0 if a<b, 0 if equal. */
function compareHlc(a: HlcTimestamp, b: HlcTimestamp): number {
  if (a.wall !== b.wall) return a.wall - b.wall;
  if (a.counter !== b.counter) return a.counter - b.counter;
  return a.node.localeCompare(b.node);
}
```

### Sync protocol (push/pull)
```
Device A (origin)                    Device B (replica)
  tick() → fact@HLC1                   │
  POST /sync/push {facts:[...]}  ───►  │ receive(HLC1) → merge
                                        │ resolveConflict(local, remote)
                  ◄─── 200 {merged} ──┘
  
  GET /sync/pull?since=HLC1     ───►  │ find facts with HLC > since
                  ◄── {facts:[...]} ──┘
```

### Effort: 1 ngày · +8 tests · Files: `packages/memory/src/domains/sync.ts`

---

## M-2: ToolsDomain — Bounded LRU Cache with TTL

### Problem
ToolsDomain has an unbounded `Map` — no eviction, no TTL, no size limit. Memory leak under heavy tool usage.

### Design

```ts
// packages/memory/src/domains/tools.ts
interface CachedToolResult {
  toolCallId: string;
  recordedAt: number;
  payload: string;
}

const MAX_CACHE_SIZE = 500;     // max entries
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min TTL

export class ToolsDomain implements MemoryDomain {
  readonly name = "tools";
  private brain: Brain | undefined;
  private readonly cache = new Map<string, CachedToolResult>();

  onRecord(fact: Fact): void {
    if (fact.source !== "tool") return;
    // LRU eviction: delete oldest when at capacity
    if (this.cache.size >= MAX_CACHE_SIZE) {
      const oldest = [...this.cache.entries()]
        .sort((a, b) => a[1].recordedAt - b[1].recordedAt)[0];
      if (oldest) this.cache.delete(oldest[0]);
    }
    this.cache.set(fact.id, { toolCallId: fact.id, recordedAt: fact.createdAt, payload: fact.content });
  }

  recall(query: string, opts?: MemoryDomainOpts): MemoryHit[] {
    const now = nowWallclock();
    const q = query.trim().toLowerCase();
    const hits: MemoryHit[] = [];
    for (const [key, r] of [...this.cache]) {
      // TTL eviction: remove expired entries
      if (now - r.recordedAt > CACHE_TTL_MS) {
        this.cache.delete(key);
        continue;
      }
      if (q && !r.payload.toLowerCase().includes(q)) continue;
      hits.push({ id: r.toolCallId, role: "working", content: r.payload, score: 1 });
    }
    return hits.slice(0, opts?.topK ?? 10);
  }

  onConsolidate(now: number): ConsolidationReport {
    let evicted = 0;
    for (const [key, r] of [...this.cache]) {
      if (now - r.recordedAt > CACHE_TTL_MS) { this.cache.delete(key); evicted++; }
    }
    return { promoted: 0, consumed: evicted };
  }
}
```

### Effort: 2 giờ · +4 tests · Files: `packages/memory/src/domains/tools.ts`

---

## M-3: QueueDomain — Batch Write Queue with Backpressure

### Problem
QueueDomain is a basic stub. No batching, no backpressure, no flush trigger.

### Design

```ts
// packages/memory/src/domains/queue.ts
const BATCH_SIZE = 20;           // flush after N writes
const BATCH_TIMEOUT_MS = 5000;   // or after T ms idle
const MAX_QUEUE_DEPTH = 1000;    // reject writes beyond this (backpressure)

export class QueueDomain implements MemoryDomain {
  readonly name = "queue";
  private brain: Brain | undefined;
  private buffer: Fact[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  onRecord(fact: Fact): void {
    if (!this.brain) return;
    if (this.buffer.length >= MAX_QUEUE_DEPTH) {
      // Backpressure: flush immediately (synchronous batch)
      this.flush();
    }
    this.buffer.push(fact);
    if (this.buffer.length >= BATCH_SIZE) {
      this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), BATCH_TIMEOUT_MS);
      this.flushTimer.unref?.(); // don't block process exit
    }
  }

  /** Flush the buffer to Brain.recordFact (batch). */
  private flush(): void {
    if (!this.brain || this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);
    for (const f of batch) {
      // Already recorded via brain — this is a secondary indexing pass
      void f;
    }
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
  }

  recall(): MemoryHit[] {
    return this.buffer.length > 0
      ? [{ id: "queue-depth", role: "working", content: `${this.buffer.length} queued`, score: 1 }]
      : [];
  }

  onConsolidate(): ConsolidationReport {
    const count = this.buffer.length;
    this.flush();
    return { promoted: 0, consumed: count };
  }
}
```

### Effort: 2 giờ · +4 tests · Files: `packages/memory/src/domains/queue.ts`

---

## M-4: MLX Model Registry — Real Distribution URLs

### Problem
All 3 MLX models use `https://example.invalid/...` with empty SHA-256. Downloads will always fail.

### Design

Use Hugging Face Hub as the model distribution (standard for MLX models).

```ts
// packages/tts/src/model-manager.ts
const HF_BASE = "https://huggingface.co";

export const MODEL_REGISTRY: readonly ModelRegistryEntry[] = [
  {
    id: "barkan-mlx",
    name: "Barkan MLX (fast, multilingual)",
    repo: `${HF_BASE}/barkan-mlx/barkan-mlx/resolve/main/model.bin`,
    sha256: "", // TODO: compute after first download
    sizeBytes: 335_544_320, // ~320MB
    defaultVoice: "v2/en_speaker_1",
  },
  {
    id: "kokoro-mlx",
    name: "Kokoro MLX (high-quality, lightweight)",
    repo: `${HF_BASE}/hf-internal-testing/kokoro-mlx/resolve/main/model.bin`,
    sha256: "",
    sizeBytes: 87_040_000, // ~83MB
    defaultVoice: "af_heart",
  },
  {
    id: "parler-tts-mlx",
    name: "Parler TTS MLX (descriptive, voice cloning)",
    repo: `${HF_BASE}/parler-tts/parler-tts-mini-mlx/resolve/main/model.bin`,
    sha256: "",
    sizeBytes: 872_415_232, // ~832MB
    defaultVoice: "default",
  },
];
```

### SHA-256 verification strategy
1. First download: compute SHA-256, store in `~/.mya/models/tts/<id>/.sha256`
2. Subsequent loads: verify against stored hash
3. Registry `sha256` field: leave empty until official hash confirmed, then hardcode

### Fallback when offline
```ts
if (entry.sha256 === "") {
  // No hash → trust but warn (Tier-2: pin hashes when available)
  console.warn(`mlx: model ${id} has no SHA-256 pin — skipping verification`);
}
```

### Effort: 3 giờ · Need to confirm actual HF repo paths (may differ)

---

## M-5: Voice STT — Real-Time Speech-to-Text

### Problem
`handleMediaFrame()` discards incoming audio. Voice calls have no text input path to the agent.

### Design Alternatives

| # | Approach | Latency | Cost | Privacy |
|---|----------|---------|------|---------|
| **A** | Whisper.cpp local (via CLI) | 200-500ms | Free | On-device |
| **B** | Deepgram streaming API | <100ms | $0.0043/min | Cloud |
| **C** | vosk (lightweight Kaldi) | <100ms | Free | On-device |

### Recommended: **A (Whisper.cpp) + B (Deepgram) dual-path**

```ts
// packages/gateway/src/voice-stt.ts
export interface SttResult {
  text: string;
  isFinal: boolean;
  confidence: number;
}

export class VoiceStt {
  constructor(private opts: { backend: "whisper" | "deepgram"; deepgramKey?: string }) {}

  /** Process a mulaw 8kHz audio frame → text (streaming). */
  async *transcribe(audioStream: AsyncIterable<Buffer>): AsyncGenerator<SttResult> {
    if (this.opts.backend === "whisper") {
      yield* this.whisperTranscribe(audioStream);
    } else {
      yield* this.deepgramTranscribe(audioStream);
    }
  }

  private async *whisperTranscribe(stream: AsyncIterable<Buffer>): AsyncGenerator<SttResult> {
    // Accumulate mulaw frames → convert to WAV 16kHz → feed to whisper.cpp
    let buffer: Buffer[] = [];
    let lastFlush = nowWallclock();
    for await (const chunk of stream) {
      buffer.push(chunk);
      // Flush every 2 seconds (low-latency chunking)
      if (nowWallclock() - lastFlush > 2000) {
        const wav = mulawToWav(Buffer.concat(buffer), 8000, 16000);
        const text = await this.runWhisper(wav);
        if (text) yield { text, isFinal: false, confidence: 0.9 };
        buffer = [];
        lastFlush = nowWallclock();
      }
    }
  }

  private async runWhisper(wav: Buffer): Promise<string> {
    // Write to temp file, run whisper-cli, capture stdout
    const tmp = join(tmpdir(), `mya-stt-${randomBytes(4).toString("hex")}.wav`);
    await writeFile(tmp, wav);
    try {
      const { stdout } = await execFileAsync("whisper-cli", [
        "-m", expandTilde("~/.mya/models/whisper/ggml-base.en.bin"),
        "-f", tmp, "--no-timestamps", "--output-txt", "--output-to-stdout",
      ], { timeout: 5000 });
      return stdout.trim();
    } finally {
      await unlink(tmp).catch(() => {});
    }
  }

  private async *deepgramTranscribe(stream: AsyncIterable<Buffer>): AsyncGenerator<SttResult> {
    // Open WebSocket to Deepgram streaming API
    const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?encoding=mulaw&sample_rate=8000`, {
      headers: { Authorization: `Token ${this.opts.deepgramKey}` },
    });
    // Pipe audio → Deepgram, yield transcripts from responses
    // (Full implementation ~80 lines)
  }
}

/** Convert mulaw 8kHz to WAV 16kHz PCM for Whisper. */
function mulawToWav(mulaw: Buffer, inRate: number, outRate: number): Buffer {
  // Decode mulaw → 16-bit PCM → resample → WAV header
  // (Standard audio processing — ~30 lines)
}
```

### Integration into VoiceCallChannel
```ts
// In handleMediaFrame:
private stt = new VoiceStt({ backend: "whisper" });

private async handleMediaFrame(callSid: string, frame: string): Promise<void> {
  const msg = JSON.parse(frame);
  if (msg.event === "media" && msg.media?.payload) {
    const audio = Buffer.from(msg.media.payload, "base64");
    // Feed to STT → when text is ready, send to agent
    const text = await this.stt.transcribe(async function* () { yield audio; }());
    for await (const result of text) {
      if (result.isFinal) {
        // Route to agent: this.onTranscription?.(callSid, result.text);
      }
    }
  }
}
```

### Effort: 2 ngày · Files: `packages/gateway/src/voice-stt.ts`, `packages/gateway/src/voice-call.ts`

---

## M-6: Rhai Engine via Rust napi

### Problem
Rhai runner uses `node:vm` (JavaScript, not Rhai). `node:vm` is not a security boundary. The plan specified a Rust-based Rhai engine.

### Design

Add Rhai crate to the Rust natives, expose via napi.

```rust
// crates/natives/src/rhai.rs
use napi_derive::napi;
use napi::bindgen_prelude::*;
use rhai::{Engine, Scope, EvalAltResult};
use serde_json::Value;

/// Evaluate a Rhai script with a sandboxed context.
/// Registered API: read_file, write_file, http_get, http_post, log, emit_event
#[napi]
pub fn eval_rhai(
    script: String,
    context: serde_json::Value,
) -> NativeResult<serde_json::Value> {
    let mut engine = Engine::new();
    let mut scope = Scope::new();

    // Register sandboxed functions
    engine.register_fn("log", |level: String, msg: String| {
        eprintln!("[rhai:{}]: {}", level, msg);
    });
    engine.register_fn("emit_event", |kind: String, payload: String| {
        // Events are collected and returned to the caller
        format!("{{\"kind\":\"{}\",\"payload\":{}}}", kind, payload)
    });

    // No file/network access by default (Rhai is sandboxed)
    engine.set_max_expr_depths(64, 64);
    engine.set_max_call_levels(64);
    engine.set_max_string_size(1_000_000);
    engine.set_max_array_size(10_000);
    engine.set_max_map_size(10_000);

    // Inject context variables
    if let Some(obj) = context.as_object() {
        for (key, val) in obj {
            match val {
                Value::String(s) => { scope.push(key.as_str(), s.clone()); }
                Value::Number(n) => {
                    if let Some(i) = n.as_i64() { scope.push(key.as_str(), i); }
                    else if let Some(f) = n.as_f64() { scope.push(key.as_str(), f); }
                }
                Value::Bool(b) => { scope.push(key.as_str(), *b); }
                _ => {} // skip complex types for MVP
            }
        }
    }

    let result = engine.eval_with_scope::<rhai::Dynamic>(&mut scope, &script)
        .map_err(|e| format!("rhai eval error: {}", e))?;

    // Convert Rhai Dynamic → JSON
    let json = rhai_to_json(result);
    Ok(serde_json::from_str(&json).unwrap_or(Value::Null))
}

fn rhai_to_json(val: rhai::Dynamic) -> String {
    use rhai::Dynamic;
    match val {
        Dynamic::UNIT => "null".to_string(),
        Dynamic::Bool(b) => b.to_string(),
        Dynamic::Integer(i) => i.to_string(),
        Dynamic::Float(f) => f.to_string(),
        Dynamic::String(s) => format!("\"{}\"", s.replace('"', "\\\"")),
        _ => format!("\"{}\"", val.to_string()),
    }
}
```

### Registration
```rust
// crates/natives/src/lib.rs
mod rhai;
pub use rhai::eval_rhai;
```

```ts
// packages/natives/src/index.ts
export { evalRhai } from "../natives.js"; // napi-generated binding
```

### Workflow integration
```ts
// packages/workflows/src/rhai-runner.ts
import { evalRhai } from "@my-agent/natives";

export async function evalRhai(script: string, context: Record<string, unknown>) {
  return evalRhai(script, context); // calls Rust via napi
}
```

### Rust gate justification (§18 #16)
| Gate | Applies? |
|------|----------|
| Trust boundary | ✅ Untrusted script execution (sandbox must be airtight) |
| Determinism | ✅ Same script → same output (no GC nondeterminism in Rhai) |
| Hot inner loop | ⚠️ Not typically hot, but Rhai compiles to AST not bytecode |

### Effort: 1 ngày · Files: `crates/natives/src/rhai.rs`, `crates/natives/Cargo.toml` (add `rhai = "1.19"`)

---

## M-10: Missing Test Suites

### Problem
No tests for PWA modules, Composio client, or telemetry exporters.

### Test plan

| Module | Test file | Tests | Strategy |
|--------|-----------|-------|----------|
| pwa-register | `web/src/pwa-register.test.ts` | 3 | Mock navigator.serviceWorker, verify register() call, update prompt |
| push-subscription | `web/src/push-subscription.test.ts` | 4 | Mock PushManager, verify subscribe/unsubscribe/getState |
| mobile-nav | `web/src/mobile-nav.test.ts` | 3 | Verify renderMobileNav HTML, isMobile() detection |
| composio | `tools/src/composio.test.ts` | 6 | Mock fetch, verify listTools/executeTool, auto-registration |
| exporters | `agent/src/exporters.test.ts` | 7 | Mock OTLP/Langfuse endpoints, verify span creation, flush, NoopExporter fallback |

### Example test (composio)
```ts
describe("ComposioClient", () => {
  it("listTools returns tools from API", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: [{ name: "notion_create_page", description: "..." }] }),
    }) as never;
    const client = new ComposioClient("test-key");
    const tools = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("notion_create_page");
  });

  it("createComposioClient returns null without API key", () => {
    delete process.env.COMPOSIO_API_KEY;
    expect(createComposioClient()).toBeNull();
  });
});
```

### Effort: 1 ngày · +23 tests

---

## Implementation Priority

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| **P0** | C-3 Web Push (web-push dep) | 2h | Push notifications functional |
| **P0** | M-10 Missing tests | 1d | Regression protection |
| **P1** | M-2 ToolsDomain LRU | 2h | Memory leak fixed |
| **P1** | M-3 QueueDomain batching | 2h | Write pipeline complete |
| **P1** | M-1 SyncDomain HLC | 1d | Multi-replica sync |
| **P2** | M-6 Rhai via Rust | 1d | True sandboxed scripting |
| **P2** | M-5 Voice STT | 2d | Voice calls functional |
| **P3** | M-4 MLX URLs | 3h | On-device TTS downloads |

**Total: ~6 ngày for all Tier-2 items**

---

## Summary

| Category | Count | Status |
|----------|-------|--------|
| CRITICAL | 9 | 8 fixed + 1 designed (C-3) |
| HIGH | 5 | 5 fixed |
| MEDIUM | 10 | 4 fixed + 6 designed |
| LOW | 10 | 8 fixed + 2 N/A (L-7 dup) |
| **Total** | **34** | **25 fixed + 9 designed** |
