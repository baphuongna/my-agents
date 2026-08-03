# mya — Kiến trúc Hiện tại (Aug 2026)

> Tổng quan cách mya hoạt động, từ CLI → gateway → LLM → memory → WS broadcast.

---

## 1. Entry Points & CLI Modes

```
┌─────────────────────────────────────────────────────────────────────┐
│  $ mya                          # Interactive TUI (pi InteractiveMode) │
│  $ mya "prompt"                 # One-shot print mode                  │
│  $ mya --json "prompt"          # One-shot NDJSON stream               │
│  $ mya serve [--port 3000]      # Web gateway + dashboard              │
│  $ mya launcher                 # Launcher loop (multi-session)         │
│  $ mya cron list|add|run        # Cron management                      │
│  $ mya channels list|add|test   # Channel management                   │
│  $ mya agents                   # Agent status                          │
└─────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
              ┌──────────────────────┐
              │  packages/print/     │
              │  src/main.ts         │
              │  (CLI dispatcher)    │
              └──────────────────────┘
                    │           │
        ┌───────────┘           └───────────┐
        ▼                                   ▼
┌──────────────────┐              ┌─────────────────────┐
│  Interactive TUI │              │  runWebServer()     │
│  (pi InterMode)  │              │  HTTP + WS gateway  │
│                  │              │                     │
│  mya-bridge ext  │              │  RuntimePool        │
│  pi-intercom ext │              │  SmartRouter        │
│                  │              │  CostTracker        │
│  Shared singlet. │              │  MemoryEnricher     │
└──────────────────┘              └─────────────────────┘
        │                                   │
        └───────────┬───────────────────────┘
                    ▼
         ┌────────────────────┐
         │  shared-instances  │  ← TẤT CẢ mode dùng chung
         │  .ts (singletons)  │
         └────────────────────┘
```

---

## 2. Gateway Mode — Full Architecture

```
                    ┌─────────────────────────────────────────┐
                    │            USER (Browser/CLI)            │
                    └──────────────┬──────────────────────────┘
                                   │
                    HTTP REST + WebSocket
                                   │
    ┌──────────────────────────────┼──────────────────────────────┐
    │                              │                              │
    ▼                              ▼                              ▼
┌─────────┐              ┌──────────────┐               ┌──────────────┐
│ HTTP    │              │ WebSocket    │               │ Static SPA   │
│ Control │              │ /events      │               │ (React dash) │
│ Plane   │              │ (broadcast)  │               │ 38 pages     │
└────┬────┘              └──────┬───────┘               └──────────────┘
     │                          │
     │ POST /pool/acquire       │ WS events (pi raw shape)
     │ POST /pool/prompt/:sid   │ message_update/text_delta
     │ DELETE /pool/:sid        │ tool_call / tool_result
     │ GET /cron/jobs           │ turn_start / turn_end
     │ GET /status              │
     │ GET /models              │
     │ POST /providers/:id/oauth│
     │                          │
     ▼                          │
┌──────────────────────────────────────────────────────────────────┐
│                        Gateway (index.ts)                        │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ CronSweeper │  │ Auth (token) │  │ Hermes SPA stubs       │  │
│  │ 30s interval│  │ + Origin chk │  │ (compat endpoints)     │  │
│  └──────┬──────┘  └──────────────┘  └────────────────────────┘  │
│         │                                                        │
│         │ poolAcquire / poolPrompt / poolKill                    │
│         ▼                                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    RuntimePool                           │   │
│  │                                                          │   │
│  │  entries: Map<sid, {session, runtimeType, createdAt}>   │   │
│  │  maxSessions: 1000 (env override)                       │   │
│  │  idleTtl: 1h    sweep: 60s                               │   │
│  │                                                          │   │
│  │  acquireWithRuntime(sid, {agentType})                    │   │
│  │    → SmartRouter.route(agentType)                        │   │
│  │    → runtime.start(opts)                                 │   │
│  │    → new RuntimeSessionAdapter(session, costTracker)     │   │
│  └──────────────────────────────────────────────────────────┘   │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   SmartRouter                            │   │
│  │                                                          │   │
│  │  Scores each runtime by:                                 │   │
│  │    - availability (isAvailable())                        │   │
│  │    - keyword match (compiled regex)                      │   │
│  │    - cost preference                                     │   │
│  │    - explicit agentType override                         │   │
│  │                                                          │   │
│  │  ┌─────────┐ ┌────────────┐ ┌──────────┐                │   │
│  │  │ "pi"    │ │"mya-native"│ │ "claude" │                │   │
│  │  │DEFAULT  │ │fallback    │ │if CLI    │                │   │
│  │  │in-proc  │ │in-proc     │ │subproc   │                │   │
│  │  └────┬────┘ └─────┬──────┘ └────┬─────┘                │   │
│  └───────┼────────────┼─────────────┼──────────────────────┘   │
│          │            │             │                           │
└──────────┼────────────┼─────────────┼───────────────────────────┘
           ▼            ▼             ▼
```

---

## 3. PiInProcessRuntime — Chi tiết Session

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PiInProcessRuntime                                │
│                                                                     │
│  start(opts) → new PiInProcessSession(piSession, opts)              │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              createAgentSession (from pi)                     │  │
│  │                                                               │  │
│  │  Extensions (injected into pi):                               │  │
│  │  ┌──────────────────┐  ┌──────────────────┐                  │  │
│  │  │ mya-bridge       │  │ pi-intercom       │                  │  │
│  │  │ (tools + hooks)  │  │ (broker messaging)│                  │  │
│  │  └────────┬─────────┘  └──────────────────┘                  │  │
│  │           │                                                   │  │
│  │  ┌────────┼─────────────────────────────────────────────┐    │  │
│  │  │        ▼ TOOLS INJECTED INTO pi AgentSession         │    │  │
│  │  │                                                       │    │  │
│  │  │  Builtin (7):     mya-bridge (10+):    MCP (38):     │    │  │
│  │  │  ┌─────────┐      ┌────────────┐      ┌──────────┐  │    │  │
│  │  │  │ read    │      │ remember  │      │ jina-ai  │  │    │  │
│  │  │  │ write   │      │ recall    │      │ (3 tools)│  │    │  │
│  │  │  │ edit    │      │ semantic_ │      ├──────────┤  │    │  │
│  │  │  │ bash    │      │  search   │      │firecrawl │  │    │  │
│  │  │  │ glob    │      │ workflow  │      │(26 tools)│  │    │  │
│  │  │  │ grep    │      │ hashline_ │      ├──────────┤  │    │  │
│  │  │  │ replace │      │  edit     │      │ zai-mcp  │  │    │  │
│  │  │  └─────────┘      │ code      │      │ (8 tools)│  │    │  │
│  │  │                   │ delegate_ │      ├──────────┤  │    │  │
│  │  │  Slash cmds:      │  task     │      │web-search│  │    │  │
│  │  │  /memory /dream   │ spawn-    │      │ (1 tool) │  │    │  │
│  │  │  /skills /cron    │  role-sub │      └──────────┘  │    │  │
│  │  │  /wallet /council │ wait-role │                     │    │  │
│  │  │  /mcp /channel    │  -sub     │                     │    │  │
│  │  │                   │ skill-    │                     │    │  │
│  │  │                   │  search   │                     │    │  │
│  │  │                   └────────────┘                     │    │  │
│  │  └──────────────────────────────────────────────────────┘    │  │
│  │                                                               │  │
│  │  pi AgentSession manages:                                     │  │
│  │    • LLM streaming (provider: MiniMax, Z.AI, OpenAI, ...)    │  │
│  │    • Tool call loop (maxToolRounds: 25 default)              │  │
│  │    • Context window management (compaction)                  │  │
│  │    • Subagent spawning (maxSpawnDepth: 2)                    │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  prompt(text) → piSession.prompt(text, {streamingBehavior})        │
│    → streams pi events → maps to AgentEvent                         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. Event Flow — pi → AgentEvent → WS Broadcast

```
LLM Provider (glm-5.1 / MiniMax-M3 / ...)
    │
    │ SSE stream
    ▼
┌──────────────────────────────────────────────┐
│         pi AgentSession (internal)            │
│                                              │
│  Emits pi raw events:                        │
│    agent_settled                             │
│    message_update / assistantMessageEvent     │
│      { type: "text_delta", delta: "Hello" }  │
│      { type: "thinking_delta", delta: "..." }│
│    tool_execution_*                          │
│    usage / cost                              │
└──────────────────┬───────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────┐
│    PiInProcessSession (event normalizer)      │
│                                              │
│  Maps pi events → AgentEvent (SPI):          │
│                                              │
│  pi raw                → AgentEvent           │
│  ─────────────────────────────────────       │
│  message_update(text)  → { type:"text",      │
│                             delta:"Hello" }   │
│  message_update(think)  → { type:"thinking",  │
│                             delta:"..." }     │
│  tool_use              → { type:"tool_call",  │
│                             name, args }      │
│  tool_result           → { type:"tool_result",│
│                             output }          │
│  agent_settled + usage → { type:"turn_end",   │
│                             tokensIn, out }   │
│  (turn start)          → { type:"turn_start", │
│                             model }           │
└──────────────────┬───────────────────────────┘
                   │
         ┌────────┴────────┐
         │                 │
         ▼                 ▼
┌────────────────┐  ┌──────────────────────┐
│ CostTracker    │  │ toPiWebShape()       │
│ .record()      │  │                      │
│                │  │ AgentEvent → pi shape │
│ tokensIn +=    │  │ for WS broadcast     │
│ tokensOut +=   │  │                      │
│ totalUsd +=    │  │ text → message_update│
│   (rate calc)  │  │      /text_delta     │
│                │  │ thinking → thinking_  │
│ COST_RATES:    │  │      delta            │
│  pi: 3/15      │  │ tool_call → passthru  │
│  claude: 3/15  │  │ turn_end → passthru   │
│  native: .15/.6│  └──────────┬───────────┘
└────────────────┘              │
                                ▼
                    ┌───────────────────────┐
                    │  WebSocket /events     │
                    │                       │
                    │  WireEnvelope {        │
                    │    version: 1,         │
                    │    sessionId,          │
                    │    seq,                │
                    │    event: {...}        │
                    │  }                     │
                    │                       │
                    │  → broadcast to all    │
                    │    connected WS clients│
                    └───────────┬───────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │  Web Dashboard         │
                    │  (ChatPage.tsx)        │
                    │                       │
                    │  Renders:              │
                    │  • text_delta → append │
                    │  • tool_call → badge   │
                    │  • turn_end → settle   │
                    └───────────────────────┘
```

---

## 5. Memory System — Brain + SQLite + DreamCycle

```
┌─────────────────────────────────────────────────────────────────────┐
│                        MEMORY ARCHITECTURE                           │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    MemoryManager                            │    │
│  │               (manager.ts — single front door)              │    │
│  │                                                            │    │
│  │  record(fact) ──→ fan-out to 13 domains                   │    │
│  │  recall(query) ──→ multi-domain search + rank             │    │
│  │  consolidate() ──→ dreamCycle or brain path               │    │
│  └───────────────────────────────────────────────────────────┘    │
│         │                                                          │
│         ├─── 13 Domains ────────────────────────────────────┐     │
│         │  archivist · conversations · diff · entities       │     │
│         │  goals · graph · queue · search · sources          │     │
│         │  store · sync · tools · tree                       │     │
│         └────────────────────────────────────────────────────┘     │
│         │                                                          │
│         ▼                                                          │
│  ┌──────────────────────────────────────────────────────────┐     │
│  │                    BRAIN (brain.ts)                       │     │
│  │                                                          │     │
│  │  ┌─────────────────────────────────────────────────┐     │     │
│  │  │  10 Analysis Phases (pure computation)          │     │     │
│  │  │  backlinks · consolidate · purge · embed        │     │     │
│  │  │  extractFacts · lint · orphans · schemaSuggest  │     │     │
│  │  │  resolveSymbolEdges · conversationFactsBackfill │     │     │
│  │  └──────────────────────┬──────────────────────────┘     │     │
│  │                         │ operates on                    │     │
│  │                         ▼                                │     │
│  │  ┌──────────────────────────────────────────────┐        │     │
│  │  │       BrainStorage seam (Dig 3 COMPLETE)     │        │     │
│  │  │                                            │        │     │
│  │  │  putFact/getFact/deleteFact/allFacts        │        │     │
│  │  │  putTake/getTake/allTakes                   │        │     │
│  │  │  putPage/getPage/allPages                   │        │     │
│  │  │  putTombstone/getTombstone/allTombstones    │        │     │
│  │  │                                            │        │     │
│  │  │     ┌──────────────┐  ┌─────────────────┐  │        │     │
│  │  │     │ InMemory     │  │ SqliteBrainStore│  │        │     │
│  │  │     │ (4 Maps)     │  │ (write-through  │  │        │     │
│  │  │     │ DEFAULT      │  │  cache + WAL)   │  │        │     │
│  │  │     │ backward-compat│  │  DURABLE       │  │        │     │
│  │  │     └──────────────┘  └───────┬─────────┘  │        │     │
│  │  └───────────────────────────────┼────────────┘        │     │
│  └──────────────────────────────────┼─────────────────────┘     │
│                                     │                            │
│                                     ▼                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              SqliteMemoryManager (SMM)                    │   │
│  │              (5-layer SQLite: memory.db)                  │   │
│  │                                                          │   │
│  │  Tables:                                                 │   │
│  │    working_memory    (FTS5 + vector embeddings)          │   │
│  │    episodic_memory   (conversation turns)                │   │
│  │    brain_facts       (Dig 3 — full fidelity)             │   │
│  │    brain_takes       (promoted clusters)                 │   │
│  │    brain_pages       (compiled truth)                    │   │
│  │    brain_tombstones  (soft-delete 72h recovery)          │   │
│  │                                                          │   │
│  │  Features:                                               │   │
│  │    • BM25 + vector search (fastembed ONNX)              │   │
│  │    • Weibull decay (memory strength scoring)             │   │
│  │    • Auto-capture (operational facts from tool calls)    │   │
│  │    • Consolidation (LLM-driven summarization)            │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                   DreamCycle                              │    │
│  │              (offline consolidation)                      │    │
│  │                                                          │    │
│  │  dream() runs periodically:                              │    │
│  │    1. Brain path: consolidate → cluster → promote Takes  │    │
│  │    2. SQLite path: FTS5 index update + vector embed      │    │
│  │    3. Store dream summary as new fact                    │    │
│  │                                                          │    │
│  │  C-GATE-1: When Brain is durable (SQLite),               │    │
│  │  Brain path runs FIRST, then SQLite complements.         │    │
│  │  Old dual-path dispatch collapsed.                       │    │
│  └──────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 6. Prompt Enrichment Flow

```
User sends: "What did we discuss about authentication?"
                    │
                    ▼
┌──────────────────────────────────────────────────────────┐
│                  MemoryEnricher                           │
│                 (enricher.ts)                             │
│                                                          │
│  recall(query):                                          │
│    1. Search Brain (BM25 over facts)                    │
│    2. Search SQLite (FTS5 + vector)                     │
│    3. Merge + rank (RRF fusion)                         │
│    4. Filter:                                            │
│       • echo filter (capture:sessionId prefix)           │
│       • operational noise filter (queue-depth, etc.)     │
│       • dedupe by id                                     │
│    5. Cap: MAX_INJECTION_CHARS                           │
│    6. Inject into system prompt                          │
│                                                          │
│  capture(fact):                                          │
│    → memory.record() (TTL + domain fan-out)             │
│    → brain.recordFact() fallback                        │
│    → randomBytes suffix for id uniqueness               │
│                                                          │
│  MIN_SCORE = 0.01 (RRF fused scores max ≈0.066)         │
└──────────────────────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────────────────┐
│  Enriched prompt sent to LLM:                            │
│                                                          │
│  System: "You are mya, a coding agent...                │
│           Relevant memories:                             │
│           - We discussed JWT vs session cookies...       │
│           - User prefers TypeScript strict mode..."      │
│                                                          │
│  User: "What did we discuss about authentication?"      │
└──────────────────────────────────────────────────────────┘
```

---

## 7. Session Lifecycle

```
                    POST /pool/acquire
                    { cwd: "/tmp" }
                           │
                           ▼
              ┌────────────────────────┐
              │  RuntimePool            │
              │  .acquireWithRuntime()  │
              └───────────┬────────────┘
                          │
             ┌────────────┼────────────┐
             ▼            ▼            ▼
     Session exists?  Pending?     New session?
     (in entries)    (in pending)  (neither)
             │            │            │
             │            │            ▼
             │            │    ┌───────────────┐
             │            │    │ SmartRouter   │
             │            │    → route("pi")   │
             │            │    └───────┬───────┘
             │            │            │
             │            │            ▼
             │            │    ┌───────────────┐
             │            │    │ PiInProcess   │
             │            │    │ Runtime.start()│
             │            │    │ → createAgent │
             │            │    │   Session()   │
             │            │    └───────┬───────┘
             │            │            │
             │            │            ▼
             │            │    ┌───────────────┐
             │            │    │ Adapter wraps │
             │            │    │ session +     │
             │            │    │ costTracker   │
             │            │    └───────┬───────┘
             │            │            │
             └────────────┴────────────┘
                          │
                          ▼
              ┌────────────────────────┐
              │  Return session handle  │
              │  { sessionId: "s-..." } │
              └───────────┬────────────┘
                          │
                          ▼
              ┌────────────────────────┐
              │  POST /pool/prompt/:sid│
              │  { text: "Hello" }     │
              └───────────┬────────────┘
                          │
                          ▼
              ┌────────────────────────┐
              │  doRunOnSession()      │
              │  session.prompt(text)  │
              │  → LLM streams         │
              │  → WS broadcast        │
              │  → costTracker.record()│
              └───────────┬────────────┘
                          │
                    turn_end event
                          │
                          ▼
              ┌────────────────────────┐
              │  Session stays alive   │
              │  (idle, ready for next │
              │   prompt)              │
              │                        │
              │  Cleanup:              │
              │  • DELETE /pool/:sid   │
              │  • idleTtl: 1h         │
              │  • pool.dispose()      │
              │    on shutdown         │
              └────────────────────────┘
```

---

## 8. Filesystem Layout

```
~/.mya/
├── agent/
│   ├── auth.json              # Provider credentials (MiniMax, Z.AI, ...)
│   ├── config.json            # MyaConfig (memoryBackend, maxToolRounds, ...)
│   ├── cron.json              # Cron job definitions
│   ├── cron.db                # Cron durable state (SQLite)
│   ├── mcp.json               # MCP server configs (jina, firecrawl, zai, ...)
│   ├── settings.json          # User settings
│   ├── trust.json             # Sigstore trust store
│   ├── roles/                 # Role definitions (coder, researcher, ...)
│   ├── skills/                # Discovered skills
│   ├── sessions/              # Per-session state
│   └── themes/                # Custom themes
├── memory/
│   └── memory.db              # SQLite (brain_* + working_memory + episodic)
├── gateway.env                # API keys (loaded by systemd)
├── code-index.db              # Code indexing (AST symbols)
├── kanban.db                  # Kanban board state
├── achievements.json          # Gamification state
├── sync/                      # CRDT sync state
├── collab/                    # Collaboration rooms
├── notes/                     # User notes
├── providers/                 # Provider-specific configs
└── sessions/                  # Active session manifests
```

---

## 9. Config Flow

```
~/.mya/agent/config.json          Environment variables
{
  "memoryBackend": "sqlite",      MYA_MEMORY_BACKEND=sqlite
  "maxToolRounds": 25,           MYA_MAX_TOOL_ROUNDS=25
  "maxSubagentToolRounds": 50,   MYA_MAX_SUBAGENT_TOOL_ROUNDS=50
  "maxSpawnDepth": 2,            MYA_MAX_SPAWN_DEPTH=2
  "channels": { ... }            MYA_NO_WS_TOKEN=1 (dev)
}                                MYA_MODEL=MiniMax-M3
        │                              │
        └──────────┬───────────────────┘
                   ▼
         shared-instances.ts
         loadConfig()
                   │
                   ▼
         ┌─────────────────────┐
         │ config singleton    │
         │ (read once at boot) │
         └─────────┬───────────┘
                   │
         ┌─────────┼─────────────────┐
         ▼         ▼                 ▼
    Brain ctor  AgentConfig     Gateway opts
    (storage    (maxToolRounds   (wsToken,
     backend)    maxSpawnDepth    cronSweepMs,
                 maxSubagent      approvalMode)
                 ToolRounds)
```

---

## 10. Deployment

```
┌─────────────────────────────────────────────────┐
│          systemd user service                    │
│          mya-gateway.service                     │
│                                                 │
│  ExecStart: node dist/mya.js serve --port 3000  │
│  Restart: always (RestartSec: 5s)               │
│  EnvironmentFile: ~/.mya/gateway.env            │
│                                                 │
│  MYA_MODEL=MiniMax-M3                           │
│  MINIMAX_API_KEY=*****                          │
│  NODE_ENV=production                            │
│                                                 │
│  → Port 3000 (loopback only)                    │
│  → Health: GET /health/live                     │
│  → Logs: journalctl --user -u mya-gateway       │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────┐
│              Web Dashboard                        │
│         http://localhost:3000                     │
│                                                  │
│  ┌──────────┬──────────┬──────────┬──────────┐  │
│  │ Chat     │ Sessions │ Cron     │ Models   │  │
│  │ (stream) │ (pool)   │ (jobs)   │ (providers)│ │
│  ├──────────┼──────────┼──────────┼──────────┤  │
│  │ Skills   │ Config   │ Channels │ Analytics│  │
│  ├──────────┼──────────┼──────────┼──────────┤  │
│  │ Sync     │ Collab   │ Logs     │ Status   │  │
│  └──────────┴──────────┴──────────┴──────────┘  │
│                                                  │
│  38 pages · React SPA · dark theme               │
│  WS: ws://localhost:3000/events?session=*        │
└──────────────────────────────────────────────────┘
```

---

## Tóm tắt luồng hoạt động

```
1. USER gửi prompt
   │
2. → Gateway HTTP nhận POST /pool/prompt/:sid
   │
3. → doRunOnSession() → session.prompt(text)
   │
4. → PiInProcessSession → pi AgentSession.prompt()
   │
5. → MemoryEnricher recall() → inject context
   │
6. → LLM Provider stream (glm-5.1 / MiniMax-M3 / ...)
   │
7. → pi emits events → PiInProcessSession normalizes → AgentEvent
   │
8. → AgentEvent → 3 song song:
   │   ├─ toPiWebShape() → WS broadcast → Dashboard
   │   ├─ CostTracker.record() → internal cost
   │   └─ responseText accumulation → HTTP response
   │
9. → Tool calls? → execute (bash/read/write/remember/...)
   │   └─ Tool result → re-prompt LLM (loop until done or maxToolRounds)
   │
10. → turn_end → session idle → ready for next prompt
    │
11. → MemoryEnricher capture() → store facts for future recall
```
