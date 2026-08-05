# mya Architecture Diagrams

> 5 diagrams sinh từ Graphviz `.dot` source. Regenerate: `dot -Tpng -Gdpi=150 <name>.dot -o <name>.png`

## 1. `architecture.png` — Kiến trúc tổng thể

Toàn bộ hệ thống mya trên một diagram:

- **Transport Layer** (xanh): TUI, CLI, Web Dashboard, Gateway HTTP/WS, Background, JSON-RPC
- **Entry & Dispatch** (xanh lá): `main.ts` → `createAgent()` hoặc `RuntimePool` (serve path)
- **Core Engine** (cam): `runTurn()` FSM — retry, tool loop, budget, compaction
- **Providers** (tím): ProviderRegistry → streamWithFallback → SmartRouter → OpenAIAdapter
- **Tools** (đỏ): `dispatch.runTool()` → 26 tools (FS, Shell, Search, Code Intel, Web, Security, Media)
- **Memory** (xanh ngọc): Brain → RRF → DreamCycle → MemoryTree → TypedGraph → SQLite → Embeddings → 14 Domains
- **Infrastructure** (xám): Audit (Merkle), Prompts, Secrets, Cron
- **Rust Native**: BLAKE3, glob/grep, tree-sitter, Rhai, wallclock

## 2. `agent-loop.png` — Turn FSM

Luồng một turn của agent:

```
User Prompt → createAgent() → runTurn()
  → streamWithFallback() (gửi messages đến LLM)
  → Parse response
  → Có tool calls?
    YES → dispatch.runTool() → ToolResult → feed back → lặp (≤25 rounds)
    NO  → Agent Response → Done
  Side-effect: Memory record/recall mỗi turn
```

## 3. `memory-pipeline.png` — 5-layer Memory

```
1. INGEST: autoCapture() — extract facts từ conversation
2. STORE: Brain.recordFact() → SQLite write-through
3. LIFECYCLE: L0 (events 24h) → L1 (takes) → L2 (pages)
4. RETRIEVE: SearchDomain.recall() → RRF (BM25 + substring + vector + graph) + 14 domains
5. BACKGROUND: DreamCycle (4h) — facts → takes consolidation
```

## 4. `subagent-lifecycle.png` — Role-subagent spawning

```
Parent Agent → POST /pool/acquire {role, task}
  → Gateway returns childSid
  → herdrBackend.open(): pane split → current → run
  → Bash script: mya --gateway-session $childSid --role coder --task ...
  → Child boots: pi InteractiveMode + mya-bridge
  → session_start: auto-inject task as first prompt
  → turn_start: reportSubagentStatus('working')
  → LLM call + tool execution
  → agent_settled: reportSubagentStatus('done')
  → Parent polls /pool/tree: idle → working → done
```

## 5. `transport-delivery.png` — Multi-transport delivery

6 transport modes kết nối user interfaces đến core agent:

```
Terminal → TUI (pi InteractiveMode) / Print mode
Browser → serve mode (Gateway + Web SPA)
IDE → RPC mode / serve mode (Intercom)
Phone → Channels (WA/Matrix/Signal) / Push notifications
Cron → serve mode (sweep timer)
API → RPC / HTTP REST / BG mode
```

Tất cả đều hội tụ tại `main.ts` → `createAgent()` → `runTurn()`.
