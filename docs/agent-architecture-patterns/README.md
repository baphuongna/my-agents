# mya Agent Architecture Patterns — 227 Hướng Kiến Trúc

> Phân tích chi tiết 227 hướng kiến trúc cho mya — từ conventional (wrap/proxy/shell) 
> đến novel (stigmergy/tuple-space/ECS/market/immune-system).
>
> Mỗi hướng trong 1 file riêng. Đối chiếu thiết kế gốc vs code thực tế.

## Danh sách hướng

### Nhóm 1: Wrap/Control (mya ngồi giữa user ↔ agent)

| File | Hướng | Coupling | Agent-agnostic | Effort |
|---|---|---|---|---|
| [01-platform.md](01-platform.md) | A: Platform (hiện tại) | 🔴 Nặng | ❌ | 0 |
| [02-shell.md](02-shell.md) | B: Shell thuần | 🟢 Zero | ✅ | 3-5 ngày |
| [03-shell-extension.md](03-shell-extension.md) | C: Shell + Extension | 🟡 Public API | ⚠️ | 1-2 tuần |
| [04-shell-mcp.md](04-shell-mcp.md) | D: Shell + MCP Server | 🟢 Zero | ✅ | 2-3 tuần |
| [05-llm-proxy.md](05-llm-proxy.md) | E: LLM Proxy (MITM) | 🟢 Zero | ✅ | 1 tuần |
| [06-file-watcher.md](06-file-watcher.md) | F: File Watcher (sidecar) | 🟢 Zero | ✅ | 3-5 ngày |
| [07-proxy-watcher.md](07-proxy-watcher.md) | G: Proxy + Watcher | 🟢 Zero | ✅ | 1.5 tuần |

### Nhóm 2: Protocol & Task Coordination

| File | Hướng | Coupling | Code sẵn? |
|---|---|---|---|
| [08-acp-bridge.md](08-acp-bridge.md) | H: ACP Protocol Bridge | 🟢 Protocol | ✅ packages/acp |
| [09-pi-rpc-bridge.md](09-pi-rpc-bridge.md) | R: pi RPC Bridge | 🟢 Protocol | ✅ pi đã có 33 cmds |
| [10-kanban-board.md](10-kanban-board.md) | I: Kanban Task Queue | 🟢 SQLite | ✅ kanban-sqlite |
| [11-git-as-ipc.md](11-git-as-ipc.md) | J: Git-as-IPC | 🟢 Git | Natural fit |
| [12-event-stream.md](12-event-stream.md) | K: Event-Sourced Ledger | 🟢 Log | ✅ AuditLog |
| [13-message-broker.md](13-message-broker.md) | L: Message Broker | 🟢 Redis | Anticipated |

### Nhóm 3: mya = Brain / Platform

| File | Hướng | Vị trí mya |
|---|---|---|
| [14-reverse-agent.md](14-reverse-agent.md) | M: Reverse Agent (agents = tools) | mya IS the agent |
| [15-agent-os.md](15-agent-os.md) | N: Agent OS (agents = apps) | Platform |
| [16-policy-engine.md](16-policy-engine.md) | O: Policy Engine (guard rails) | YES/NO gate |
| [17-transpiler.md](17-transpiler.md) | P: Transpiler (format translator) | Dịch giữa formats |
| [18-connection-pool.md](18-connection-pool.md) | Q: Connection Pool (warm sessions) | Session manager |

### Nhóm 4: Biology-Inspired

| File | Hướng | Nguồn gốc |
|---|---|---|
| [19-stigmergy.md](19-stigmergy.md) | T: Stigmergic Coordination | Entomology (Grassé, 1959) |
| [20-immune-system.md](20-immune-system.md) | BB: Immune System Defense | Biology (Forrest, 1994) |

### Nhóm 5: Data Model Innovations

| File | Hướng | Nguồn gốc |
|---|---|---|
| [21-tuple-space.md](21-tuple-space.md) | U: Tuple Space (Linda) | Parallel prog (Gelernter, 1985) |
| [22-ecs.md](22-ecs.md) | V: Entity-Component-System | Game engines (Unity/Bevy) |
| [23-content-addressable-dag.md](23-content-addressable-dag.md) | W: Content-Addressable DAG | Git/IPFS/Merkle |

### Nhóm 6: Economic & Database-Inspired

| File | Hướng | Nguồn gốc |
|---|---|---|
| [24-market-auction.md](24-market-auction.md) | X: Market-Based Allocation | Economics (Vickrey, 1961) |
| [25-query-planner.md](25-query-planner.md) | Y: Query Planner | Database internals (Selinger, 1979) |

### Nhóm 7: Distributed Systems & Reactive

| File | Hướng | Nguồn gốc |
|---|---|---|
| [26-actor-model.md](26-actor-model.md) | Z: Actor Model | Hewitt, 1973 / Erlang |
| [27-reactive-dataflow.md](27-reactive-dataflow.md) | AA: Reactive Dataflow | FRP (Elliott, 1997) |
| [28-chemical-reaction.md](28-chemical-reaction.md) | CC: Chemical Reaction Network | Gamma calculus (1986) |

### Nhóm 8: Infrastructure & ML-Inspired (NEW)

| File | Hướng | Nguồn gốc |
|---|---|---|
| [29-declarative-reconcile.md](29-declarative-reconcile.md) | DD: Declarative Reconcile | Kubernetes (2014) |
| [30-behavior-tree.md](30-behavior-tree.md) | EE: Behavior Tree | Game AI (Halo 2, 2005) |
| [31-saga-pattern.md](31-saga-pattern.md) | FF: Saga Pattern | Distributed transactions (1987) |
| [32-supervisor-tree.md](32-supervisor-tree.md) | GG: Supervisor Tree | Erlang OTP (1986) |
| [33-sidecar.md](33-sidecar.md) | HH: Sidecar | K8s service mesh (Envoy) |
| [34-cqrs.md](34-cqrs.md) | II: CQRS | Fowler, 2010 |
| [35-gan-adversarial.md](35-gan-adversarial.md) | JJ: GAN-Style Adversarial | Goodfellow, 2014 |
| [36-mapreduce.md](36-mapreduce.md) | KK: MapReduce | Google, 2004 |

### Nhóm 9: Agent Memory, Quality & Resilience (MỚI BỔ SUNG)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [37-blackboard.md](37-blackboard.md) | LL: Blackboard | 🟡 Shared state | ⚠️ (1 phần) | 1-2 tuần |
| [38-memory-management.md](38-memory-management.md) | MM: Memory Mgmt (3 tầng) | 🟢 | ✅ packages/memory+prompts | 0 (đã có) |
| [39-cache-layer.md](39-cache-layer.md) | NN: Cache Layer | 🟢 | ⚠️ (thiếu tool-result cache) | 1 tuần |
| [40-tool-registry.md](40-tool-registry.md) | OO: Tool Registry + Perms | 🟡 Public API | ✅ ToolRegistry+roles | 1 tuần |
| [41-eval-harness.md](41-eval-harness.md) | PP: Eval Harness | 🟢 | ✅ packages/eval | 0 (đã có) |
| [42-circuit-breaker.md](42-circuit-breaker.md) | QQ: Circuit Breaker | 🟢 | ⚠️ (backoff rải rác) | 1 tuần |

### Nhóm 10: Routing, Control & Cognitive (MỚI BỔ SUNG — MCP research)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [43-routing.md](43-routing.md) | RR: Routing / Mode-Selector | 🟢 | ⚠️ (roles+registry sẵn) | 3-5 ngày |
| [44-cost-budget.md](44-cost-budget.md) | SS: Cost & Step Budget Gating | 🟢 | ⚠️ (RateLimiter sẵn) | 1 tuần |
| [45-wait-event-checkpoint.md](45-wait-event-checkpoint.md) | TT: Durable Wait-for-Event / Checkpoint | 🟢 | ⚠️ (session JSONL sẵn) | 1-2 tuần |
| [46-escalation-tree.md](46-escalation-tree.md) | UU: Escalation Tree | 🟢 | ❌ build mới | 1 tuần |
| [47-anti-patterns.md](47-anti-patterns.md) | VV: Anti-Patterns Catalog | — | — (tài liệu) | 3-5 ngày |
| [48-bdi.md](48-bdi.md) | WW: BDI + 3-Stage Commitment | 🟡 | ⚠️ (brain+kanban sẵn) | 1-2 tuần |
| [49-impasse-subgoal.md](49-impasse-subgoal.md) | XX: Impasse-Subgoal | 🟢 | ⚠️ (subagent-spawn sẵn) | 1 tuần |
| [50-knowledge-compilation.md](50-knowledge-compilation.md) | YY: Knowledge Compilation | 🟢 | ⚠️ (skills sẵn) | 1-2 tuần |
| [51-pressure-field.md](51-pressure-field.md) | ZZ: Pressure-Field Coord | 🟢 | ❌ build mới | 2-3 tuần |
| [52-gossip.md](52-gossip.md) | AAA: Gossip / Epidemic | 🟢 | ⚠️ (intercom sẵn) | 2 tuần |
| [53-a2a-capability.md](53-a2a-capability.md) | BBB: A2A Opaque Protocol | 🟢 Protocol | ⚠️ (intercom+rpc sẵn) | 2 tuần |
| [54-handoff.md](54-handoff.md) | CCC: Explicit Handoff | 🟢 | ⚠️ (intercom sẵn) | 3-5 ngày |

### Nhóm 11: Model-Level & Retrieval (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [55-mixture-of-agents.md](55-mixture-of-agents.md) | DDD: Mixture of Agents | 🟢 | ⚠️ (registry+tier sẵn) | 2 tuần |
| [56-reflexion.md](56-reflexion.md) | EEE: Reflexion | 🟢 | ⚠️ (eval+memory sẵn) | 1 tuần |
| [57-plan-execute.md](57-plan-execute.md) | FFF: Plan-and-Execute | 🟢 | ⚠️ (kanban+spawn sẵn) | 1-2 tuần |
| [58-agentic-rag.md](58-agentic-rag.md) | GGG: Agentic RAG | 🟢 | ❌ (cần index mới) | 2-3 tuần |
| [59-model-cascade.md](59-model-cascade.md) | HHH: Model Cascade | 🟢 | ⚠️ (tier+fallback sẵn) | 1 tuần |

### Nhóm 12: Interface, Observability & Security (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [60-aci.md](60-aci.md) | III: Agent-Computer Interface | 🟢 | ⚠️ (ToolResult sẵn) | 1-2 tuần |
| [61-agent-observability.md](61-agent-observability.md) | JJJ: Agent Observability | 🟢 | ⚠️ (AuditLog sẵn) | 1-2 tuần |
| [62-credential-broker.md](62-credential-broker.md) | KKK: Credential Broker | 🟢 | ⚠️ (key-rotation+oauth sẵn) | 1 tuần |

### Nhóm 13: Planning Formal, Hạ tầng MCP & Tool Generation (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [63-htn.md](63-htn.md) | LLL: HTN Planning | 🟢 | ⚠️ (kanban sẵn) | 2-3 tuần |
| [64-mcp-gateway.md](64-mcp-gateway.md) | MMM: MCP Gateway | 🟢 Protocol | ⚠️ (mcp-client+oauth sẵn) | 1-2 tuần |
| [65-tool-maker.md](65-tool-maker.md) | NNN: Tool Maker | 🟢 | ⚠️ (registry+eval sẵn) | 1-2 tuần |

### Nhóm 14: Reliability Testing, Deployment & Priority Layers (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [66-chaos-engineering.md](66-chaos-engineering.md) | OOO: Agent Chaos Eng | 🟢 | ⚠️ (eval sẵn) | 1-2 tuần |
| [67-serverless-agents.md](67-serverless-agents.md) | PPP: Serverless Agents | 🟢 | ⚠️ (cron+sweep sẵn) | 1-2 tuần |
| [68-subsumption.md](68-subsumption.md) | QQQ: Subsumption Arch | 🟢 | ⚠️ (OO/SS/PP sẵn) | 1-2 tuần |

### Nhóm 15: Security Gateway, Model Gateway & Evolution (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [69-agentic-firewall.md](69-agentic-firewall.md) | RRR: Agentic Firewall | 🟢 | ⚠️ (audit+secrets sẵn) | 1-2 tuần |
| [70-llm-gateway.md](70-llm-gateway.md) | SSS: LLM Gateway | 🟢 | ⚠️ (registry+fallback sẵn) | 1 tuần |
| [71-evoprompt.md](71-evoprompt.md) | TTT: EvoPrompt | 🟢 | ⚠️ (eval+prompts sẵn) | 1-2 tuần |

### Nhóm 16: Security Testing, Durability & Graph Orchestration (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [72-llm-red-teaming.md](72-llm-red-teaming.md) | UUU: LLM Red Teaming | 🟢 | ⚠️ (eval+audit sẵn) | 1-2 tuần |
| [73-durable-execution.md](73-durable-execution.md) | VVV: Durable Execution | 🟢 | ⚠️ (workflows runner sẵn) | 2-3 tuần |
| [74-stateful-graph.md](74-stateful-graph.md) | WWW: Stateful Graph | 🟢 | ⚠️ (runner+session sẵn) | 2 tuần |

### Nhóm 17: Search & Formal Planning (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [75-lats-tree-search.md](75-lats-tree-search.md) | XXX: LATS Tree Search | 🟢 | ❌ build mới | 2-3 tuần |
| [76-pddl-planning.md](76-pddl-planning.md) | YYY: PDDL Planning | 🟢 Protocol | ❌ build mới | 2-3 tuần |
| [77-dspy-compilation.md](77-dspy-compilation.md) | ZZZ: DSPy Compilation | 🟢 | ⚠️ (prompts+eval sẵn) | 2 tuần |

### Nhóm 18: Negotiation, Swarm & Context (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [78-agent-negotiation.md](78-agent-negotiation.md) | AAAA: Agent Negotiation | 🟡 | ⚠️ (intercom sẵn) | 2 tuần |
| [79-swarm-optimization.md](79-swarm-optimization.md) | BBBB: Swarm Optimization | 🟢 | ⚠️ (eval sẵn) | 1-2 tuần |
| [80-context-engineering.md](80-context-engineering.md) | CCCC: Context Engineering | 🟢 | ⚠️ (memory+prompts sẵn) | 2 tuần |

### Nhóm 19: Compute Allocation, Memory & Tool Ecosystem (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [81-test-time-compute.md](81-test-time-compute.md) | DDDD: Test-Time Compute | 🟢 | ⚠️ (SS+eval sẵn) | 1-2 tuần |
| [82-memory-consolidation.md](82-memory-consolidation.md) | EEEE: Memory Consolidation | 🟢 | ⚠️ (memory+cron sẵn) | 1-2 tuần |
| [83-tool-discovery.md](83-tool-discovery.md) | FFFF: Tool Discovery | 🟢 Protocol | ⚠️ (mcp-client sẵn) | 1-2 tuần |

### Nhóm 20: Judging, Spec & Topology (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [84-llm-as-judge.md](84-llm-as-judge.md) | GGGG: LLM-as-Judge | 🟢 | ⚠️ (eval sẵn) | 1 tuần |
| [85-agent-spec.md](85-agent-spec.md) | HHHH: Agent Spec | 🟢 | ⚠️ (roles/skills sẵn) | 1-2 tuần |
| [86-agent-topology.md](86-agent-topology.md) | IIII: Agent Topology | 🟢 | ⚠️ (intercom sẵn) | 1 tuần |

### Nhóm 21: Trusted Compute & Memory 2 (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [87-tee-confidential.md](87-tee-confidential.md) | JJJJ: TEE/Confidential | 🟢 | ❌ (hạ tầng mới) | 3-4 tuần |
| [88-hybrid-graph-vector-memory.md](88-hybrid-graph-vector-memory.md) | KKKK: Hybrid Graph+Vector Memory | 🟡 | ⚠️ (memory sẵn) | 2-3 tuần |
| [89-shared-graph-memory.md](89-shared-graph-memory.md) | LLLL: Shared Graph Memory | 🟡 | ⚠️ (memory sẵn) | 2-3 tuần |

### Nhóm 22: Cost & Eval Data (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [90-prompt-caching.md](90-prompt-caching.md) | MMMM: Prompt Caching | 🟢 | ⚠️ (ai sẵn) | 1 tuần |
| [91-synthetic-eval-data.md](91-synthetic-eval-data.md) | NNNN: Synthetic Eval Data | 🟢 | ⚠️ (eval sẵn) | 1-2 tuần |
| [92-semantic-caching.md](92-semantic-caching.md) | OOOO: Semantic Caching | 🟡 | ⚠️ (ai sẵn) | 1-2 tuần |

### Nhóm 23: Routing & Resilience 2 (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [93-hybrid-local-cloud.md](93-hybrid-local-cloud.md) | PPPP: Hybrid Local-Cloud | 🟢 | ⚠️ (router sẵn) | 2 tuần |
| [94-trajectory-replay.md](94-trajectory-replay.md) | QQQQ: Trajectory Replay | 🟢 | ⚠️ (eval sẵn) | 1-2 tuần |
| [95-tool-call-recovery.md](95-tool-call-recovery.md) | RRRR: Tool-Call Recovery | 🟡 | ⚠️ (reliability sẵn) | 1-2 tuần |

### Nhóm 24: Agent Testing (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [96-agent-ci-cd.md](96-agent-ci-cd.md) | SSSS: Agent CI/CD | 🟢 | ⚠️ (eval sẵn) | 1 tuần |
| [97-tool-schema-drift.md](97-tool-schema-drift.md) | TTTT: Tool Schema Drift | 🟢 | ⚠️ (mcp sẵn) | 1-2 tuần |
| [98-tool-mocking.md](98-tool-mocking.md) | UUUU: Tool Mocking | 🟢 | ⚠️ (tools sẵn) | 1 tuần |

### Nhóm 25: Context & Token Optimization (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [99-progressive-disclosure.md](99-progressive-disclosure.md) | VVVV: Progressive Disclosure | 🟢 | ⚠️ (skills sẵn) | 1-2 tuần |
| [100-prompt-compression.md](100-prompt-compression.md) | WWWW: Prompt Compression | 🟡 | ⚠️ (ai sẵn) | 1-2 tuần |
| [101-dynamic-tool-selection.md](101-dynamic-tool-selection.md) | XXXX: Dynamic Tool Selection | 🟡 | ⚠️ (registry sẵn) | 1-2 tuần |

### Nhóm 26: Reliability & Quality 2 (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [102-reward-hacking.md](102-reward-hacking.md) | YYYY: Reward Hacking | 🟢 | ⚠️ (eval sẵn) | 1-2 tuần |
| [103-agent-drift.md](103-agent-drift.md) | ZZZZ: Agent Drift | 🟢 | ⚠️ (eval sẵn) | 1-2 tuần |
| [104-task-decomposition.md](104-task-decomposition.md) | AAAAA: Task Decomposition | 🟢 | ⚠️ (triage sẵn) | 1 tuần |

### Nhóm 27: Evolution & Defense (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [105-self-improving-agents.md](105-self-improving-agents.md) | BBBBB: Self-Improving | 🟡 | ⚠️ (eval sẵn) | 2-3 tuần |
| [106-rag-poisoning-defense.md](106-rag-poisoning-defense.md) | CCCCC: RAG Poisoning Defense | 🟡 | ⚠️ (RAG sẵn) | 1-2 tuần |
| [107-canary-honeypot.md](107-canary-honeypot.md) | DDDDD: Canary/Honeypot | 🟢 | ⚠️ (tools sẵn) | 1 tuần |

### Nhóm 28: Attribution & Supervision (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [108-credit-assignment.md](108-credit-assignment.md) | EEEEE: Credit Assignment | 🟢 | ⚠️ (trace sẵn) | 1-2 tuần |
| [109-simulated-user-testing.md](109-simulated-user-testing.md) | FFFFF: Simulated User Testing | 🟢 | ⚠️ (eval sẵn) | 1-2 tuần |
| [110-process-reward.md](110-process-reward.md) | GGGGG: Process Reward | 🟢 | ⚠️ (GGGG sẵn) | 1-2 tuần |

### Nhóm 29: Tool Quality & Personalization (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [111-tool-description-engineering.md](111-tool-description-engineering.md) | HHHHH: Tool Description Eng | 🟢 | ⚠️ (OO sẵn) | 1 tuần |
| [112-learning-from-corrections.md](112-learning-from-corrections.md) | IIIII: Learning from Corrections | 🟡 | ⚠️ (audit sẵn) | 1-2 tuần |
| [113-tool-call-benchmark.md](113-tool-call-benchmark.md) | JJJJJ: Tool-Call Benchmark | 🟢 | ⚠️ (eval sẵn) | 1-2 tuần |

### Nhóm 30: Code-Driven Development (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [114-spec-driven-development.md](114-spec-driven-development.md) | KKKKK: Spec-Driven Dev | 🟢 | ⚠️ (docs sẵn) | 1-2 tuần |
| [115-pair-programming-agents.md](115-pair-programming-agents.md) | LLLLL: Pair Programming | 🟢 | ⚠️ (subagents sẵn) | 1 tuần |
| [116-spec-test-code-loop.md](116-spec-test-code-loop.md) | MMMMM: Spec→Test→Code | 🟢 | ⚠️ (vitest sẵn) | 1 tuần |

### Nhóm 31: Correction & Analysis (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [117-toolchain-feedback-loop.md](117-toolchain-feedback-loop.md) | NNNNN: Toolchain Feedback | 🟢 | ✅ (lint/tsc sẵn) | 1 tuần |
| [118-error-analysis.md](118-error-analysis.md) | OOOOO: Error Analysis | 🟢 | ⚠️ (trace sẵn) | 1-2 tuần |
| [119-bounded-self-correction.md](119-bounded-self-correction.md) | PPPPP: Bounded Self-Correction | 🟢 | ⚠️ (RRRR sẵn) | 1 tuần |

### Nhóm 32: Artifacts & Context (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [120-artifact-management.md](120-artifact-management.md) | QQQQQ: Artifact Catalog | 🟢 | ⚠️ (audit sẵn) | 1-2 tuần |
| [121-long-context-management.md](121-long-context-management.md) | RRRRR: Long-Context Mgmt | 🟡 | ⚠️ (CC/MMMM sẵn) | 2 tuần |
| [122-agent-reproducibility.md](122-agent-reproducibility.md) | SSSSS: Reproducibility | 🟢 | ⚠️ (trace sẵn) | 1-2 tuần |

### Nhóm 33: Explainability & Access (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [123-explainable-actions.md](123-explainable-actions.md) | TTTTT: Explainable Actions | 🟢 | ⚠️ (audit/trace sẵn) | 1 tuần |
| [124-dynamic-permissions.md](124-dynamic-permissions.md) | UUUUU: Dynamic Permissions | 🟡 | ⚠️ (OO static sẵn) | 2 tuần |
| [125-structured-reasoning.md](125-structured-reasoning.md) | VVVVV: Structured Reasoning | 🟡 | ⚠️ (trace sẵn) | 1 tuần |

### Nhóm 34: Inputs, Cost & Telemetry (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [126-multimodal-inputs.md](126-multimodal-inputs.md) | WWWWW: Multi-Modal Inputs | 🟡 | ⚠️ (inbox sẵn) | 2-3 tuần |
| [127-agentic-finops.md](127-agentic-finops.md) | XXXXX: Agentic FinOps | 🟡 | ⚠️ (SS sẵn) | 2 tuần |
| [128-otel-observability.md](128-otel-observability.md) | YYYYY: OTel Observability | 🟢 | ⚠️ (trace/audit sẵn) | 1-2 tuần |

### Nhóm 35: Ops, Eval & Reliability (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [129-shadow-deployment.md](129-shadow-deployment.md) | ZZZZZ: Shadow Deployment | 🟡 | ⚠️ (SSSS+PP sẵn) | 2-3 tuần |
| [130-agent-arena.md](130-agent-arena.md) | AAAAAA: Agent Arena | 🟢 | ⚠️ (PP+JJJJJ sẵn) | 1-2 tuần |
| [131-agent-watchdog.md](131-agent-watchdog.md) | BBBBBB: Agent Watchdog | 🟢 | ⚠️ (ECS+VV sẵn) | 1-2 tuần |

### Nhóm 36: Governance, Security & Decision (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [132-human-in-the-loop.md](132-human-in-the-loop.md) | CCCCCC: Human-in-the-Loop | 🟢 | ⚠️ (TT+WW sẵn) | 1-2 tuần |
| [133-agent-sandbox.md](133-agent-sandbox.md) | DDDDDD: Agent Sandbox | 🟡 | ⚠️ (shell+WW sẵn) | 2-4 tuần |
| [134-multi-agent-consensus.md](134-multi-agent-consensus.md) | EEEEEE: Multi-Agent Consensus | 🟢 | ⚠️ (DDD+PP sẵn) | 1-2 tuần |

### Nhóm 37: Deployment & Debug (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [135-agent-versioning.md](135-agent-versioning.md) | FFFFFF: Agent Versioning | 🟢 | ⚠️ (QQQQ+PP sẵn) | 1-2 tuần |
| [136-time-travel-debugging.md](136-time-travel-debugging.md) | GGGGGG: Time-Travel Debug | 🟢 | ⚠️ (SSSS+VV sẵn) | 2-3 tuần |
| [137-edge-on-device-agents.md](137-edge-on-device-agents.md) | HHHHHH: Edge/On-Device | 🟡 | ⚠️ (PPPP+HHH sẵn) | 2-4 tuần |

### Nhóm 38: Supply Chain, Sessions & Personalization (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [138-agent-supply-chain.md](138-agent-supply-chain.md) | IIIIII: Agent Supply Chain | 🟢 | ⚠️ (signing+BBB) | 1-2 tuần |
| [139-cross-device-sessions.md](139-cross-device-sessions.md) | JJJJJJ: Cross-Device Sessions | 🟡 | ⚠️ (durable+TT) | 2-3 tuần |
| [140-agent-personalization.md](140-agent-personalization.md) | KKKKKK: Personalization | 🟢 | ⚠️ (MM+IIIII) | 1-2 tuần |

### Nhóm 39: Tenancy, Ecosystem & Sustainability (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [141-multi-tenancy.md](141-multi-tenancy.md) | LLLLLL: Multi-Tenancy | 🟡 | ⚠️ (finops+UUUU) | 2-3 tuần |
| [142-skill-marketplace.md](142-skill-marketplace.md) | MMMMMM: Skill Marketplace | 🟢 | ⚠️ (skills+NNN) | 1-2 tuần |
| [143-carbon-aware-computing.md](143-carbon-aware-computing.md) | NNNNNN: Carbon-Aware | 🟢 | ⚠️ (PPPP+HHH) | 1-2 tuần |

### Nhóm 40: Fleet, Models & Languages (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [144-agent-fleet-management.md](144-agent-fleet-management.md) | OOOOOO: Fleet Management | 🟡 | ⚠️ (GG+BBBBBB) | 2-4 tuần |
| [145-model-registry.md](145-model-registry.md) | PPPPPP: Model Registry | 🟢 | ⚠️ (GG+HHH) | 1-2 tuần |
| [146-multilingual-agents.md](146-multilingual-agents.md) | QQQQQQ: Multilingual | 🟢 | ⚠️ (prompts+GG) | 1-2 tuần |

### Nhóm 41: Continuous Improvement, Scheduling & Identity (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [147-data-flywheel.md](147-data-flywheel.md) | RRRRRR: Data Flywheel | 🟢 | ⚠️ (PP+SSSS) | 2-3 tuần |
| [148-scheduled-agents.md](148-scheduled-agents.md) | SSSSSS: Scheduled Agents | 🟢 | ⚠️ (cron+durable) | 1 tuần |
| [149-delegated-agent-identity.md](149-delegated-agent-identity.md) | TTTTTT: Delegated Identity | 🟡 | ⚠️ (KKKK+UUUU) | 2-3 tuần |

### Nhóm 42: GUI, Models & Understanding (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [150-computer-use-agents.md](150-computer-use-agents.md) | UUUUUU: Computer-Use | 🟢 | ⚠️ (sandbox+HITL) | 2-4 tuần |
| [151-model-distillation.md](151-model-distillation.md) | VVVVVV: Distillation | 🟢 | ⚠️ (flywheel+PP) | 2-4 tuần |
| [152-intent-router.md](152-intent-router.md) | WWWWWW: Intent Router | 🟢 | ⚠️ (RR+NNN) | 1-2 tuần |

### Nhóm 43: Lifecycle, Adaptation & Privacy (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [153-agent-onboarding.md](153-agent-onboarding.md) | XXXXXX: Agent Onboarding | 🟢 | ⚠️ (AAAA+NNN) | 1 tuần |
| [154-non-stationary-adaptation.md](154-non-stationary-adaptation.md) | YYYYYY: Non-Stationary | 🟢 | ⚠️ (drift+GGG) | 2-3 tuần |
| [155-right-to-be-forgotten.md](155-right-to-be-forgotten.md) | ZZZZZZ: RTBF (GDPR) | 🟡 | ⚠️ (VV+MM) | 2-3 tuần |

### Nhóm 44: Commerce, Scorecards & Data Pipelines (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [156-agent-commerce.md](156-agent-commerce.md) | AAAAAAA: Agent Commerce | 🟢 | ⚠️ (finops+market) | 2-3 tuần |
| [157-agent-scorecard.md](157-agent-scorecard.md) | BBBBBBB: Scorecard | 🟢 | ⚠️ (PP+YYYY) | 1 tuần |
| [158-agentic-pipeline.md](158-agentic-pipeline.md) | CCCCCCC: Data Pipeline | 🟡 | ⚠️ (stream+TT) | 2-3 tuần |

### Nhóm 45: Decisions, Economics & DevTools (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [159-multi-criteria-decision.md](159-multi-criteria-decision.md) | DDDDDDD: Multi-Criteria | 🟢 | ⚠️ (finops+TTTT) | 1 tuần |
| [160-mechanism-design.md](160-mechanism-design.md) | EEEEEEE: Mechanism Design | 🟢 | ⚠️ (market+credit) | 2-4 tuần |
| [161-agent-ide.md](161-agent-ide.md) | FFFFFFFF: Agent IDE | 🟢 | ⚠️ (TTD+QQQQ) | 2-4 tuần |

### Nhóm 46: Protocols, Coordination & Workflows (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [162-mcp-first-architecture.md](162-mcp-first-architecture.md) | GGGGGGG: MCP-First | 🟡 | ⚠️ (gateway+registry) | 2-3 tuần |
| [163-conflict-detection.md](163-conflict-detection.md) | HHHHHHH: Conflict Detect | 🟡 | ⚠️ (LL+lock) | 2-4 tuần |
| [164-agentic-workflows-as-code.md](164-agentic-workflows-as-code.md) | IIIIIII: Workflow-as-Code | 🟡 | ⚠️ (B+pipeline) | 2-4 tuần |

### Nhóm 47: Memory, Caching & Cost (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [165-hierarchical-memory.md](165-hierarchical-memory.md) | JJJJJJJ: Hierarchical Mem | 🟡 | ⚠️ (V+R+M) | 3-5 tuần |
| [166-prompt-caching-layer.md](166-prompt-caching-layer.md) | KKKKKKK: Prompt Cache | 🟢 | ⚠️ (Redis+BBB) | 1-2 tuần |
| [167-per-task-cost-attribution.md](167-per-task-cost-attribution.md) | LLLLLLL: Cost Attribution | 🟡 | ⚠️ (finops+budget) | 1-2 tuần |

### Nhóm 48: Safety, Recovery & Context (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [168-agent-guardrails-layer.md](168-agent-guardrails-layer.md) | MMMMMMM: Guardrails | 🟡 | ⚠️ (WW+perms) | 2-4 tuần |
| [169-self-healing-agents.md](169-self-healing-agents.md) | NNNNNNN: Self-Healing | 🟡 | ⚠️ (retry+breaker) | 2-4 tuần |
| [170-context-engineering.md](170-context-engineering.md) | OOOOOOO: Context/Budget | 🟡 | ⚠️ (summarizer+RAG) | 2-4 tuần |

### Nhóm 49: Training, Teams & Prompts (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [171-curriculum-learning.md](171-curriculum-learning.md) | PPPPPPP: Curriculum | 🟡 | ⚠️ (PP+onboarding) | 2-3 tuần |
| [172-multi-agent-collaboration-config.md](172-multi-agent-collaboration-config.md) | QQQQQQQ: Team Config | 🟡 | ⚠️ (subagent+registry) | 1-3 tuần |
| [173-prompt-versioning-ab-testing.md](173-prompt-versioning-ab-testing.md) | RRRRRRR: Prompt A/B | 🟢 | ⚠️ (FFFF+PP) | 1-2 tuần |

### Nhóm 50: Reliability, Outputs & Discovery (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [174-fault-tolerance-failover.md](174-fault-tolerance-failover.md) | SSSSSSS: Fault Tolerance | 🟡 | ⚠️ (self-heal+health) | 3-5 tuần |
| [175-structured-output-validation.md](175-structured-output-validation.md) | TTTTTTT: Output Validate | 🟢 | ⚠️ (schema+zod) | 1-2 tuần |
| [176-agent-registry-discovery.md](176-agent-registry-discovery.md) | UUUUUUU: Agent Registry | 🟡 | ⚠️ (NNN+GGG) | 1-2 tuần |

### Nhóm 51: Data Governance, Models & CI/CD (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [177-data-access-governance.md](177-data-access-governance.md) | VVVVVVV: Data Governance | 🟡 | ⚠️ (perms+audit) | 2-4 tuần |
| [178-dynamic-model-routing.md](178-dynamic-model-routing.md) | WWWWWWW: Model Routing | 🟡 | ⚠️ (multi-model+GGG) | 2-4 tuần |
| [179-agent-testing-sandbox.md](179-agent-testing-sandbox.md) | XXXXXXX: Test Sandbox | 🟢 | ⚠️ (PP+smoke) | 2-4 tuần |

### Nhóm 52: Identity, Tools & Conversations (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [180-agent-identity-oauth.md](180-agent-identity-oauth.md) | YYYYYYY: Agent OAuth | 🟡 | ⚠️ (TTTTTT+broker) | 2-4 tuần |
| [181-tool-orchestration-graph.md](181-tool-orchestration-graph.md) | ZZZZZZZ: Tool Graph | 🟡 | ⚠️ (pipeline+WWWWWW) | 2-3 tuần |
| [182-conversational-memory.md](182-conversational-memory.md) | AAAAAAAA: Chat Memory | 🟢 | ⚠️ (history+J) | 1-2 tuần |

### Nhóm 53: Swarms, Alignment & Planning (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [183-swarm-intelligence.md](183-swarm-intelligence.md) | BBBBBBBB: Swarm | 🟡 | ⚠️ (LL+market) | 3-5 tuần |
| [184-rlhf-preference-alignment.md](184-rlhf-preference-alignment.md) | CCCCCCCC: RLHF | 🔴 | ❌ (ngoài lõi) | 3-6 tuần |
| [185-lookahead-tree-search.md](185-lookahead-tree-search.md) | DDDDDDDD: Tree Search | 🟡 | ⚠️ (planner+TTD) | 3-5 tuần |

### Nhóm 54: Reasoning, Retrieval & Security (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [186-multi-agent-debate-ensemble.md](186-multi-agent-debate-ensemble.md) | EEEEEEEE: Ensemble | 🟡 | ⚠️ (multi-model) | 2-4 tuần |
| [187-agentic-rag.md](187-agentic-rag.md) | FFFFFFFF: Agentic RAG | 🟡 | ⚠️ (RAG+tool) | 2-4 tuần |
| [188-least-privilege-scoping.md](188-least-privilege-scoping.md) | GGGGGGGG: Least Priv. | 🟡 | ⚠️ (perms+NNN) | 2-3 tuần |

### Nhóm 55: Protocols, Testing & Caching (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [189-interoperability-protocols.md](189-interoperability-protocols.md) | HHHHHHHH: Interop | 🟡 | ⚠️ (MCP+ACP) | 2-4 tuần |
| [190-property-based-testing.md](190-property-based-testing.md) | IIIIIIII: PBT | 🟢 | ⚠️ (unit+TTTTTTT) | 1-3 tuần |
| [191-kv-semantic-cache.md](191-kv-semantic-cache.md) | JJJJJJJJ: KV+Sem Cache | 🟢 | ⚠️ (prompt cache) | 1-2 tuần |

### Nhóm 56: Economics, Tenancy & RAG (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [192-token-economics.md](192-token-economics.md) | KKKKKKKK: Token Econ | 🟡 | ⚠️ (finops+billing) | 1-2 tuần |
| [193-multi-tenant-isolation.md](193-multi-tenant-isolation.md) | LLLLLLLL: Tenant Isol. | 🟡 | ⚠️ (141+perms) | 3-6 tuần |
| [194-rag-evaluation-metrics.md](194-rag-evaluation-metrics.md) | MMMMMMMM: RAG Eval | 🟢 | ⚠️ (PP+RAG) | 1-2 tuần |

### Nhóm 57: Persona, Limits & Search (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [195-persona-driven-agents.md](195-persona-driven-agents.md) | NNNNNNNN: Persona | 🟢 | ⚠️ (prompt+RRRRRRR) | 1-2 tuần |
| [196-rate-limiting-quotas.md](196-rate-limiting-quotas.md) | OOOOOOOO: Rate Limit | 🟡 | ⚠️ (budget+breaker) | 1-2 tuần |
| [197-hybrid-search-reranking.md](197-hybrid-search-reranking.md) | PPPPPPPP: Hybrid Search | 🟡 | ⚠️ (R+retrieval) | 1-3 tuần |

### Nhóm 58: Audit, Delegation & Security (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [198-audit-trails.md](198-audit-trails.md) | QQQQQQQQ: Audit Trail | 🟡 | ⚠️ (VV+QQQQ) | 2-4 tuần |
| [199-delegated-task-authority.md](199-delegated-task-authority.md) | RRRRRRRR: Delegation | 🟡 | ⚠️ (subagent+OAuth) | 2-4 tuần |
| [200-prompt-injection-defense.md](200-prompt-injection-defense.md) | SSSSSSSS: Inject Defense | 🟡 | ⚠️ (QQQQQ+guard) | 2-4 tuần |

### Nhóm 59: Model, Communication & Resilience (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [201-fine-tuning-custom-models.md](201-fine-tuning-custom-models.md) | TTTTTTTT: Fine-Tune Model | 🟢 | ❌ (chưa pipeline) | 4-8 tuần |
| [202-agent-communication-patterns.md](202-agent-communication-patterns.md) | UUUUUUUU: Comm Patterns | 🟡 | ⚠️ (bus nội bộ) | 3-6 tuần |
| [203-failure-detection-retry-loops.md](203-failure-detection-retry-loops.md) | VVVVVVVV: Loop Guard | 🟡 | ⚠️ (max-step + watchdog) | 1-6 tuần |

### Nhóm 60: Generation, Reasoning & Prompting (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [204-constrained-decoding.md](204-constrained-decoding.md) | WWWWWWWW: Constrained Decode | 🟡 | ⚠️ (175 validate) | 2-4 tuần |
| [205-self-consistency-sampling.md](205-self-consistency-sampling.md) | XXXXXXXX: Self-Consistency | 🟢 | ❌ (chưa N-sample) | 1-2 tuần |
| [206-dynamic-few-shot-exemplar.md](206-dynamic-few-shot-exemplar.md) | YYYYYYYY: Few-Shot Dynamic | 🟢 | ✅ (tĩnh — chưa động) | 1-2 tuần |

### Nhóm 61: Latency & Retrieval Quality (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [207-speculative-decoding.md](207-speculative-decoding.md) | ZZZZZZZZ: Spec Decode | 🟢 | ⚠️ (05 proxy) | 2-4 tuần |
| [208-parallel-tool-calls.md](208-parallel-tool-calls.md) | AAAAAAAA: Par-Tool | 🔴 | ⚠️ (tuần tự) | 1-3 tuần |
| [209-query-rewriting-expansion.md](209-query-rewriting-expansion.md) | BBBBBBBB: Query Rewrite | 🟢 | ⚠️ (chưa pre-step) | 1-2 tuần |

### Nhóm 62: Indexing & Local Runtime (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [210-chunking-indexing-strategy.md](210-chunking-indexing-strategy.md) | CCCCCCCC: Chunking | 🟡 | ⚠️ (chunk phẳng) | 2-4 tuần |
| [211-model-quantization-local-deployment.md](211-model-quantization-local-deployment.md) | DDDDDDDD: Quantize | 🟢 | ⚠️ (chưa runtime) | 2-4 tuần |
| [212-embedding-model-evaluation.md](212-embedding-model-evaluation.md) | EEEEEEEE: Embed Eval | 🟢 | ⚠️ (default model) | 1-3 tuần |

### Nhóm 63: Data Privacy, Freshness & Time (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [213-vector-index-maintenance.md](213-vector-index-maintenance.md) | FFFFFFFF: Index Maint | 🟡 | ⚠️ (index tĩnh) | 2-4 tuần |
| [214-pii-redaction-anonymization.md](214-pii-redaction-anonymization.md) | GGGGGGGG: PII Redact | 🟡 | ⚠️ (chưa lớp) | 2-4 tuần |
| [215-deadline-bound-execution.md](215-deadline-bound-execution.md) | HHHHHHHH: Deadline | 🟡 | ⚠️ (timeout thô) | 2-4 tuần |

### Nhóm 64: Voice, Browsing & Compression (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [216-voice-agent-pipeline.md](216-voice-agent-pipeline.md) | IIIIIIII: Voice Agent | 🟡 | ⚠️ (text only) | 4-8 tuần |
| [217-web-browsing-agents.md](217-web-browsing-agents.md) | JJJJJJJJ: Web Agent | 🟡 | ⚠️ (fetch đơn) | 3-6 tuần |
| [218-tool-output-compression.md](218-tool-output-compression.md) | KKKKKKKK: Compress | 🟡 | ⚠️ (truncate cứng) | 2-4 tuần |

### Nhóm 65: Trust, Media & Ops (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [219-answer-grounding-citations.md](219-answer-grounding-citations.md) | LLLLLLLL: Grounding | 🟡 | ⚠️ (chưa verify) | 2-4 tuần |
| [220-multimodal-output-generation.md](220-multimodal-output-generation.md) | MMMMMMMM: Media Out | 🟡 | ⚠️ (text only) | 3-6 tuần |
| [221-feature-flags-rollout.md](221-feature-flags-rollout.md) | NNNNNNNN: Flags/Rollout | 🟢 | ⚠️ (config code) | 2-4 tuần |

### Nhóm 66: Throughput, Grounding & Model (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [222-batch-llm-processing.md](222-batch-llm-processing.md) | OOOOOOOO: Batch | 🟢 | ⚠️ (online call) | 3-6 tuần |
| [223-web-search-grounding-tool.md](223-web-search-grounding-tool.md) | PPPPPPPP: Web Search | 🟢 | ⚠️ (fetch/crawl) | 1-2 tuần |
| [224-knowledge-editing.md](224-knowledge-editing.md) | QQQQQQQQ: K-Edit | 🟡 | ❌ (chưa có) | 4-8 tuần |

### Nhóm 67: Safety, Gates & Notify (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [225-instruction-hierarchy.md](225-instruction-hierarchy.md) | RRRRRRRR: Hierarch | 🟡 | ⚠️ (cấp cơ bản) | 3-6 tuần |
| [226-human-approval-gates.md](226-human-approval-gates.md) | SSSSSSSS: Approval Gate | 🟡 | ⚠️ (HITL thô) | 2-4 tuần |
| [227-agent-notifications-alerts.md](227-agent-notifications-alerts.md) | TTTTTTTT: Notify | 🟢 | ⚠️ (terminal) | 2-4 tuần |







































## So sánh nhanh

```
Coupling:       A🔴 (nặng) · AA,AAAA,BBBBB,C,CC,CCCCC,DD,EE,FF,GG,II,IIIII,JJ,KK,KKKK,LL,LLLL,OO,OOOO,RRRR,RRRRR,UUUUU,V,VVVVV,WW,WWWW,WWWWW,XXXX,XXXXX,Y,Z🟡 (medium) · còn lại🟢 (zero)
Agent-agnostic: A❌ · C,CC,LL,OO,R,V,WW,WWWWW⚠️ · còn lại✅
Code sẵn:       DD,H,I,JJ,K,MM,NNNNN,OO,PP,R,U,W✅ (đã có/có 1 phần lớn) · AAA,AAAA,AAAAA,BBB,BBBB,BBBBB,CCC,CCCC,CCCCC,DDD,DDDD,DDDDD,EEE,EEEE,EEEEE,FFF,FFFF,FFFFF,GGGG,GGGGG,HHH,HHHH,HHHHH,III,IIII,IIIII,JJJ,JJJJ,JJJJJ,KKK,KKKK,KKKKK,LLL,LLLL,LLLLL,MMM,MMMM,MMMMM,NN,NNN,NNNN,OOOO,OOOOO,PPP,PPPP,PPPPP,QQ,QQQ,QQQQ,QQQQQ,RR,RRR,RRRR,RRRRR,SS,SSS,SSSS,SSSSS,TT,TTT,TTTT,TTTTT,UUU,UUUU,UUUUU,VVV,VVVV,VVVVV,WW,WWW,WWWW,WWWWW,XX,XXXX,XXXXX,YY,YYYY,YYYYY,ZZZ,ZZZZ⚠️ (1 phần) · còn lại build mới
Effort thấp:    B,F,J,R,T,EEE,HHH(3-5 ngày/1 tuần) · E,O,P,Q,NN,OO,QQ,RR,UU,CCC(1 tuần) · MM,PP đã có (0)
```

> Ghi chú: chữ cái hướng (A–SSSSS) theo thứ tự thiết kế gốc; số file theo thứ tự trình bày
> nên không trùng thứ tự chữ cái (vd `09-pi-rpc-bridge.md` = R, `20-immune-system.md` = BB).
> `R` nằm giữa `H` và `I` theo thứ tự file nhưng chữ cái không liên tục một phần vì S không được dùng.
> Nhóm 9 (LL–QQ) bổ sung sau khi đánh giá gaps: Blackboard, Memory Mgmt, Cache,
> Tool Registry, Eval Harness, Circuit Breaker.
> Nhóm 10 (RR–BBB) bổ sung từ nghiên cứu MCP (Anthropic/ADK/catalog/arXiv):
> Routing, Budget, Checkpoint, Escalation, Anti-Patterns, BDI, Impasse, Compilation,
> Pressure-Field, Gossip, A2A.
> Nhóm 11 (DDD–HHH) bổ sung từ web research 2026 (web-search-prime):
> MoA, Reflexion, Plan-and-Execute, Agentic RAG, Model Cascade — trào lưu 2024-2026.
> Nhóm 12 (III–KKK) bổ sung từ web research 2026 (web-search-prime):
> ACI (SWE-agent), Agent Observability (OTel GenAI), Credential Broker (IETF CB4A).
> Nhóm 13 (LLL–NNN) bổ sung từ web research 2026 (web-search-prime):
> HTN Planning (Erol/SHOP2), MCP Gateway (2025-2026), Tool Maker (Cai et al. 2023).
> Nhóm 14 (OOO–QQQ) bổ sung từ web research 2026 (web-search-prime):
> Agent Chaos Eng (2026), Serverless Agents (AWS 2026), Subsumption (Brooks 1986).
> Nhóm 15 (RRR–TTT) bổ sung từ web research 2026 (web-search-prime):
> Agentic Firewall (2025-2026), LLM Gateway (LiteLLM/Portkey), EvoPrompt (Guo 2023).
> Nhóm 16 (UUU–WWW) bổ sung từ web research 2026 (web-search-prime):
> LLM Red Teaming (PyRIT 2024), Durable Execution (Temporal), Stateful Graph (LangGraph).
> Nhóm 17 (XXX–ZZZ) bổ sung từ web research 2026 (web-search-prime):
> LATS Tree Search (Zhou 2024), PDDL Classical Planning (NeurIPS 2025), DSPy (Khattab 2024).
> Nhóm 18 (AAAA–CCCC) bổ sung từ web research 2026 (web-search-prime):
> Agent Negotiation (AgenticPay 2026), Swarm Optimization (EMNLP 2025), Context Engineering (2026).
> Nhóm 19 (DDDD–FFFF) bổ sung từ web research 2026 (web-search-prime):
> Test-Time Compute (ICLR 2025), Memory Consolidation (SleepCycle 2026), Tool Discovery (Smithery/MCPHub).
> Nhóm 20 (GGGG–IIII) bổ sung từ web research 2026 (web-search-prime):
> LLM-as-Judge (2026), Agent Spec (Open Agent Spec 2025), Agent Topology (HMAS 2025).
> Nhóm 21 (JJJJ–LLLL) bổ sung từ web research 2026 (web-search-prime):
> TEE/Confidential (arXiv 2605.03213), Hybrid Graph+Vector Memory (GraphRAG/Zep), Shared Graph Memory (NODES 2026).
> Nhóm 22 (MMMM–OOOO) bổ sung từ web research 2026 (web-search-prime):
> Prompt Caching (arXiv 2601.06007), Synthetic Eval Data (decodingai/futureagi), Semantic Caching (arXiv 2411.05276).
> Nhóm 23 (PPPP–RRRR) bổ sung từ web research 2026 (web-search-prime):
> Hybrid Local-Cloud (sitepoint 2026), Trajectory Replay (arXiv 2606.04990), Tool-Call Recovery (zylos/taskade 2026).
> Nhóm 24 (SSSS–UUUU) bổ sung từ web research 2026 (web-search-prime):
> Agent CI/CD (kinde/galtea/RedHat 2026), Tool Schema Drift (fixzi/msft 2026), Tool Mocking (Zod Contract Mock Forge 2026).
> Nhóm 25 (VVVV–XXXX) bổ sung từ web research 2026 (web-search-prime):
> Progressive Disclosure (Anthropic/arXiv 2607.17598), Prompt Compression (LLMLingua), Dynamic Tool Selection (lunar.dev).
> Nhóm 26 (YYYY–AAAAA) bổ sung từ web research 2026 (web-search-prime):
> Reward Hacking (RHB/ICML 2026), Agent Drift (golden regression), Task Decomposition (arXiv 2602.21670).
> Nhóm 27 (BBBBB–DDDDD) bổ sung từ web research 2026 (web-search-prime):
> Self-Improving (arXiv 2607.13104), RAG Poisoning Defense (arXiv 2603.18034), Canary/Honeypot (2026).
> Nhóm 28 (EEEEE–GGGGG) bổ sung từ web research 2026 (web-search-prime):
> Credit Assignment (NeurIPS 2025), Simulated User Testing (UXAgent), Process Reward (PRM/step supervision).
> Nhóm 29 (HHHHH–JJJJJ) bổ sung từ web research 2026 (web-search-prime):
> Tool Description Eng (Anthropic/Paragon), Learning from Corrections (Meta PAHF), Tool-Call Benchmark (ToolACE 236 cites).
> Nhóm 30 (KKKKK–MMMMM) bổ sung từ web research 2026 (web-search-prime):
> Spec-Driven Dev (GitHub Spec-Kit 2025, arXiv 2602.00180), Pair Programming (PairCoder 56 cites), Spec→Test→Code (Spec-Kit/TDD).
> Nhóm 31 (NNNNN–PPPPP) bổ sung từ web research 2026 (web-search-prime):
> Toolchain Feedback (marclove/aihero), Error Analysis (Cemri 602 cites/ErrorProbe), Bounded Self-Correction (Lanham/SSRN).
> Nhóm 32 (QQQQQ–SSSSS) bổ sung từ web research 2026 (web-search-prime):
> Artifact Catalog (MAV/agentregistry), Long-Context Mgmt (arXiv 2601.15300/Chain-of-Agents), Reproducibility (jfrog/MAV).
> Nhóm 33 (TTTTT–VVVVV) bổ sung từ web research 2026 (web-search-prime):
> Explainable Actions (arXiv 2512.21699/loginradius), Dynamic Permissions (arXiv 2607.22445/aembit/oso),
> Structured Reasoning (reasoning models 2025-2026/testrigor).
> Nhóm 34 (WWWWW–YYYYY) bổ sung từ web research 2026 (web-search-prime):
> Multi-Modal Inputs (chanl.ai/oneReach), Agentic FinOps (praesidia/finout/tmls), OTel GenAI Observability (CNCF semconv).
> Nhóm 35 (ZZZZZ–BBBBBB) bổ sung từ web research 2026 (web-search-prime):
> Shadow Deployment (Ivanov 2026 A-SCDT/Materialize), Agent Arena (LMArena Elo 2026), Agent Watchdog (Datadog/os.moda).
> Nhóm 36 (CCCCCC–EEEEEE) bổ sung từ web research 2026 (web-search-prime):
> Human-in-the-Loop (StackAI/Port.io/Galileo), Agent Sandbox (Edera/Augment/Northflank 2026), Multi-Agent Consensus (Kaesberg ACL 2025, 67 cites).
> Nhóm 37 (FFFFFF–HHHHHH) bổ sung từ web research 2026 (web-search-prime):
> Agent Versioning (Claude cookbook/Arthur AI/Restate), Time-Travel Debug (Undo.io/Tian Pan 2026), Edge/On-Device (Qualcomm NPU 2026).
> Nhóm 38 (IIIIII–KKKKKK) bổ sung từ web research 2026 (web-search-prime):
> Agent Supply Chain (ReversingLabs/JFrog 2026), Cross-Device Sessions (Ably/Fast.io 2026), Personalization (AdaPA NeurIPS 2025).
> Nhóm 39 (LLLLLL–NNNNNN) bổ sung từ web research 2026 (web-search-prime):
> Multi-Tenancy (ScaleKit/Blaxel 2026), Skill Marketplace (Manus/agent-skills.cc 2026), Carbon-Aware (GAR/arXiv 2509.19996).
> Nhóm 40 (OOOOOO–QQQQQQ) bổ sung từ web research 2026 (web-search-prime):
> Agent Fleet (Fast.io/Zylos 2026), Model Registry (MLflow/SageMaker), Multilingual (UseInvent/Delight 2026).
> Nhóm 41 (RRRRRR–TTTTTT) bổ sung từ web research 2026 (web-search-prime):
> Data Flywheel (arXiv 2510.06674/NVIDIA), Scheduled Agents (Fast.io/ChatGPT 2026), Delegated Identity (OpenID 2025/ScaleKit).
> Nhóm 42 (UUUUUU–WWWWWW) bổ sung từ web research 2026 (web-search-prime):
> Computer-Use (Anthropic/arXiv 2411.10323), Model Distillation (Google step-by-step/IBM), Intent Router (NVIDIA AI-Q/Tian Pan 2026).
> Nhóm 43 (XXXXXX–ZZZZZZ) bổ sung từ web research 2026 (web-search-prime):
> Agent Onboarding (DataHub/AgentPatterns 2026), Non-Stationary (arXiv 2505.17902), RTBF (GDPR Art.17/CSA 2025).
> Nhóm 44 (AAAAAAA–CCCCCCC) bổ sung từ web research 2026 (web-search-prime):
> Agent Commerce (Nevermined/Unframe), Agent Scorecard (AWS Connect/Arize), Agentic Data Pipeline (Conduktor/Redpanda/arXiv 2512.23737).
> Nhóm 45 (DDDDDDD–FFFFFFFF) bổ sung từ web research 2026 (web-search-prime):
> Multi-Criteria Decision (TOPSIS/arXiv 2601.22433), Mechanism Design (Hurwicz Nobel 2007/Parkes), Agent IDE (AGDebugger arXiv 2503.02068/LangGraph Studio).
> Nhóm 46 (GGGGGGG–IIIIIII) bổ sung từ web research 2026 (web-search-prime):
> MCP-First (arXiv 2505.02279/AWS agents-as-MCP-servers), Conflict Detection (CBS Sharon 2015), Workflow-as-Code (arXiv 2509.09915/Temporal).
> Nhóm 47 (JJJJJJJ–LLLLLLL) bổ sung từ web research 2026 (web-search-prime):
> Hierarchical Memory (IBM/MongoDB), Prompt Caching (arXiv 2601.06007), Per-Task Cost Attribution (Codenotary/finout).
> Nhóm 48 (MMMMMMM–OOOOOOO) bổ sung từ web research 2026 (web-search-prime):
> Agent Guardrails (AgentDoG arXiv 2601.18491/Galileo), Self-Healing (arXiv 2605.06737/Union.ai), Context Engineering (MindStudio/elvex).
> Nhóm 49 (PPPPPPP–RRRRRRR) bổ sung từ web research 2026 (web-search-prime):
> Curriculum Learning (arXiv 2512.08545/WebRL 96 cites), Multi-Agent Team Config (AWS Bedrock/Oracle ADK), Prompt Versioning & A/B (MLflow/Confident AI).
> Nhóm 50 (SSSSSSS–UUUUUUU) bổ sung từ web research 2026 (web-search-prime):
> Fault Tolerance & Failover (Couchbase/Nobl9 SLO), Structured Output Validation (arXiv 2606.09395/Zod), Agent Registry & Discovery (TrueFoundry/Google/AWS).
> Nhóm 51 (VVVVVVV–XXXXXXX) bổ sung từ web research 2026 (web-search-prime):
> Data Access Governance (KuppingerCole/Okta FGAC), Dynamic Model Routing (Zylos/arXiv 2603.04445), Agent Testing Sandbox (Confident AI/Modal/datagrid).
> Nhóm 52 (YYYYYYY–AAAAAAAA) bổ sung từ web research 2026 (web-search-prime):
> Agent Identity & OAuth (OpenID/Security OAuth 2.1), Tool Orchestration Graph (arXiv 2603.22862/LangChain), Conversational Memory (mem0/Oracle layered).
> Nhóm 53 (BBBBBBBB–DDDDDDDD) bổ sung từ web research 2026 (web-search-prime):
> Swarm Intelligence (AWS Swarm Agentic AI/Serugendo 346 cites), RLHF Preference Alignment (HF/arXiv 2504.03784), Lookahead & Tree Search (arXiv 2601.08955/LATS).
> Nhóm 54 (EEEEEEEE–GGGGGGGG) bổ sung từ web research 2026 (web-search-prime):
> Multi-Agent Debate & Ensemble (Wisdom of Silicon Crowd/Schoenegger), Agentic RAG (arXiv 2501.09136 — 561 cites), Least Privilege Tool Scoping (Microsoft/arXiv 2607.22445).
> Nhóm 55 (HHHHHHHH–JJJJJJJJ) bổ sung từ web research 2026 (web-search-prime):
> Interoperability Protocols (arXiv 2602.15055/Zylos A2A-MCP-ACP), Property-Based Testing (Anthropic/arXiv 2506.18315), KV & Semantic Cache (Raschka/Spheron GPTCache).
> Nhóm 56 (KKKKKKKK–MMMMMMMM) bổ sung từ web research 2026 (web-search-prime):
> Token Economics & Pricing Models (McKinsey/Stanford/mightybot), Multi-Tenant Isolation (Azure/blaxel container), RAG Evaluation Metrics (DeepEval/arXiv 2405.07437).
> Nhóm 57 (NNNNNNNN–PPPPPPPP) bổ sung từ web research 2026 (web-search-prime):
> Persona-Driven Agents (arXiv 2406.17962/ACL 2025), Rate Limiting & Quotas (TrueFoundry/Tamir multi-agent), Hybrid Search & Reranking (Qdrant/Superlinked).
> Nhóm 58 (QQQQQQQQ–SSSSSSSS) bổ sung từ web research 2026 (web-search-prime):
> Audit Trails & Traceability (Collibra/EU AI Act Art 12/IETF), Delegated Task Authority (arXiv 2501.09674/WorkOS), Prompt Injection Defense (OWASP/Microsoft indirect).
> Nhóm 59 (TTTTTTTT–VVVVVVVV) bổ sung từ web research 2026 (web-search-prime/firecrawl):
> Fine-Tuning & Custom Models (arXiv 2404.10779/Databricks), Multi-Agent Communication (Confluent/zylos EDA), Failure Detection & Retry Loops (ODSC/dev.to/CockroachDB).
> Nhóm 60 (WWWWWWWW–YYYYYYYY) bổ sung từ web research 2026 (web-search-prime):
> Constrained Decoding (arXiv 2501.10868/XGrammar token-mask), Self-Consistency Sampling (arXiv 2505.10772/NAACL 2025 — vote đa số N path), Dynamic Few-Shot Exemplar (arXiv 2507.23211/D-k-ICL).
> Nhóm 61 (ZZZZZZZZ–BBBBBBBB) bổ sung từ web research 2026 (web-search-prime):
> Speculative Decoding (NVIDIA/arXiv 2402.01528 — draft verify song song), Parallel Tool Calls (Airbyte/OpenHands/tianpan coupling), Query Rewriting & Expansion (Meilisearch/Elastic/arXiv 2407.12529/HyDE).
> Nhóm 62 (CCCCCCCC–EEEEEEEE) bổ sung từ web research 2026 (web-search-prime):
> Chunking & Indexing Strategy (prodinit/Dell — parent-child), Model Quantization & Local Deployment (Meta/arXiv 2601.14277 — GGUF/INT4/AWQ), Embedding Model Evaluation (OpenLayer/arXiv 2607.23507/Weaviate recall@K).
> Nhóm 63 (FFFFFFFF–HHHHHHHH) bổ sung từ web research 2026 (web-search-prime):
> Vector Index Maintenance (apxml/Ada-IVF arXiv 2411.00970 — incremental + nhiệt), PII Redaction & Anonymization (arXiv 2501.12465/Presidio — gateway + sweep output), Deadline-Bounded Execution (BAML/zylos TTFT — partial result).
> Nhóm 64 (IIIIIIII–KKKKKKKK) bổ sung từ web research 2026 (web-search-prime):
> Voice Agent Pipeline (LiveKit/Ketch/arXiv 2603.05413 — VAD→STT→LLM→TTS <500ms), Web Browsing Agents (Playwright/Stackademic — DOM + session), Tool Output Compression (factory.ai/Morph — verbatim vs semantic).
> Nhóm 65 (LLLLLLLL–NNNNNNNN) bổ sung từ web research 2026 (web-search-prime):
> Answer Grounding & Citation (arXiv 2510.11394 VeriCite/Stanford Legal — verify claim), Multimodal Output Generation (arXiv 2601.03250/NVIDIA NIM — sinh ảnh/video), Feature Flags & Rollout (GrowthBook/Harness/Azure — % + rollback).
> Nhóm 66 (OOOOOOOO–QQQQQQQQ) bổ sung từ web research 2026 (web-search-prime):
> Batch Processing (apxml/zylos — gom request, continuous batching 2-23x), Web Search Grounding (Confident/TDS — SERP API + citation), Knowledge Editing (ROME/MEMIT — sửa fact trong trọng số).
> Nhóm 67 (RRRRRRRR–TTTTTTTT) bổ sung từ web research 2026 (web-search-prime):
> Instruction Hierarchy (OpenAI arXiv 2404.13208 — ưu tiên system > user > injected), Human Approval Gates (MindStudio gate pattern — prepare, don't submit), Agent Notifications (Sequenzy/Slack — đa kênh push).
> Anthropic 5 workflow patterns đã cover hết: Chaining→AA, Parallelization→KK,
> Orchestrator-Workers→XX+KK, Routing→RR, Evaluator-Optimizer→JJ.

## Hướng nào cho mya?

| Tiêu chí | Hướng | Lý do |
|---|---|---|
| Ít effort nhất | **T: Stigmergy** | fs.watch session files → trigger |
| Thiết thực nhất | **R: pi RPC** | pi đã có 33 commands, verify work |
| Elegant nhất | **U: Tuple Space** | Agent tự tìm việc, SQLite sẵn |
| Lâu dài sạch nhất | **G: Proxy+Watcher** | Agent-agnostic + inject + observe |
| Tham vọng nhất | **N: Agent OS** | mya = platform, agents = apps |
| Self-healing | **DD: Reconcile** | K8s-proven, cron đã có reconcile |
| Reliability | **GG: Supervisor** | Erlang OTP, crash isolation |
| Quality | **JJ: GAN Adversarial** | council sẵn, thêm vòng lặp fix |
| Scale | **KK: MapReduce** | Chia task song song, gộp kết quả |
| Tiết kiệm cost | **NN: Cache Layer** | Tool-result cache cắt chi phí lặp lại |
| Context dài | **MM: Memory Mgmt** | Đã có 3 tầng, chỉ cần policy |
| Regression-test hành vi | **PP: Eval Harness** | packages/eval sẵn, thêm golden scenarios |
| Đi đúng agent/model | **RR: Routing** | roles + registry sẵn, thêm router |
| Chống chạy lố cost | **SS: Budget Gating** | Trần cứng token/cost/steps |
| Task chờ CI/approval | **TT: Checkpoint-Resume** | Session JSONL sẵn làm checkpoint |
| Hủy task vô ích | **WW: BDI Reconsideration** | Brain=beliefs, kanban=intentions |
| Thay agent drop-in | **BBB: A2A Capability Cards** | intercom+rpc sẵn, thêm AgentCard |
| Chuyển việc đúng người | **CCC: Explicit Handoff** | 4th foundation pattern (LangChain) |
| Cải thiện chất lượng | **DDD: Mixture of Agents** | N lời giải + aggregator, registry sẵn |
| Học từ lỗi | **EEE: Reflexion** | eval-harness sẵn, thêm reflect loop |
| Goal lớn nhiều bước | **FFF: Plan-and-Execute** | Planner=big, executor=small, kanban sẵn |
| Hỏi tri thức ngoài | **GGG: Agentic RAG** | MCP search sẵn, cần index nội bộ |
| Cắt cost model | **HHH: Model Cascade** | Tier sẵn, thêm confidence judge |
| Tool cho model tốt hơn | **III: ACI** | SWE-agent: +12% cùng model |
| Debug chậm/tốn | **JJJ: Observability** | Span tree + cost attribution |
| Secret không chạm agent | **KKK: Credential Broker** | IETF CB4A, key-rotation sẵn |
| Plan deterministic | **LLL: HTN** | Method library + backtracking |
| Nhiều MCP servers | **MMM: MCP Gateway** | mcp-client+oauth sẵn, thêm facade |
| Tự viết tool khi thiếu | **NNN: Tool Maker** | Registry+eval sẵn, tool tái dùng |
| Đo độ chịu lỗi | **OOO: Agent Chaos Eng** | Masking rate → CI gate |
| Worker scale-to-zero | **PPP: Serverless** | Cron+sweep sẵn, thêm event trigger |
| An toàn không phụ thuộc agent | **QQQ: Subsumption** | Lớp ưu tiên, OO/SS/PP sẵn |
| Chặn prompt injection | **RRR: Agentic Firewall** | Input/output gate, audit+secrets sẵn |
| 1 endpoint mọi LLM | **SSS: LLM Gateway** | Registry+fallback sẵn, ráp gateway |
| Tự tinh chỉnh prompt | **TTT: EvoPrompt** | Eval = fitness, promote có bằng chứng |
| Tấn công để đo phòng thủ | **UUU: Red Teaming** | PyRIT-style multi-turn, audit sẵn |
| Sống sót mọi crash | **VVV: Durable Execution** | Replay từ history, runner sẵn |
| Tiến trình có vòng lặp | **WWW: Stateful Graph** | Nodes/edges/checkpoint, HITL node |
| Thử-sai nhiều nhánh | **XXX: LATS Tree Search** | MCTS + reflection, PP = reward |
| Đảm bảo formal | **YYY: PDDL** | Solver chứng minh unsolvable |
| Prompt không fragile | **ZZZ: DSPy Compile** | Signature + examples → compile |
| Xung đột tài nguyên | **AAAA: Negotiation** | Offer/agreement, intercom sẵn |
| Tune tham số tự động | **BBBB: Swarm PSO** | Liên tục: velocity + eval |
| Context ổn định | **CCCC: Context Eng** | Assembler + budget + entropy |
| Compute theo độ khó | **DDDD: Test-Time Compute** | Verifier-driven stop, ICLR 2025 |
| Trí nhớ tự dọn | **EEEE: Consolidation** | Sleep-cycle, Anthropic Dreaming |
| Tự tìm tool ngoài | **FFFF: Tool Discovery** | MCP registry + gate approve |
| Chấm task mở | **GGGG: LLM-as-Judge** | Rubric + calibration + debias |
| Agent = khai báo | **HHHH: Agent Spec** | Open Agent Spec, validator |
| Cấu trúc nhóm agent | **IIII: Topology** | Star/mesh/hierarchical/ring |
| Chạy trên máy đáng nghi | **JJJJ: TEE** | Enclave + attestation |
| Memory suy luận quan hệ | **KKKK: Hybrid Memory** | Vector + graph (GraphRAG/Zep) |
| Nhiều agent chung tri thức | **LLLL: Shared Graph** | Resolution + versioning |
| Agent loop đắt (token) | **MMMM: Prompt Cache** | Static-first, prefix cache |
| Cần test case cho eval | **NNNN: Synthetic Data** | Dimension + anchor + evolve |
| Query routine trùng lặp | **OOOO: Semantic Cache** | Embed + threshold, bust theo VV |
| Privacy/offline | **PPPP: Local-Cloud** | Ollama + router, escalate cloud |
| Đổi prompt sợ vỡ | **QQQQ: Trajectory Replay** | Trace thật chạy lại, golden |
| Tool fail liên miên | **RRRR: Recovery** | Structured error + LLM sửa |
| Đổi prompt cần chặn vỡ | **SSSS: Agent CI/CD** | Eval gate trong PR |
| MCP server hay đổi | **TTTT: Schema Drift** | Baseline + fail-closed |
| Test không đụng thật | **UUUU: Tool Mocking** | Mock từ schema + violations |
| Context đầy không cần thiết | **VVVV: Disclosure** | Metadata → mở dần (Anthropic) |
| Context dài phải giữ | **WWWW: Compression** | LLMLingua nén token |
| Hàng trăm tools quá window | **XXXX: Select Tools** | Embed + top-k mỗi turn |
| Agent ăn gian metric | **YYYY: Anti-Hack** | Trace verify + effort ratio |
| Chất lượng giảm âm thầm | **ZZZZ: Agent Drift** | Golden regression nightly |
| Task lớn hay vỡ | **AAAAA: Decompose** | Task tree + checkpoint |
| Agent tự cải thiện | **BBBBB: Self-Improve** | Feedback → fix có gate |
| KB bị chôn độc | **CCCCC: Poison Defense** | Sanitize + hybrid retriever |
| Agent bị điều khiển | **DDDDD: Canary** | Tool giả + marker + fingerprint |
| Ai thật sự đóng góp | **EEEEE: Credit** | Attribution + counterfactual |
| User thật khó đoán | **FFFFF: Sim User** | LLM đóng user, đa lượt |
| Fail muộn đốt token | **GGGGG: Process Reward** | Chấm từng bước, dừng sớm |
| Agent chọn sai tool | **HHHHH: Desc Eng** | Mô tả chuẩn + self-optimize |
| User phải sửa hoài | **IIIII: Corrections** | Preference từ chỉnh sửa |
| Tool dùng đúng không | **JJJJJ: Tool Bench** | Selection/schema/distractor |
| Code lệch yêu cầu | **KKKKK: Spec-Driven** | Spec = contract, verify |
| Code chất lượng thấp | **LLLLL: Pair Agents** | Navigator + Driver |
| Test vô nghĩa/fake | **MMMMM: Spec→Test→Code** | Test từ spec, RED gate |
| Code lỗi kiểu/lint | **NNNNN: Toolchain** | tsc/eslint sau mỗi edit |
| Fail rải rác khó thấy gốc | **OOOOO: Error Analysis** | Pool + cluster + taxonomy |
| Tự sửa rồi tệ hơn | **PPPPP: Bounded Correct** | Vòng giới hạn + fail-loud |
| Output agent khó truy vết | **QQQQQ: Artifacts** | Catalog + MAV version |
| Context dài bị quên giữa | **RRRRR: Long-Context** | Offload/Sum/Chain-of-Agents |
| Chạy lại ra khác nhau | **SSSSS: Reproducible** | Manifest pin stack + variance |
| User không hiểu vì sao | **TTTTT: Explainable** | Rationale/evidence per action |
| Quyền tool cứng nhắc | **UUUUU: Dynamic Perms** | Policy theo ngữ cảnh + narrow |
| Thinking ẩn khó kiểm | **VVVVV: Reasoning** | Schema + validate + đo (GGGGG) |
| User đính ảnh/ghi âm | **WWWWW: Multi-Modal** | Preprocess (OCR/STT) + MLLM khi cần |
| Cost theo user/dự án | **XXXXX: FinOps** | Meter→quota→route→degrade |
| Muốn dashboard chuẩn | **YYYYY: OTel** | gen_ai.* spans + OTLP exporter |
| Đổi config sợ hồi quy | **ZZZZZ: Shadow** | Chạy song song + promote có gate |
| So config/model khó chọn | **AAAAAA: Arena** | Match Elo blind A/B (judge) |
| Agent hỏng im lặng | **BBBBBB: Watchdog** | Probe định kỳ + tự can thiệp |
| Hành động không thể đảo | **CCCCCC: HITL** | Duyệt trước khi thực thi |
| Code LLM sinh nguy hiểm | **DDDDDD: Sandbox** | MicroVM/container + default-deny |
| Quyết định quan trọng | **EEEEEE: Consensus** | Vote theo giao thức + confidence |
| Prompt đổi sợ lỗi | **FFFFFF: Versioning** | Env tags + rollback bằng config |
| Lỗi agent tái không lại | **GGGGGG: TTD** | Flight recorder + rewind + replay |
| Dữ liệu không rời máy | **HHHHHH: Edge** | Local-first + offline + sovereignty |
| Skill/tool lạ không tin | **IIIIII: Supply Chain** | Ký số + verify + provenance |
| Đổi máy mất session | **JJJJJJ: Cross-Device** | State tách transport + presence |
| Agent hợp ý người dùng | **KKKKKK: Personalize** | Preference store + AdaPA strength |
| Dữ liệu user lộ chéo | **LLLLLL: Tenancy** | Tenant scope + RLS DB-level |
| Không muốn viết lại skill | **MMMMMM: Marketplace** | Tìm/cài skill chuẩn mở + verify |
| Giảm khí thải AI | **NNNNNN: Carbon** | Route theo carbon intensity + defer |
| Hàng trăm agents rối | **OOOOOO: Fleet** | Provision/scale/canary batch |
| Model nhiều khó quản | **PPPPPP: Registry** | Catalog model + lifecycle + gate |
| User nói nhiều tiếng | **QQQQQQ: Multilingual** | i18n prompt + glossary + locale |
| Agent không tiến bộ | **RRRRRR: Flywheel** | Production → curate → eval → improve |
| Việc lặp mỗi ngày | **SSSSSS: Scheduled** | Cron + state lần trước + diff/notify |
| Agent làm thay user | **TTTTTT: Delegation** | Identity riêng + on-behalf-of + chain |
| Tool không API/CLI | **UUUUUU: Computer-Use** | Screenshot → action trong VM |
| Task tốn lặp lại | **VVVVVV: Distill** | Model lớn dạy model nhỏ |
| Nhiều tools rối | **WWWWWW: Intent Router** | Phân lớp ý định + depth |
| Agent mới "nháo" | **XXXXXX: Onboarding** | Tri thức + trust + smoke eval |
| KB/API đổi, agent cũ | **YYYYYY: Non-Stationary** | Drift detector + refresh + re-verify |
| User đòi xóa dữ liệu | **ZZZZZZ: RTBF** | Erasure pipeline + anonymize + test |
| Agent trả phí cho nhau | **AAAAAAA: Commerce** | Pricing outcome + ledger + billing |
| Agent yếu không thấy | **BBBBBBB: Scorecard** | KPI đa chiều + baseline + trend |
| Dữ liệu real-time | **CCCCCCC: Pipeline** | Agent trong stream + self-heal |
| Nhiều tiêu chí xung đột | **DDDDDDD: MCDM** | TOPSIS + trọng số + giải thích |
| Agent ích kỷ phá phối hợp | **EEEEEEE: Mechanism** | Incentive design + Nash check |
| Dev agent "mù" | **FFFFFFFF: Agent IDE** | Live view + steer + tune |
| Năng lực bị khóa trong mya | **GGGGGGG: MCP-First** | Agent-as-MCP-server, agent khác gọi |
| Agent làm trùng việc | **HHHHHHH: Conflict Detect** | Claim + so sánh + resolve (CBS) |
| Workflow "mơ hồ" | **IIIIIII: Workflow-as-Code** | Graph DAG + durable resume |
| Nhớ không phân tầng | **JJJJJJJ: Hierarchical Mem** | Working/episodic/semantic/procedural |
| Cost LLM cao | **KKKKKKK: Prompt Cache** | KV/semantic cache −41-80% |
| Task nào tốn bao nhiêu | **LLLLLLL: Cost Attribution** | Task ID + budget per task |
| Agent tự động gây hại | **MMMMMMM: Guardrails** | Chặn + chẩn đoán root cause |
| Agent chết khi lỗi | **NNNNNNN: Self-Healing** | Phân loại lỗi + phục hồi nhanh |
| Context phình, token cao | **OOOOOOO: Context Budget** | Budget + trim + nén semantic |
| Agent học task quá khó | **PPPPPPP: Curriculum** | Tăng độ khó theo năng lực |
| Team agent chưa định hình | **QQQQQQQ: Team Config** | Supervisor + collaborator profile |
| Đổi prompt phá chất lượng | **RRRRRRR: Prompt A/B** | Registry + regression + canary |
| Agent chết giữa chừng | **SSSSSSS: Fault Tolerance** | Replica + failover + SLO |
| LLM trả JSON rác | **TTTTTTT: Output Validate** | Ép grammar + Zod validate |
| Không biết agent nào làm gì | **UUUUUUU: Agent Registry** | Phone book + discover + select |
| Agent đọc bừa dữ liệu | **VVVVVVV: Data Governance** | FGAC + DB-level enforce |
| LLM đắt mà không cần | **WWWWWWW: Model Routing** | Cascade + adaptive −40-85% |
| Deploy agent chưa test | **XXXXXXX: Test Sandbox** | Sandbox + simulation + release gate |
| Agent không có danh tính | **YYYYYYY: Agent OAuth** | OAuth 2.1/OIDC + token exchange |
| Tool gọi lộn xộn | **ZZZZZZZ: Tool Graph** | Subset + dependency + parallel |
| Chat dài phình token | **AAAAAAAA: Chat Memory** | Recent + summary layered |
| Nhiều agent không trung tâm | **BBBBBBBB: Swarm** | Luật local + emergence |
| Sở thích user chưa khớp | **CCCCCCCC: RLHF** | Reward model + DPO/PPO |
| Task khó cần thử nhiều hướng | **DDDDDDDD: Tree Search** | Mô phỏng nhánh + rollback |
| 1 LLM trả lời thiếu chính xác | **EEEEEEEE: Ensemble** | N mẫu + aggregate/debate |
| RAG đơn bước không đủ | **FFFFFFFF: Agentic RAG** | Plan retrieval + multi-hop |
| Agent thừa quyền tool | **GGGGGGGG: Least Priv.** | Scope động + JIT theo task |
| Agent khác hệ không nói chuyện | **HHHHHHHH: Interop** | MCP + A2A + ACP |
| Test thiếu edge case | **IIIIIIII: PBT** | Property + fuzz + shrink |
| Call lặp vẫn tốn token | **JJJJJJJJ: KV+Sem Cache** | 2 tầng cache LLM |
| Không biết agent lời/lỗ | **KKKKKKKK: Token Econ** | Cost model + pricing + forecast |
| Tenant rò dữ liệu nhau | **LLLLLLLL: Tenant Isol.** | Container + cache per tenant |
| RAG trả lời "bịa" | **MMMMMMMM: RAG Eval** | Faithfulness + relevancy |
| Agent trôi tính cách | **NNNNNNNN: Persona** | Persona profile + consistency |
| Agent đốt budget | **OOOOOOOO: Rate Limit** | Token bucket + quota + queue |
| Retrieval thiếu sót | **PPPPPPPP: Hybrid Search** | BM25 + vector + rerank |
| Không tái dựng được quyết định | **QQQQQQQQ: Audit Trail** | Immutable + decision trace |
| Agent giao việc vô quyền | **RRRRRRRR: Delegation** | Contract + chain + revoke |
| Data độc lừa agent | **SSSSSSSS: Inject Defense** | Sanitize + tách data + allowlist |
| Agent trao đổi lột xác | **UUUUUUUU: Comm** | Message bus + event-driven |
| Agent loopy hết $ | **VVVVVVVV: Loop Guard** | Circuit breaker + checkpoint |
| Output không đúng JSON | **WWWWWWWW: Constrain** | Mask token theo grammar/schema |
| Suy luận 1 lần dễ sai | **XXXXXXXX: Self-Consis.** | N-sample + vote đa số |
| 5-shot tĩnh lệch query | **YYYYYYYY: Few-Shot** | Retrieval ví dụ động |
| Sinh chậm từng token | **ZZZZZZZZ: Spec Decode** | Draft + verify song song |
| N tool call chậm tuần tự | **AAAAAAAA: Par-Tool** | Gom call độc lập — chạy song song |
| Query ngắn miss retrieval | **BBBBBBBB: Rewrite** | LLM viết lại trước khi tìm |
| Doc dài index phẳng miss | **CCCCCCCC: Chunking** | Parent-child 2 cấp |
| Model nặng không fit local | **DDDDDDDD: Quantize** | GGUF/INT4 nén trọng số |
| Embedding chọn mò | **EEEEEEEE: Embed Eval** | Gold set + recall@K/NDCG |
| Index stale khi doc đổi | **FFFFFFFF: Index Maint** | Incremental + reindex nền |
| PII lọt vào LLM | **GGGGGGGG: PII Redact** | Detector + placeholder + sweep |
| LLM treo vô hạn | **HHHHHHHH: Deadline** | Budget thời gian + partial |
| Cần giao diện tiếng nói | **IIIIIIII: Voice** | VAD + STT + LLM + TTS |
| Web không có API | **JJJJJJJJ: Web Agent** | Playwright điều khiển DOM |
| Tool trả quá nhiều token | **KKKKKKKK: Compress** | Nén output trước khi inject |
| Câu không nguồn | **LLLLLLLL: Grounding** | Verify claim + citation |
| Cần sinh ảnh/video | **MMMMMMMM: Media Out** | Gen model + validate + lưu |
| Đổi agent rủi cao | **NNNNNNNN: Flags** | Rollout % + rollback tức |
| Nhiều request tốn tiền | **OOOOOOOO: Batch** | Gom window — 1 forward |
| Cần info mới ngoài RAG | **PPPPPPPP: Web Search** | SERP API + citation |
| Model nhớ fact sai | **QQQQQQQQ: K-Edit** | ROME/MEMIT sửa trọng số |
| Prompt lẫn thứ bậc | **RRRRRRRR: Hierarch** | System > user > injected |
| Agent tự submit/pay | **SSSSSSSS: Approval** | Gate duyệt trước critical |
| User không thấy kết quả | **TTTTTTTT: Notify** | Push Slack/email/SMS |
| Output không đúng JSON | **WWWWWWWW: Constrain** | Mask token theo grammar/schema |
| Suy luận run một lần sai | **XXXXXXXX: Self-Consis.** | N-sample + vote đa số |
| 5-shot tĩnh lệch query | **YYYYYYYY: Few-Shot** | Retrieval ví dụ động theo câu hỏi |
| Cẩm nang cấm kỵ | **VV: Anti-Patterns** | Checklist khi review kiến trúc |
