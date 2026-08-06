# mya Agent Architecture Patterns — 227 Hướng Liến Trúc

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
| [09-pi-rpc-bridge.md](09-pi-rpc-bridge.md) | I: pi RPC Bridge | 🟢 Protocol | ✅ pi đã có 33 cmds |
| [10-kanban-board.md](10-kanban-board.md) | J: Kanban Task Queue | 🟢 SQLite | ✅ kanban-sqlite |
| [11-git-as-ipc.md](11-git-as-ipc.md) | K: Git-as-IPC | 🟢 Git | Natural fit |
| [12-event-stream.md](12-event-stream.md) | L: Event-Sourced Ledger | 🟢 Log | ✅ AuditLog |
| [13-message-broker.md](13-message-broker.md) | M: Message Broker | 🟢 Redis | Anticipated |

### Nhóm 3: mya = Brain / Platform

| File | Hướng | Vị trí mya |
|---|---|---|
| [14-reverse-agent.md](14-reverse-agent.md) | N: Reverse Agent (agents = tools) | mya IS the agent |
| [15-agent-os.md](15-agent-os.md) | O: Agent OS (agents = apps) | Platform |
| [16-policy-engine.md](16-policy-engine.md) | P: Policy Engine (guard rails) | YES/NO gate |
| [17-transpiler.md](17-transpiler.md) | Q: Transpiler (format translator) | Dịch giữa formats |
| [18-connection-pool.md](18-connection-pool.md) | R: Connection Pool (warm sessions) | Session manager |

### Nhóm 4: Biology-Inspired

| File | Hướng | Nguồn gốc |
|---|---|---|
| [19-stigmergy.md](19-stigmergy.md) | S: Stigmergic Coordination | Entomology (Grassé, 1959) |
| [20-immune-system.md](20-immune-system.md) | T: Immune System Defense | Biology (Forrest, 1994) |

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
| [28-chemical-reaction.md](28-chemical-reaction.md) | AB: Chemical Reaction Network | Gamma calculus (1986) |

### Nhóm 8: Infrastructure & ML-Inspired (NEW)

| File | Hướng | Nguồn gốc |
|---|---|---|
| [29-declarative-reconcile.md](29-declarative-reconcile.md) | AC: Declarative Reconcile | Kubernetes (2014) |
| [30-behavior-tree.md](30-behavior-tree.md) | AD: Behavior Tree | Game AI (Halo 2, 2005) |
| [31-saga-pattern.md](31-saga-pattern.md) | AE: Saga Pattern | Distributed transactions (1987) |
| [32-supervisor-tree.md](32-supervisor-tree.md) | AF: Supervisor Tree | Erlang OTP (1986) |
| [33-sidecar.md](33-sidecar.md) | AG: Sidecar | K8s service mesh (Envoy) |
| [34-cqrs.md](34-cqrs.md) | AH: CQRS | Fowler, 2010 |
| [35-gan-adversarial.md](35-gan-adversarial.md) | AI: GAN-Style Adversarial | Goodfellow, 2014 |
| [36-mapreduce.md](36-mapreduce.md) | AJ: MapReduce | Google, 2004 |

### Nhóm 9: Agent Memory, Quality & Resilience (MỚI BỔ SUNG)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [37-blackboard.md](37-blackboard.md) | AK: Blackboard | 🟡 Shared state | ⚠️ (1 phần) | 1-2 tuần |
| [38-memory-management.md](38-memory-management.md) | AL: Memory Mgmt (3 tầng) | 🟢 | ✅ packages/memory+prompts | 0 (đã có) |
| [39-cache-layer.md](39-cache-layer.md) | AM: Cache Layer | 🟢 | ⚠️ (thiếu tool-result cache) | 1 tuần |
| [40-tool-registry.md](40-tool-registry.md) | AN: Tool Registry + Perms | 🟡 Public API | ✅ ToolRegistry+roles | 1 tuần |
| [41-eval-harness.md](41-eval-harness.md) | AO: Eval Harness | 🟢 | ✅ packages/eval | 0 (đã có) |
| [42-circuit-breaker.md](42-circuit-breaker.md) | AP: Circuit Breaker | 🟢 | ⚠️ (backoff rải rác) | 1 tuần |

### Nhóm 10: Routing, Control & Cognitive (MỚI BỔ SUNG — MCP research)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [43-routing.md](43-routing.md) | AQ: Routing / Mode-Selector | 🟢 | ⚠️ (roles+registry sẵn) | 3-5 ngày |
| [44-cost-budget.md](44-cost-budget.md) | AR: Cost & Step Budget Gating | 🟢 | ⚠️ (RateLimiter sẵn) | 1 tuần |
| [45-wait-event-checkpoint.md](45-wait-event-checkpoint.md) | AS: Durable Wait-for-Event / Checkpoint | 🟢 | ⚠️ (session JSONL sẵn) | 1-2 tuần |
| [46-escalation-tree.md](46-escalation-tree.md) | AT: Escalation Tree | 🟢 | ❌ build mới | 1 tuần |
| [47-anti-patterns.md](47-anti-patterns.md) | AU: Anti-Patterns Catalog | — | — (tài liệu) | 3-5 ngày |
| [48-bdi.md](48-bdi.md) | AV: BDI + 3-Stage Commitment | 🟡 | ⚠️ (brain+kanban sẵn) | 1-2 tuần |
| [49-impasse-subgoal.md](49-impasse-subgoal.md) | AW: Impasse-Subgoal | 🟢 | ⚠️ (subagent-spawn sẵn) | 1 tuần |
| [50-knowledge-compilation.md](50-knowledge-compilation.md) | AX: Knowledge Compilation | 🟢 | ⚠️ (skills sẵn) | 1-2 tuần |
| [51-pressure-field.md](51-pressure-field.md) | AY: Pressure-Field Coord | 🟢 | ❌ build mới | 2-3 tuần |
| [52-gossip.md](52-gossip.md) | AZ: Gossip / Epidemic | 🟢 | ⚠️ (intercom sẵn) | 2 tuần |
| [53-a2a-capability.md](53-a2a-capability.md) | BA: A2A Opaque Protocol | 🟢 Protocol | ⚠️ (intercom+rpc sẵn) | 2 tuần |
| [54-handoff.md](54-handoff.md) | BB: Explicit Handoff | 🟢 | ⚠️ (intercom sẵn) | 3-5 ngày |

### Nhóm 11: Model-Level & Retrieval (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [55-mixture-of-agents.md](55-mixture-of-agents.md) | BC: Mixture of Agents | 🟢 | ⚠️ (registry+tier sẵn) | 2 tuần |
| [56-reflexion.md](56-reflexion.md) | BD: Reflexion | 🟢 | ⚠️ (eval+memory sẵn) | 1 tuần |
| [57-plan-execute.md](57-plan-execute.md) | BE: Plan-and-Execute | 🟢 | ⚠️ (kanban+spawn sẵn) | 1-2 tuần |
| [58-agentic-rag.md](58-agentic-rag.md) | BF: Agentic RAG | 🟢 | ❌ (cần index mới) | 2-3 tuần |
| [59-model-cascade.md](59-model-cascade.md) | BG: Model Cascade | 🟢 | ⚠️ (tier+fallback sẵn) | 1 tuần |

### Nhóm 12: Interface, Observability & Security (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [60-aci.md](60-aci.md) | BH: Agent-Computer Interface | 🟢 | ⚠️ (ToolResult sẵn) | 1-2 tuần |
| [61-agent-observability.md](61-agent-observability.md) | BI: Agent Observability | 🟢 | ⚠️ (AuditLog sẵn) | 1-2 tuần |
| [62-credential-broker.md](62-credential-broker.md) | BJ: Credential Broker | 🟢 | ⚠️ (key-rotation+oauth sẵn) | 1 tuần |

### Nhóm 13: Planning Formal, Hạ tầng MCP & Tool Generation (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [63-htn.md](63-htn.md) | BK: HTN Planning | 🟢 | ⚠️ (kanban sẵn) | 2-3 tuần |
| [64-mcp-gateway.md](64-mcp-gateway.md) | BL: MCP Gateway | 🟢 Protocol | ⚠️ (mcp-client+oauth sẵn) | 1-2 tuần |
| [65-tool-maker.md](65-tool-maker.md) | BM: Tool Maker | 🟢 | ⚠️ (registry+eval sẵn) | 1-2 tuần |

### Nhóm 14: Reliability Testing, Deployment & Priority Layers (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [66-chaos-engineering.md](66-chaos-engineering.md) | BN: Agent Chaos Eng | 🟢 | ⚠️ (eval sẵn) | 1-2 tuần |
| [67-serverless-agents.md](67-serverless-agents.md) | BO: Serverless Agents | 🟢 | ⚠️ (cron+sweep sẵn) | 1-2 tuần |
| [68-subsumption.md](68-subsumption.md) | BP: Subsumption Arch | 🟢 | ⚠️ (AN/AR/AO sẵn) | 1-2 tuần |

### Nhóm 15: Security Gateway, Model Gateway & Evolution (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [69-agentic-firewall.md](69-agentic-firewall.md) | BQ: Agentic Firewall | 🟢 | ⚠️ (audit+secrets sẵn) | 1-2 tuần |
| [70-llm-gateway.md](70-llm-gateway.md) | BR: LLM Gateway | 🟢 | ⚠️ (registry+fallback sẵn) | 1 tuần |
| [71-evoprompt.md](71-evoprompt.md) | BS: EvoPrompt | 🟢 | ⚠️ (eval+prompts sẵn) | 1-2 tuần |

### Nhóm 16: Security Testing, Durability & Graph Orchestration (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [72-llm-red-teaming.md](72-llm-red-teaming.md) | BT: LLM Red Teaming | 🟢 | ⚠️ (eval+audit sẵn) | 1-2 tuần |
| [73-durable-execution.md](73-durable-execution.md) | BU: Durable Execution | 🟢 | ⚠️ (workflows runner sẵn) | 2-3 tuần |
| [74-stateful-graph.md](74-stateful-graph.md) | BV: Stateful Graph | 🟢 | ⚠️ (runner+session sẵn) | 2 tuần |

### Nhóm 17: Search & Formal Planning (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [75-lats-tree-search.md](75-lats-tree-search.md) | BW: LATS Tree Search | 🟢 | ❌ build mới | 2-3 tuần |
| [76-pddl-planning.md](76-pddl-planning.md) | BX: PDDL Planning | 🟢 Protocol | ❌ build mới | 2-3 tuần |
| [77-dspy-compilation.md](77-dspy-compilation.md) | BY: DSPy Compilation | 🟢 | ⚠️ (prompts+eval sẵn) | 2 tuần |

### Nhóm 18: Negotiation, Swarm & Context (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [78-agent-negotiation.md](78-agent-negotiation.md) | BZ: Agent Negotiation | 🟡 | ⚠️ (intercom sẵn) | 2 tuần |
| [79-swarm-optimization.md](79-swarm-optimization.md) | CA: Swarm Optimization | 🟢 | ⚠️ (eval sẵn) | 1-2 tuần |
| [80-context-engineering.md](80-context-engineering.md) | CB: Context Engineering | 🟢 | ⚠️ (memory+prompts sẵn) | 2 tuần |

### Nhóm 19: Compute Allocation, Memory & Tool Ecosystem (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [81-test-time-compute.md](81-test-time-compute.md) | CC: Test-Time Compute | 🟢 | ⚠️ (AR+eval sẵn) | 1-2 tuần |
| [82-memory-consolidation.md](82-memory-consolidation.md) | CD: Memory Consolidation | 🟢 | ⚠️ (memory+cron sẵn) | 1-2 tuần |
| [83-tool-discovery.md](83-tool-discovery.md) | CE: Tool Discovery | 🟢 Protocol | ⚠️ (mcp-client sẵn) | 1-2 tuần |

### Nhóm 20: Judging, Spec & Topology (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [84-llm-as-judge.md](84-llm-as-judge.md) | CF: LLM-as-Judge | 🟢 | ⚠️ (eval sẵn) | 1 tuần |
| [85-agent-spec.md](85-agent-spec.md) | CG: Agent Spec | 🟢 | ⚠️ (roles/skills sẵn) | 1-2 tuần |
| [86-agent-topology.md](86-agent-topology.md) | CH: Agent Topology | 🟢 | ⚠️ (intercom sẵn) | 1 tuần |

### Nhóm 21: Trusted Compute & Memory 2 (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [87-tee-confidential.md](87-tee-confidential.md) | CI: TEE/Confidential | 🟢 | ❌ (hạ tầng mới) | 3-4 tuần |
| [88-hybrid-graph-vector-memory.md](88-hybrid-graph-vector-memory.md) | CJ: Hybrid Graph+Vector Memory | 🟡 | ⚠️ (memory sẵn) | 2-3 tuần |
| [89-shared-graph-memory.md](89-shared-graph-memory.md) | CK: Shared Graph Memory | 🟡 | ⚠️ (memory sẵn) | 2-3 tuần |

### Nhóm 22: Cost & Eval Data (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [90-prompt-caching.md](90-prompt-caching.md) | CL: Prompt Caching | 🟢 | ⚠️ (ai sẵn) | 1 tuần |
| [91-synthetic-eval-data.md](91-synthetic-eval-data.md) | CM: Synthetic Eval Data | 🟢 | ⚠️ (eval sẵn) | 1-2 tuần |
| [92-semantic-caching.md](92-semantic-caching.md) | CN: Semantic Caching | 🟡 | ⚠️ (ai sẵn) | 1-2 tuần |

### Nhóm 23: Routing & Resilience 2 (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [93-hybrid-local-cloud.md](93-hybrid-local-cloud.md) | CO: Hybrid Local-Cloud | 🟢 | ⚠️ (router sẵn) | 2 tuần |
| [94-trajectory-replay.md](94-trajectory-replay.md) | CP: Trajectory Replay | 🟢 | ⚠️ (eval sẵn) | 1-2 tuần |
| [95-tool-call-recovery.md](95-tool-call-recovery.md) | CQ: Tool-Call Recovery | 🟡 | ⚠️ (reliability sẵn) | 1-2 tuần |

### Nhóm 24: Agent Testing (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [96-agent-ci-cd.md](96-agent-ci-cd.md) | CR: Agent CI/CD | 🟢 | ⚠️ (eval sẵn) | 1 tuần |
| [97-tool-schema-drift.md](97-tool-schema-drift.md) | CS: Tool Schema Drift | 🟢 | ⚠️ (mcp sẵn) | 1-2 tuần |
| [98-tool-mocking.md](98-tool-mocking.md) | CT: Tool Mocking | 🟢 | ⚠️ (tools sẵn) | 1 tuần |

### Nhóm 25: Context & Token Optimization (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [99-progressive-disclosure.md](99-progressive-disclosure.md) | CU: Progressive Disclosure | 🟢 | ⚠️ (skills sẵn) | 1-2 tuần |
| [100-prompt-compression.md](100-prompt-compression.md) | CV: Prompt Compression | 🟡 | ⚠️ (ai sẵn) | 1-2 tuần |
| [101-dynamic-tool-selection.md](101-dynamic-tool-selection.md) | CW: Dynamic Tool Selection | 🟡 | ⚠️ (registry sẵn) | 1-2 tuần |

### Nhóm 26: Reliability & Quality 2 (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [102-reward-hacking.md](102-reward-hacking.md) | CX: Reward Hacking | 🟢 | ⚠️ (eval sẵn) | 1-2 tuần |
| [103-agent-drift.md](103-agent-drift.md) | CY: Agent Drift | 🟢 | ⚠️ (eval sẵn) | 1-2 tuần |
| [104-task-decomposition.md](104-task-decomposition.md) | CZ: Task Decomposition | 🟢 | ⚠️ (triage sẵn) | 1 tuần |

### Nhóm 27: Evolution & Defense (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [105-self-improving-agents.md](105-self-improving-agents.md) | DA: Self-Improving | 🟡 | ⚠️ (eval sẵn) | 2-3 tuần |
| [106-rag-poisoning-defense.md](106-rag-poisoning-defense.md) | DB: RAG Poisoning Defense | 🟡 | ⚠️ (RAG sẵn) | 1-2 tuần |
| [107-canary-honeypot.md](107-canary-honeypot.md) | DC: Canary/Honeypot | 🟢 | ⚠️ (tools sẵn) | 1 tuần |

### Nhóm 28: Attribution & Supervision (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [108-credit-assignment.md](108-credit-assignment.md) | DD: Credit Assignment | 🟢 | ⚠️ (trace sẵn) | 1-2 tuần |
| [109-simulated-user-testing.md](109-simulated-user-testing.md) | DE: Simulated User Testing | 🟢 | ⚠️ (eval sẵn) | 1-2 tuần |
| [110-process-reward.md](110-process-reward.md) | DF: Process Reward | 🟢 | ⚠️ (CF sẵn) | 1-2 tuần |

### Nhóm 29: Tool Quality & Personalization (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [111-tool-description-engineering.md](111-tool-description-engineering.md) | DG: Tool Description Eng | 🟢 | ⚠️ (AN sẵn) | 1 tuần |
| [112-learning-from-corrections.md](112-learning-from-corrections.md) | DH: Learning from Corrections | 🟡 | ⚠️ (audit sẵn) | 1-2 tuần |
| [113-tool-call-benchmark.md](113-tool-call-benchmark.md) | DI: Tool-Call Benchmark | 🟢 | ⚠️ (eval sẵn) | 1-2 tuần |

### Nhóm 30: Code-Driven Development (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [114-spec-driven-development.md](114-spec-driven-development.md) | DJ: Spec-Driven Dev | 🟢 | ⚠️ (docs sẵn) | 1-2 tuần |
| [115-pair-programming-agents.md](115-pair-programming-agents.md) | DK: Pair Programming | 🟢 | ⚠️ (subagents sẵn) | 1 tuần |
| [116-spec-test-code-loop.md](116-spec-test-code-loop.md) | DL: Spec→Test→Code | 🟢 | ⚠️ (vitest sẵn) | 1 tuần |

### Nhóm 31: Correction & Analysis (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [117-toolchain-feedback-loop.md](117-toolchain-feedback-loop.md) | DM: Toolchain Feedback | 🟢 | ✅ (lint/tsc sẵn) | 1 tuần |
| [118-error-analysis.md](118-error-analysis.md) | DN: Error Analysis | 🟢 | ⚠️ (trace sẵn) | 1-2 tuần |
| [119-bounded-self-correction.md](119-bounded-self-correction.md) | DO: Bounded Self-Correction | 🟢 | ⚠️ (CQ sẵn) | 1 tuần |

### Nhóm 32: Artifacts & Context (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [120-artifact-management.md](120-artifact-management.md) | DP: Artifact Catalog | 🟢 | ⚠️ (audit sẵn) | 1-2 tuần |
| [121-long-context-management.md](121-long-context-management.md) | DQ: Long-Context Mgmt | 🟡 | ⚠️ (AB/CL sẵn) | 2 tuần |
| [122-agent-reproducibility.md](122-agent-reproducibility.md) | DR: Reproducibility | 🟢 | ⚠️ (trace sẵn) | 1-2 tuần |

### Nhóm 33: Explainability & Access (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [123-explainable-actions.md](123-explainable-actions.md) | DS: Explainable Actions | 🟢 | ⚠️ (audit/trace sẵn) | 1 tuần |
| [124-dynamic-permissions.md](124-dynamic-permissions.md) | DT: Dynamic Permissions | 🟡 | ⚠️ (AN static sẵn) | 2 tuần |
| [125-structured-reasoning.md](125-structured-reasoning.md) | DU: Structured Reasoning | 🟡 | ⚠️ (trace sẵn) | 1 tuần |

### Nhóm 34: Inputs, Cost & Telemetry (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [126-multimodal-inputs.md](126-multimodal-inputs.md) | DV: Multi-Modal Inputs | 🟡 | ⚠️ (inbox sẵn) | 2-3 tuần |
| [127-agentic-finops.md](127-agentic-finops.md) | DW: Agentic FinOps | 🟡 | ⚠️ (AR sẵn) | 2 tuần |
| [128-otel-observability.md](128-otel-observability.md) | DX: OTel Observability | 🟢 | ⚠️ (trace/audit sẵn) | 1-2 tuần |

### Nhóm 35: Ops, Eval & Reliability (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [129-shadow-deployment.md](129-shadow-deployment.md) | DY: Shadow Deployment | 🟡 | ⚠️ (CR+AO sẵn) | 2-3 tuần |
| [130-agent-arena.md](130-agent-arena.md) | DZ: Agent Arena | 🟢 | ⚠️ (AO+DI sẵn) | 1-2 tuần |
| [131-agent-watchdog.md](131-agent-watchdog.md) | EA: Agent Watchdog | 🟢 | ⚠️ (ECS+AU sẵn) | 1-2 tuần |

### Nhóm 36: Governance, Security & Decision (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [132-human-in-the-loop.md](132-human-in-the-loop.md) | EB: Human-in-the-Loop | 🟢 | ⚠️ (AS+AV sẵn) | 1-2 tuần |
| [133-agent-sandbox.md](133-agent-sandbox.md) | EC: Agent Sandbox | 🟡 | ⚠️ (shell+AV sẵn) | 2-4 tuần |
| [134-multi-agent-consensus.md](134-multi-agent-consensus.md) | ED: Multi-Agent Consensus | 🟢 | ⚠️ (BC+AO sẵn) | 1-2 tuần |

### Nhóm 37: Deployment & Debug (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [135-agent-versioning.md](135-agent-versioning.md) | EE: Agent Versioning | 🟢 | ⚠️ (CP+AO sẵn) | 1-2 tuần |
| [136-time-travel-debugging.md](136-time-travel-debugging.md) | EF: Time-Travel Debug | 🟢 | ⚠️ (CR+AU sẵn) | 2-3 tuần |
| [137-edge-on-device-agents.md](137-edge-on-device-agents.md) | EG: Edge/On-Device | 🟡 | ⚠️ (CO+BG sẵn) | 2-4 tuần |

### Nhóm 38: Supply Chain, Sessions & Personalization (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [138-agent-supply-chain.md](138-agent-supply-chain.md) | EH: Agent Supply Chain | 🟢 | ⚠️ (signing+BA) | 1-2 tuần |
| [139-cross-device-sessions.md](139-cross-device-sessions.md) | EI: Cross-Device Sessions | 🟡 | ⚠️ (durable+AS) | 2-3 tuần |
| [140-agent-personalization.md](140-agent-personalization.md) | EJ: Personalization | 🟢 | ⚠️ (AL+DH) | 1-2 tuần |

### Nhóm 39: Tenancy, Ecosystem & Sustainability (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [141-multi-tenancy.md](141-multi-tenancy.md) | EK: Multi-Tenancy | 🟡 | ⚠️ (finops+CT) | 2-3 tuần |
| [142-skill-marketplace.md](142-skill-marketplace.md) | EL: Skill Marketplace | 🟢 | ⚠️ (skills+BM) | 1-2 tuần |
| [143-carbon-aware-computing.md](143-carbon-aware-computing.md) | EM: Carbon-Aware | 🟢 | ⚠️ (CO+BG) | 1-2 tuần |

### Nhóm 40: Fleet, Models & Languages (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [144-agent-fleet-management.md](144-agent-fleet-management.md) | EN: Fleet Management | 🟡 | ⚠️ (AF+EA) | 2-4 tuần |
| [145-model-registry.md](145-model-registry.md) | EO: Model Registry | 🟢 | ⚠️ (AF+BG) | 1-2 tuần |
| [146-multilingual-agents.md](146-multilingual-agents.md) | EP: Multilingual | 🟢 | ⚠️ (prompts+AF) | 1-2 tuần |

### Nhóm 41: Continuous Improvement, Scheduling & Identity (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [147-data-flywheel.md](147-data-flywheel.md) | EQ: Data Flywheel | 🟢 | ⚠️ (AO+CR) | 2-3 tuần |
| [148-scheduled-agents.md](148-scheduled-agents.md) | ER: Scheduled Agents | 🟢 | ⚠️ (cron+durable) | 1 tuần |
| [149-delegated-agent-identity.md](149-delegated-agent-identity.md) | ES: Delegated Identity | 🟡 | ⚠️ (CJ+CT) | 2-3 tuần |

### Nhóm 42: GUI, Models & Understanding (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [150-computer-use-agents.md](150-computer-use-agents.md) | ET: Computer-Use | 🟢 | ⚠️ (sandbox+HITL) | 2-4 tuần |
| [151-model-distillation.md](151-model-distillation.md) | EU: Distillation | 🟢 | ⚠️ (flywheel+AO) | 2-4 tuần |
| [152-intent-router.md](152-intent-router.md) | EV: Intent Router | 🟢 | ⚠️ (AQ+BM) | 1-2 tuần |

### Nhóm 43: Lifecycle, Adaptation & Privacy (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [153-agent-onboarding.md](153-agent-onboarding.md) | EW: Agent Onboarding | 🟢 | ⚠️ (BZ+BM) | 1 tuần |
| [154-non-stationary-adaptation.md](154-non-stationary-adaptation.md) | EX: Non-Stationary | 🟢 | ⚠️ (drift+BF) | 2-3 tuần |
| [155-right-to-be-forgotten.md](155-right-to-be-forgotten.md) | EY: RTBF (GDPR) | 🟡 | ⚠️ (AU+AL) | 2-3 tuần |

### Nhóm 44: Commerce, Scorecards & Data Pipelines (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [156-agent-commerce.md](156-agent-commerce.md) | EZ: Agent Commerce | 🟢 | ⚠️ (finops+market) | 2-3 tuần |
| [157-agent-scorecard.md](157-agent-scorecard.md) | FA: Scorecard | 🟢 | ⚠️ (AO+CX) | 1 tuần |
| [158-agentic-pipeline.md](158-agentic-pipeline.md) | FB: Data Pipeline | 🟡 | ⚠️ (stream+AS) | 2-3 tuần |

### Nhóm 45: Decisions, Economics & DevTools (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [159-multi-criteria-decision.md](159-multi-criteria-decision.md) | FC: Multi-Criteria | 🟢 | ⚠️ (finops+CS) | 1 tuần |
| [160-mechanism-design.md](160-mechanism-design.md) | FD: Mechanism Design | 🟢 | ⚠️ (market+credit) | 2-4 tuần |
| [161-agent-ide.md](161-agent-ide.md) | FE: Agent IDE | 🟢 | ⚠️ (TTD+CP) | 2-4 tuần |

### Nhóm 46: Protocols, Coordination & Workflows (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [162-mcp-first-architecture.md](162-mcp-first-architecture.md) | FF: MCP-First | 🟡 | ⚠️ (gateway+registry) | 2-3 tuần |
| [163-conflict-detection.md](163-conflict-detection.md) | FG: Conflict Detect | 🟡 | ⚠️ (AK+lock) | 2-4 tuần |
| [164-agentic-workflows-as-code.md](164-agentic-workflows-as-code.md) | FH: Workflow-as-Code | 🟡 | ⚠️ (B+pipeline) | 2-4 tuần |

### Nhóm 47: Memory, Caching & Cost (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [165-hierarchical-memory.md](165-hierarchical-memory.md) | FI: Hierarchical Mem | 🟡 | ⚠️ (V+R+M) | 3-5 tuần |
| [166-prompt-caching-layer.md](166-prompt-caching-layer.md) | FJ: Prompt Cache | 🟢 | ⚠️ (Redis+BA) | 1-2 tuần |
| [167-per-task-cost-attribution.md](167-per-task-cost-attribution.md) | FK: Cost Attribution | 🟡 | ⚠️ (finops+budget) | 1-2 tuần |

### Nhóm 48: Safety, Recovery & Context (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [168-agent-guardrails-layer.md](168-agent-guardrails-layer.md) | FL: Guardrails | 🟡 | ⚠️ (AV+perms) | 2-4 tuần |
| [169-self-healing-agents.md](169-self-healing-agents.md) | FM: Self-Healing | 🟡 | ⚠️ (retry+breaker) | 2-4 tuần |
| [170-context-engineering.md](170-context-engineering.md) | FN: Context/Budget | 🟡 | ⚠️ (summarizer+RAG) | 2-4 tuần |

### Nhóm 49: Training, Teams & Prompts (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [171-curriculum-learning.md](171-curriculum-learning.md) | FO: Curriculum | 🟡 | ⚠️ (AO+onboarding) | 2-3 tuần |
| [172-multi-agent-collaboration-config.md](172-multi-agent-collaboration-config.md) | FP: Team Config | 🟡 | ⚠️ (subagent+registry) | 1-3 tuần |
| [173-prompt-versioning-ab-testing.md](173-prompt-versioning-ab-testing.md) | FQ: Prompt A/B | 🟢 | ⚠️ (CE+AO) | 1-2 tuần |

### Nhóm 50: Reliability, Outputs & Discovery (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [174-fault-tolerance-failover.md](174-fault-tolerance-failover.md) | FR: Fault Tolerance | 🟡 | ⚠️ (self-heal+health) | 3-5 tuần |
| [175-structured-output-validation.md](175-structured-output-validation.md) | FS: Output Validate | 🟢 | ⚠️ (schema+zod) | 1-2 tuần |
| [176-agent-registry-discovery.md](176-agent-registry-discovery.md) | FT: Agent Registry | 🟡 | ⚠️ (BM+BF) | 1-2 tuần |

### Nhóm 51: Data Governance, Models & CI/CD (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [177-data-access-governance.md](177-data-access-governance.md) | FU: Data Governance | 🟡 | ⚠️ (perms+audit) | 2-4 tuần |
| [178-dynamic-model-routing.md](178-dynamic-model-routing.md) | FV: Model Routing | 🟡 | ⚠️ (multi-model+BF) | 2-4 tuần |
| [179-agent-testing-sandbox.md](179-agent-testing-sandbox.md) | FW: Test Sandbox | 🟢 | ⚠️ (AO+smoke) | 2-4 tuần |

### Nhóm 52: Identity, Tools & Conversations (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [180-agent-identity-oauth.md](180-agent-identity-oauth.md) | FX: Agent OAuth | 🟡 | ⚠️ (ES+broker) | 2-4 tuần |
| [181-tool-orchestration-graph.md](181-tool-orchestration-graph.md) | FY: Tool Graph | 🟡 | ⚠️ (pipeline+EV) | 2-3 tuần |
| [182-conversational-memory.md](182-conversational-memory.md) | FZ: Chat Memory | 🟢 | ⚠️ (history+J) | 1-2 tuần |

### Nhóm 53: Swarms, Alignment & Planning (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [183-swarm-intelligence.md](183-swarm-intelligence.md) | GA: Swarm | 🟡 | ⚠️ (AK+market) | 3-5 tuần |
| [184-rlhf-preference-alignment.md](184-rlhf-preference-alignment.md) | GB: RLHF | 🔴 | ❌ (ngoài lõi) | 3-6 tuần |
| [185-lookahead-tree-search.md](185-lookahead-tree-search.md) | GC: Tree Search | 🟡 | ⚠️ (planner+TTD) | 3-5 tuần |

### Nhóm 54: Reasoning, Retrieval & Security (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [186-multi-agent-debate-ensemble.md](186-multi-agent-debate-ensemble.md) | GD: Ensemble | 🟡 | ⚠️ (multi-model) | 2-4 tuần |
| [187-agentic-rag.md](187-agentic-rag.md) | GE: Agentic RAG | 🟡 | ⚠️ (RAG+tool) | 2-4 tuần |
| [188-least-privilege-scoping.md](188-least-privilege-scoping.md) | GF: Least Priv. | 🟡 | ⚠️ (perms+BM) | 2-3 tuần |

### Nhóm 55: Protocols, Testing & Caching (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [189-interoperability-protocols.md](189-interoperability-protocols.md) | GG: Interop | 🟡 | ⚠️ (MCP+ACP) | 2-4 tuần |
| [190-property-based-testing.md](190-property-based-testing.md) | GH: PBT | 🟢 | ⚠️ (unit+FS) | 1-3 tuần |
| [191-kv-semantic-cache.md](191-kv-semantic-cache.md) | GI: KV+Sem Cache | 🟢 | ⚠️ (prompt cache) | 1-2 tuần |

### Nhóm 56: Economics, Tenancy & RAG (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [192-token-economics.md](192-token-economics.md) | GJ: Token Econ | 🟡 | ⚠️ (finops+billing) | 1-2 tuần |
| [193-multi-tenant-isolation.md](193-multi-tenant-isolation.md) | GK: Tenant Isol. | 🟡 | ⚠️ (141+perms) | 3-6 tuần |
| [194-rag-evaluation-metrics.md](194-rag-evaluation-metrics.md) | GL: RAG Eval | 🟢 | ⚠️ (AO+RAG) | 1-2 tuần |

### Nhóm 57: Persona, Limits & Search (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [195-persona-driven-agents.md](195-persona-driven-agents.md) | GM: Persona | 🟢 | ⚠️ (prompt+FQ) | 1-2 tuần |
| [196-rate-limiting-quotas.md](196-rate-limiting-quotas.md) | GN: Rate Limit | 🟡 | ⚠️ (budget+breaker) | 1-2 tuần |
| [197-hybrid-search-reranking.md](197-hybrid-search-reranking.md) | GO: Hybrid Search | 🟡 | ⚠️ (R+retrieval) | 1-3 tuần |

### Nhóm 58: Audit, Delegation & Security (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [198-audit-trails.md](198-audit-trails.md) | GP: Audit Trail | 🟡 | ⚠️ (AU+CP) | 2-4 tuần |
| [199-delegated-task-authority.md](199-delegated-task-authority.md) | GQ: Delegation | 🟡 | ⚠️ (subagent+OAuth) | 2-4 tuần |
| [200-prompt-injection-defense.md](200-prompt-injection-defense.md) | GR: Inject Defense | 🟡 | ⚠️ (DP+guard) | 2-4 tuần |

### Nhóm 59: Model, Communication & Resilience (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [201-fine-tuning-custom-models.md](201-fine-tuning-custom-models.md) | GS: Fine-Tune Model | 🟢 | ❌ (chưa pipeline) | 4-8 tuần |
| [202-agent-communication-patterns.md](202-agent-communication-patterns.md) | GT: Comm Patterns | 🟡 | ⚠️ (bus nội bộ) | 3-6 tuần |
| [203-failure-detection-retry-loops.md](203-failure-detection-retry-loops.md) | GU: Loop Guard | 🟡 | ⚠️ (max-step + watchdog) | 1-6 tuần |

### Nhóm 60: Generation, Reasoning & Prompting (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [204-constrained-decoding.md](204-constrained-decoding.md) | GV: Constrained Decode | 🟡 | ⚠️ (175 validate) | 2-4 tuần |
| [205-self-consistency-sampling.md](205-self-consistency-sampling.md) | GW: Self-Consistency | 🟢 | ❌ (chưa N-sample) | 1-2 tuần |
| [206-dynamic-few-shot-exemplar.md](206-dynamic-few-shot-exemplar.md) | GX: Few-Shot Dynamic | 🟢 | ✅ (tĩnh — chưa động) | 1-2 tuần |

### Nhóm 61: Latency & Retrieval Quality (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [207-speculative-decoding.md](207-speculative-decoding.md) | GY: Spec Decode | 🟢 | ⚠️ (05 proxy) | 2-4 tuần |
| [208-parallel-tool-calls.md](208-parallel-tool-calls.md) | GZ: Par-Tool | 🔴 | ⚠️ (tuần tự) | 1-3 tuần |
| [209-query-rewriting-expansion.md](209-query-rewriting-expansion.md) | HA: Query Rewrite | 🟢 | ⚠️ (chưa pre-step) | 1-2 tuần |

### Nhóm 62: Indexing & Local Runtime (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [210-chunking-indexing-strategy.md](210-chunking-indexing-strategy.md) | HB: Chunking | 🟡 | ⚠️ (chunk phẳng) | 2-4 tuần |
| [211-model-quantization-local-deployment.md](211-model-quantization-local-deployment.md) | HC: Quantize | 🟢 | ⚠️ (chưa runtime) | 2-4 tuần |
| [212-embedding-model-evaluation.md](212-embedding-model-evaluation.md) | HD: Embed Eval | 🟢 | ⚠️ (default model) | 1-3 tuần |

### Nhóm 63: Data Privacy, Freshness & Time (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [213-vector-index-maintenance.md](213-vector-index-maintenance.md) | HE: Index Maint | 🟡 | ⚠️ (index tĩnh) | 2-4 tuần |
| [214-pii-redaction-anonymization.md](214-pii-redaction-anonymization.md) | HF: PII Redact | 🟡 | ⚠️ (chưa lớp) | 2-4 tuần |
| [215-deadline-bound-execution.md](215-deadline-bound-execution.md) | HG: Deadline | 🟡 | ⚠️ (timeout thô) | 2-4 tuần |

### Nhóm 64: Voice, Browsing & Compression (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [216-voice-agent-pipeline.md](216-voice-agent-pipeline.md) | HH: Voice Agent | 🟡 | ⚠️ (text only) | 4-8 tuần |
| [217-web-browsing-agents.md](217-web-browsing-agents.md) | HI: Web Agent | 🟡 | ⚠️ (fetch đơn) | 3-6 tuần |
| [218-tool-output-compression.md](218-tool-output-compression.md) | HJ: Compress | 🟡 | ⚠️ (truncate cứng) | 2-4 tuần |

### Nhóm 65: Trust, Media & Ops (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [219-answer-grounding-citations.md](219-answer-grounding-citations.md) | HK: Grounding | 🟡 | ⚠️ (chưa verify) | 2-4 tuần |
| [220-multimodal-output-generation.md](220-multimodal-output-generation.md) | HL: Media Out | 🟡 | ⚠️ (text only) | 3-6 tuần |
| [221-feature-flags-rollout.md](221-feature-flags-rollout.md) | HM: Flags/Rollout | 🟢 | ⚠️ (config code) | 2-4 tuần |

### Nhóm 66: Throughput, Grounding & Model (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [222-batch-llm-processing.md](222-batch-llm-processing.md) | HN: Batch | 🟢 | ⚠️ (online call) | 3-6 tuần |
| [223-web-search-grounding-tool.md](223-web-search-grounding-tool.md) | HO: Web Search | 🟢 | ⚠️ (fetch/crawl) | 1-2 tuần |
| [224-knowledge-editing.md](224-knowledge-editing.md) | HP: K-Edit | 🟡 | ❌ (chưa có) | 4-8 tuần |

### Nhóm 67: Safety, Gates & Notify (MỚI BỔ SUNG — web research 2026)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [225-instruction-hierarchy.md](225-instruction-hierarchy.md) | HQ: Hierarch | 🟡 | ⚠️ (cấp cơ bản) | 3-6 tuần |
| [226-human-approval-gates.md](226-human-approval-gates.md) | HR: Approval Gate | 🟡 | ⚠️ (HITL thô) | 2-4 tuần |
| [227-agent-notifications-alerts.md](227-agent-notifications-alerts.md) | HS: Notify | 🟢 | ⚠️ (terminal) | 2-4 tuần |

### Nhóm 68: Distributed & Consensus (Vòng 52)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [228-raft-consensus-cluster.md](228-raft-consensus-cluster.md) | HT: Raft Cluster | 🟡 | ⚠️ (intercom sẵn) | 3-5 tuần |
| [229-distributed-locking.md](229-distributed-locking.md) | HU: Distributed Lock | 🟢 | ⚠️ (cross-process-lock sẵn) | 1-2 tuần |
| [230-event-sourcing-outbox.md](230-event-sourcing-outbox.md) | HV: Event Sourcing + Outbox | 🟢 | ⚠️ (AuditLog sẵn) | 2-3 tuần |

### Nhóm 69: Task Reliability (Vòng 53)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [231-dead-letter-queue.md](231-dead-letter-queue.md) | HW: Dead-Letter Queue | 🟢 | ⚠️ (retry sẵn) | 1 tuần |
| [232-actor-supervision.md](232-actor-supervision.md) | HX: Actor Supervision | 🟡 | ⚠️ (32 supervisor-tree sẵn) | 1-2 tuần |
| [233-work-stealing.md](233-work-stealing.md) | HY: Work Stealing | 🟢 | ⚠️ (kanban sẵn) | 1-2 tuần |







































## So sánh nhanh

```
Coupling:       Hầu hết 🟢 (zero) · vài 🟡 (public API/shared state) · A🔴 (nặng)
Agent-agnostic: Hầu hết ✅ · vài ⚠️ (cần cooperate) · A❌
Code sẵn:       ~30% có code sẵn (⚠️ 1 phần) · ~70% build mới
Effort:         3-5 ngày → 4-8 tuần (tùy pattern)
Xem chi tiết:   Cột "Coupling" / "Code sẵn" / "Effort" trong bảng trên
```

> Ghi chú: mã hướng (bijective base-26: A → HS) theo thứ tự thiết kế gốc; số file theo thứ tự trình bày
> nên không trùng thứ tự chữ cái (vd `09-pi-rpc-bridge.md` = R, `20-immune-system.md` = BB).
> `R` nằm giữa `H` và `I` theo thứ tự file nhưng chữ cái không liên tục một phần vì S không được dùng.
> Nhóm 9 (AK–AP) bổ sung sau khi đánh giá gaps: Blackboard, Memory Mgmt, Cache,
> Tool Registry, Eval Harness, Circuit Breaker.
> Nhóm 10 (AQ–BA) bổ sung từ nghiên cứu MCP (Anthropic/ADK/catalog/arXiv):
> Routing, Budget, Checkpoint, Escalation, Anti-Patterns, BDI, Impasse, Compilation,
> Pressure-Field, Gossip, A2A.
> Nhóm 11 (BC–BG) bổ sung từ web research 2026 (web-search-prime):
> MoA, Reflexion, Plan-and-Execute, Agentic RAG, Model Cascade — trào lưu 2024-2026.
> Nhóm 12 (BH–BJ) bổ sung từ web research 2026 (web-search-prime):
> ACI (SWE-agent), Agent Observability (OTel GenAI), Credential Broker (IETF CB4A).
> Nhóm 13 (BK–BM) bổ sung từ web research 2026 (web-search-prime):
> HTN Planning (Erol/SHOP2), MCP Gateway (2025-2026), Tool Maker (Cai et al. 2023).
> Nhóm 14 (BN–BP) bổ sung từ web research 2026 (web-search-prime):
> Agent Chaos Eng (2026), Serverless Agents (AWS 2026), Subsumption (Brooks 1986).
> Nhóm 15 (BQ–BS) bổ sung từ web research 2026 (web-search-prime):
> Agentic Firewall (2025-2026), LLM Gateway (LiteLLM/Portkey), EvoPrompt (Guo 2023).
> Nhóm 16 (BT–BV) bổ sung từ web research 2026 (web-search-prime):
> LLM Red Teaming (PyRIT 2024), Durable Execution (Temporal), Stateful Graph (LangGraph).
> Nhóm 17 (BW–BY) bổ sung từ web research 2026 (web-search-prime):
> LATS Tree Search (Zhou 2024), PDDL Classical Planning (NeurIPS 2025), DSPy (Khattab 2024).
> Nhóm 18 (BZ–CB) bổ sung từ web research 2026 (web-search-prime):
> Agent Negotiation (AgenticPay 2026), Swarm Optimization (EMNLP 2025), Context Engineering (2026).
> Nhóm 19 (CC–CE) bổ sung từ web research 2026 (web-search-prime):
> Test-Time Compute (ICLR 2025), Memory Consolidation (SleepCycle 2026), Tool Discovery (Smithery/MCPHub).
> Nhóm 20 (CF–CH) bổ sung từ web research 2026 (web-search-prime):
> LLM-as-Judge (2026), Agent Spec (Open Agent Spec 2025), Agent Topology (HMAS 2025).
> Nhóm 21 (CI–CK) bổ sung từ web research 2026 (web-search-prime):
> TEE/Confidential (arXiv 2605.03213), Hybrid Graph+Vector Memory (GraphRAG/Zep), Shared Graph Memory (NODES 2026).
> Nhóm 22 (CL–CN) bổ sung từ web research 2026 (web-search-prime):
> Prompt Caching (arXiv 2601.06007), Synthetic Eval Data (decodingai/futureagi), Semantic Caching (arXiv 2411.05276).
> Nhóm 23 (CO–CQ) bổ sung từ web research 2026 (web-search-prime):
> Hybrid Local-Cloud (sitepoint 2026), Trajectory Replay (arXiv 2606.04990), Tool-Call Recovery (zylos/taskade 2026).
> Nhóm 24 (CR–CT) bổ sung từ web research 2026 (web-search-prime):
> Agent CI/CD (kinde/galtea/RedHat 2026), Tool Schema Drift (fixzi/msft 2026), Tool Mocking (Zod Contract Mock Forge 2026).
> Nhóm 25 (CU–CW) bổ sung từ web research 2026 (web-search-prime):
> Progressive Disclosure (Anthropic/arXiv 2607.17598), Prompt Compression (LLMLingua), Dynamic Tool Selection (lunar.dev).
> Nhóm 26 (CX–CZ) bổ sung từ web research 2026 (web-search-prime):
> Reward Hacking (RHB/ICML 2026), Agent Drift (golden regression), Task Decomposition (arXiv 2602.21670).
> Nhóm 27 (DA–DC) bổ sung từ web research 2026 (web-search-prime):
> Self-Improving (arXiv 2607.13104), RAG Poisoning Defense (arXiv 2603.18034), Canary/Honeypot (2026).
> Nhóm 28 (DD–DF) bổ sung từ web research 2026 (web-search-prime):
> Credit Assignment (NeurIPS 2025), Simulated User Testing (UXAgent), Process Reward (PRM/step supervision).
> Nhóm 29 (DG–DI) bổ sung từ web research 2026 (web-search-prime):
> Tool Description Eng (Anthropic/Paragon), Learning from Corrections (Meta PAHF), Tool-Call Benchmark (ToolACE 236 cites).
> Nhóm 30 (DJ–DL) bổ sung từ web research 2026 (web-search-prime):
> Spec-Driven Dev (GitHub Spec-Kit 2025, arXiv 2602.00180), Pair Programming (PairCoder 56 cites), Spec→Test→Code (Spec-Kit/TDD).
> Nhóm 31 (DM–DO) bổ sung từ web research 2026 (web-search-prime):
> Toolchain Feedback (marclove/aihero), Error Analysis (Cemri 602 cites/ErrorProbe), Bounded Self-Correction (Lanham/SSRN).
> Nhóm 32 (DP–DR) bổ sung từ web research 2026 (web-search-prime):
> Artifact Catalog (MAV/agentregistry), Long-Context Mgmt (arXiv 2601.15300/Chain-of-Agents), Reproducibility (jfrog/MAV).
> Nhóm 33 (DS–DU) bổ sung từ web research 2026 (web-search-prime):
> Explainable Actions (arXiv 2512.21699/loginradius), Dynamic Permissions (arXiv 2607.22445/aembit/oso),
> Structured Reasoning (reasoning models 2025-2026/testrigor).
> Nhóm 34 (DV–DX) bổ sung từ web research 2026 (web-search-prime):
> Multi-Modal Inputs (chanl.ai/oneReach), Agentic FinOps (praesidia/finout/tmls), OTel GenAI Observability (CNCF semconv).
> Nhóm 35 (DY–EA) bổ sung từ web research 2026 (web-search-prime):
> Shadow Deployment (Ivanov 2026 A-SCDT/Materialize), Agent Arena (LMArena Elo 2026), Agent Watchdog (Datadog/os.moda).
> Nhóm 36 (EB–ED) bổ sung từ web research 2026 (web-search-prime):
> Human-in-the-Loop (StackAI/Port.io/Galileo), Agent Sandbox (Edera/Augment/Northflank 2026), Multi-Agent Consensus (Kaesberg ACL 2025, 67 cites).
> Nhóm 37 (EE–EG) bổ sung từ web research 2026 (web-search-prime):
> Agent Versioning (Claude cookbook/Arthur AI/Restate), Time-Travel Debug (Undo.io/Tian Pan 2026), Edge/On-Device (Qualcomm NPU 2026).
> Nhóm 38 (EH–EJ) bổ sung từ web research 2026 (web-search-prime):
> Agent Supply Chain (ReversingLabs/JFrog 2026), Cross-Device Sessions (Ably/Fast.io 2026), Personalization (AdaPA NeurIPS 2025).
> Nhóm 39 (EK–EM) bổ sung từ web research 2026 (web-search-prime):
> Multi-Tenancy (ScaleKit/Blaxel 2026), Skill Marketplace (Manus/agent-skills.cc 2026), Carbon-Aware (GAR/arXiv 2509.19996).
> Nhóm 40 (EN–EP) bổ sung từ web research 2026 (web-search-prime):
> Agent Fleet (Fast.io/Zylos 2026), Model Registry (MLflow/SageMaker), Multilingual (UseInvent/Delight 2026).
> Nhóm 41 (EQ–ES) bổ sung từ web research 2026 (web-search-prime):
> Data Flywheel (arXiv 2510.06674/NVIDIA), Scheduled Agents (Fast.io/ChatGPT 2026), Delegated Identity (OpenID 2025/ScaleKit).
> Nhóm 42 (ET–EV) bổ sung từ web research 2026 (web-search-prime):
> Computer-Use (Anthropic/arXiv 2411.10323), Model Distillation (Google step-by-step/IBM), Intent Router (NVIDIA AI-Q/Tian Pan 2026).
> Nhóm 43 (EW–EY) bổ sung từ web research 2026 (web-search-prime):
> Agent Onboarding (DataHub/AgentPatterns 2026), Non-Stationary (arXiv 2505.17902), RTBF (GDPR Art.17/CSA 2025).
> Nhóm 44 (EZ–FB) bổ sung từ web research 2026 (web-search-prime):
> Agent Commerce (Nevermined/Unframe), Agent Scorecard (AWS Connect/Arize), Agentic Data Pipeline (Conduktor/Redpanda/arXiv 2512.23737).
> Nhóm 45 (FC–FFFFFFFF) bổ sung từ web research 2026 (web-search-prime):
> Multi-Criteria Decision (TOPSIS/arXiv 2601.22433), Mechanism Design (Hurwicz Nobel 2007/Parkes), Agent IDE (AGDebugger arXiv 2503.02068/LangGraph Studio).
> Nhóm 46 (FF–FH) bổ sung từ web research 2026 (web-search-prime):
> MCP-First (arXiv 2505.02279/AWS agents-as-MCP-servers), Conflict Detection (CBS Sharon 2015), Workflow-as-Code (arXiv 2509.09915/Temporal).
> Nhóm 47 (FI–FK) bổ sung từ web research 2026 (web-search-prime):
> Hierarchical Memory (IBM/MongoDB), Prompt Caching (arXiv 2601.06007), Per-Task Cost Attribution (Codenotary/finout).
> Nhóm 48 (FL–FN) bổ sung từ web research 2026 (web-search-prime):
> Agent Guardrails (AgentDoG arXiv 2601.18491/Galileo), Self-Healing (arXiv 2605.06737/Union.ai), Context Engineering (MindStudio/elvex).
> Nhóm 49 (FO–FQ) bổ sung từ web research 2026 (web-search-prime):
> Curriculum Learning (arXiv 2512.08545/WebRL 96 cites), Multi-Agent Team Config (AWS Bedrock/Oracle ADK), Prompt Versioning & A/B (MLflow/Confident AI).
> Nhóm 50 (FR–FT) bổ sung từ web research 2026 (web-search-prime):
> Fault Tolerance & Failover (Couchbase/Nobl9 SLO), Structured Output Validation (arXiv 2606.09395/Zod), Agent Registry & Discovery (TrueFoundry/Google/AWS).
> Nhóm 51 (FU–FW) bổ sung từ web research 2026 (web-search-prime):
> Data Access Governance (KuppingerCole/Okta FGAC), Dynamic Model Routing (Zylos/arXiv 2603.04445), Agent Testing Sandbox (Confident AI/Modal/datagrid).
> Nhóm 52 (FX–AAAAAAAA) bổ sung từ web research 2026 (web-search-prime):
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
> Nhóm 59 (TTTTTTTT–GU) bổ sung từ web research 2026 (web-search-prime/firecrawl):
> Fine-Tuning & Custom Models (arXiv 2404.10779/Databricks), Multi-Agent Communication (Confluent/zylos EDA), Failure Detection & Retry Loops (ODSC/dev.to/CockroachDB).
> Nhóm 60 (GV–GX) bổ sung từ web research 2026 (web-search-prime):
> Constrained Decoding (arXiv 2501.10868/XGrammar token-mask), Self-Consistency Sampling (arXiv 2505.10772/NAACL 2025 — vote đa số N path), Dynamic Few-Shot Exemplar (arXiv 2507.23211/D-k-ICL).
> Nhóm 61 (GY–BBBBBBBB) bổ sung từ web research 2026 (web-search-prime):
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
| Thiết thực nhất **I: pi RPC** | pi đã có 33 commands, verify work |
| Elegant nhất **U: Tuple Space** | Agent tự tìm việc, SQLite sẵn |
| Lâu dài sạch nhất **G: Proxy+Watcher** | Agent-agnostic + inject + observe |
| Tham vọng nhất **HI: Agent OS** | mya = platform, agents = apps |
| Self-healing **AC: Reconcile** | K8s-proven, cron đã có reconcile |
| Reliability **AF: Supervisor** | Erlang OTP, crash isolation |
| Quality **AI: GAN Adversarial** | council sẵn, thêm vòng lặp fix |
| Scale **AJ: MapReduce** | Chia task song song, gộp kết quả |
| Tiết kiệm cost **AM: Cache Layer** | Tool-result cache cắt chi phí lặp lại |
| Context dài **FZ: Memory Mgmt** | Đã có 3 tầng, chỉ cần policy |
| Regression-test hành vi **AO: Eval Harness** | packages/eval sẵn, thêm golden scenarios |
| Đi đúng agent/model **FV: Routing** | roles + registry sẵn, thêm router |
| Chống chạy lố cost **AR: Budget Gating** | Trần cứng token/cost/steps |
| Task chờ CI/approval **AS: Checkpoint-Resume** | Session JSONL sẵn làm checkpoint |
| Hủy task vô ích **GJ: BDI Reconsideration** | Brain=beliefs, kanban=intentions |
| Thay agent drop-in | **BBB: A2A Capability Cards** | intercom+rpc sẵn, thêm AgentCard |
| Chuyển việc đúng người **BB: Explicit Handoff** | 4th foundation pattern (LangChain) |
| Cải thiện chất lượng **BC: Mixture of Agents** | N lời giải + aggregator, registry sẵn |
| Học từ lỗi **BD: Reflexion** | eval-harness sẵn, thêm reflect loop |
| Goal lớn nhiều bước **BE: Plan-and-Execute** | Planner=big, executor=small, kanban sẵn |
| Hỏi tri thức ngoài **GE: Agentic RAG** | MCP search sẵn, cần index nội bộ |
| Cắt cost model **BG: Model Cascade** | Tier sẵn, thêm confidence judge |
| Tool cho model tốt hơn | **III: ACI** | SWE-agent: +12% cùng model |
| Debug chậm/tốn **DX: Observability** | Span tree + cost attribution |
| Secret không chạm agent **BJ: Credential Broker** | IETF CB4A, key-rotation sẵn |
| Plan deterministic **BK: HTN** | Method library + backtracking |
| Nhiều MCP servers **BL: MCP Gateway** | mcp-client+oauth sẵn, thêm facade |
| Tự viết tool khi thiếu **BM: Tool Maker** | Registry+eval sẵn, tool tái dùng |
| Đo độ chịu lỗi **BN: Agent Chaos Eng** | Masking rate → CI gate |
| Worker scale-to-zero **BO: Serverless** | Cron+sweep sẵn, thêm event trigger |
| An toàn không phụ thuộc agent **BP: Subsumption** | Lớp ưu tiên, OO/SS/PP sẵn |
| Chặn prompt injection **BQ: Agentic Firewall** | Input/output gate, audit+secrets sẵn |
| 1 endpoint mọi LLM **BR: LLM Gateway** | Registry+fallback sẵn, ráp gateway |
| Tự tinh chỉnh prompt **BS: EvoPrompt** | Eval = fitness, promote có bằng chứng |
| Tấn công để đo phòng thủ **BT: Red Teaming** | PyRIT-style multi-turn, audit sẵn |
| Sống sót mọi crash **BU: Durable Execution** | Replay từ history, runner sẵn |
| Tiến trình có vòng lặp **BV: Stateful Graph** | Nodes/edges/checkpoint, HITL node |
| Thử-sai nhiều nhánh **BW: LATS Tree Search** | MCTS + reflection, PP = reward |
| Đảm bảo formal **BX: PDDL** | Solver chứng minh unsolvable |
| Prompt không fragile **BY: DSPy Compile** | Signature + examples → compile |
| Xung đột tài nguyên **BZ: Negotiation** | Offer/agreement, intercom sẵn |
| Tune tham số tự động **GA: Swarm PSO** | Liên tục: velocity + eval |
| Context ổn định **CB: Context Eng** | Assembler + budget + entropy |
| Compute theo độ khó **CC: Test-Time Compute** | Verifier-driven stop, ICLR 2025 |
| Trí nhớ tự dọn **CD: Consolidation** | Sleep-cycle, Anthropic Dreaming |
| Tự tìm tool ngoài **CE: Tool Discovery** | MCP registry + gate approve |
| Chấm task mở **CF: LLM-as-Judge** | Rubric + calibration + debias |
| Agent = khai báo **CG: Agent Spec** | Open Agent Spec, validator |
| Cấu trúc nhóm agent **CH: Topology** | Star/mesh/hierarchical/ring |
| Chạy trên máy đáng nghi **CI: TEE** | Enclave + attestation |
| Memory suy luận quan hệ **GO: Hybrid Memory** | Vector + graph (GraphRAG/Zep) |
| Nhiều agent chung tri thức **CK: Shared Graph** | Resolution + versioning |
| Agent loop đắt (token) **FJ: Prompt Cache** | Static-first, prefix cache |
| Cần test case cho eval **CM: Synthetic Data** | Dimension + anchor + evolve |
| Query routine trùng lặp **CN: Semantic Cache** | Embed + threshold, bust theo VV |
| Privacy/offline **CO: Local-Cloud** | Ollama + router, escalate cloud |
| Đổi prompt sợ vỡ **CP: Trajectory Replay** | Trace thật chạy lại, golden |
| Tool fail liên miên **CQ: Recovery** | Structured error + LLM sửa |
| Đổi prompt cần chặn vỡ **CR: Agent CI/CD** | Eval gate trong PR |
| MCP server hay đổi **CS: Schema Drift** | Baseline + fail-closed |
| Test không đụng thật **CT: Tool Mocking** | Mock từ schema + violations |
| Context đầy không cần thiết **CU: Disclosure** | Metadata → mở dần (Anthropic) |
| Context dài phải giữ **CV: Compression** | LLMLingua nén token |
| Hàng trăm tools quá window **N: Select Tools** | Embed + top-k mỗi turn |
| Agent ăn gian metric | **CX: Anti-Hack** | Trace verify + effort ratio |
| Chất lượng giảm âm thầm **CY: Agent Drift** | Golden regression nightly |
| Task lớn hay vỡ | **CZ: Decompose** | Task tree + checkpoint |
| Agent tự cải thiện | **DA: Self-Improve** | Feedback → fix có gate |
| KB bị chôn độc **GR: Poison Defense** | Sanitize + hybrid retriever |
| Agent bị điều khiển **DC: Canary** | Tool giả + marker + fingerprint |
| Ai thật sự đóng góp **DD: Credit** | Attribution + counterfactual |
| User thật khó đoán **DE: Sim User** | LLM đóng user, đa lượt |
| Fail muộn đốt token **DF: Process Reward** | Chấm từng bước, dừng sớm |
| Agent chọn sai tool | **DG: Desc Eng** | Mô tả chuẩn + self-optimize |
| User phải sửa hoài **DH: Corrections** | Preference từ chỉnh sửa |
| Tool dùng đúng không **FY: Tool Bench** | Selection/schema/distractor |
| Code lệch yêu cầu **DJ: Spec-Driven** | Spec = contract, verify |
| Code chất lượng thấp **DK: Pair Agents** | Navigator + Driver |
| Test vô nghĩa/fake **DL: Spec→Test→Code** | Test từ spec, RED gate |
| Code lỗi kiểu/lint **DM: Toolchain** | tsc/eslint sau mỗi edit |
| Fail rải rác khó thấy gốc **DN: Error Analysis** | Pool + cluster + taxonomy |
| Tự sửa rồi tệ hơn **DO: Bounded Correct** | Vòng giới hạn + fail-loud |
| Output agent khó truy vết **DP: Artifacts** | Catalog + MAV version |
| Context dài bị quên giữa **DQ: Long-Context** | Offload/Sum/Chain-of-Agents |
| Chạy lại ra khác nhau | **DR: Reproducible** | Manifest pin stack + variance |
| User không hiểu vì sao **DS: Explainable** | Rationale/evidence per action |
| Quyền tool cứng nhắc **GX: Dynamic Perms** | Policy theo ngữ cảnh + narrow |
| Thinking ẩn khó kiểm **DU: Reasoning** | Schema + validate + đo (GGGGG) |
| User đính ảnh/ghi âm **DV: Multi-Modal** | Preprocess (OCR/STT) + MLLM khi cần |
| Cost theo user/dự án **DW: FinOps** | Meter→quota→route→degrade |
| Muốn dashboard chuẩn **DX: OTel** | gen_ai.* spans + OTLP exporter |
| Đổi config sợ hồi quy **DY: Shadow** | Chạy song song + promote có gate |
| So config/model khó chọn **DZ: Arena** | Match Elo blind A/B (judge) |
| Agent hỏng im lặng **EA: Watchdog** | Probe định kỳ + tự can thiệp |
| Hành động không thể đảo | **EB: HITL** | Duyệt trước khi thực thi |
| Code LLM sinh nguy hiểm **FW: Sandbox** | MicroVM/container + default-deny |
| Quyết định quan trọng **ED: Consensus** | Vote theo giao thức + confidence |
| Prompt đổi sợ lỗi **EE: Versioning** | Env tags + rollback bằng config |
| Lỗi agent tái không lại | **EF: TTD** | Flight recorder + rewind + replay |
| Dữ liệu không rời máy **L: Edge** | Local-first + offline + sovereignty |
| Skill/tool lạ không tin **EH: Supply Chain** | Ký số + verify + provenance |
| Đổi máy mất session **EI: Cross-Device** | State tách transport + presence |
| Agent hợp ý người dùng **GM: Personalize** | Preference store + AdaPA strength |
| Dữ liệu user lộ chéo **EK: Tenancy** | Tenant scope + RLS DB-level |
| Không muốn viết lại skill **EL: Marketplace** | Tìm/cài skill chuẩn mở + verify |
| Giảm khí thải AI **EM: Carbon** | Route theo carbon intensity + defer |
| Hàng trăm agents rối **EN: Fleet** | Provision/scale/canary batch |
| Model nhiều khó quản **FT: Registry** | Catalog model + lifecycle + gate |
| User nói nhiều tiếng **EP: Multilingual** | i18n prompt + glossary + locale |
| Agent không tiến bộ **EQ: Flywheel** | Production → curate → eval → improve |
| Việc lặp mỗi ngày **ER: Scheduled** | Cron + state lần trước + diff/notify |
| Agent làm thay user **GQ: Delegation** | Identity riêng + on-behalf-of + chain |
| Tool không API/CLI **ET: Computer-Use** | Screenshot → action trong VM |
| Task tốn lặp lại **EU: Distill** | Model lớn dạy model nhỏ |
| Nhiều tools rối **EV: Intent Router** | Phân lớp ý định + depth |
| Agent mới "nháo" **EW: Onboarding** | Tri thức + trust + smoke eval |
| KB/API đổi, agent cũ **EX: Non-Stationary** | Drift detector + refresh + re-verify |
| User đòi xóa dữ liệu **EY: RTBF** | Erasure pipeline + anonymize + test |
| Agent trả phí cho nhau **EZ: Commerce** | Pricing outcome + ledger + billing |
| Agent yếu không thấy **FA: Scorecard** | KPI đa chiều + baseline + trend |
| Dữ liệu real-time **FB: Pipeline** | Agent trong stream + self-heal |
| Nhiều tiêu chí xung đột | **FC: MCDM** | TOPSIS + trọng số + giải thích |
| Agent ích kỷ phá phối hợp **FD: Mechanism** | Incentive design + Nash check |
| Dev agent "mù" **FE: Agent IDE** | Live view + steer + tune |
| Năng lực bị khóa trong mya **FF: MCP-First** | Agent-as-MCP-server, agent khác gọi |
| Agent làm trùng việc **FG: Conflict Detect** | Claim + so sánh + resolve (CBS) |
| Workflow "mơ hồ" **FH: Workflow-as-Code** | Graph DAG + durable resume |
| Nhớ không phân tầng **FI: Hierarchical Mem** | Working/episodic/semantic/procedural |
| Cost LLM cao **FJ: Prompt Cache** | KV/semantic cache −41-80% |
| Task nào tốn bao nhiêu **FK: Cost Attribution** | Task ID + budget per task |
| Agent tự động gây hại **FL: Guardrails** | Chặn + chẩn đoán root cause |
| Agent chết khi lỗi **FM: Self-Healing** | Phân loại lỗi + phục hồi nhanh |
| Context phình, token cao **CB: Context Budget** | Budget + trim + nén semantic |
| Agent học task quá khó **FO: Curriculum** | Tăng độ khó theo năng lực |
| Team agent chưa định hình **FP: Team Config** | Supervisor + collaborator profile |
| Đổi prompt phá chất lượng **FQ: Prompt A/B** | Registry + regression + canary |
| Agent chết giữa chừng **FR: Fault Tolerance** | Replica + failover + SLO |
| LLM trả JSON rác **FS: Output Validate** | Ép grammar + Zod validate |
| Không biết agent nào làm gì **FT: Agent Registry** | Phone book + discover + select |
| Agent đọc bừa dữ liệu **FU: Data Governance** | FGAC + DB-level enforce |
| LLM đắt mà không cần **FV: Model Routing** | Cascade + adaptive −40-85% |
| Deploy agent chưa test **FW: Test Sandbox** | Sandbox + simulation + release gate |
| Agent không có danh tính **FX: Agent OAuth** | OAuth 2.1/OIDC + token exchange |
| Tool gọi lộn xộn **FY: Tool Graph** | Subset + dependency + parallel |
| Chat dài phình token **FZ: Chat Memory** | Recent + summary layered |
| Nhiều agent không trung tâm **GA: Swarm** | Luật local + emergence |
| Sở thích user chưa khớp **GB: RLHF** | Reward model + DPO/PPO |
| Task khó cần thử nhiều hướng **GC: Tree Search** | Mô phỏng nhánh + rollback |
| 1 LLM trả lời thiếu chính xác **GD: Ensemble** | N mẫu + aggregate/debate |
| RAG đơn bước không đủ **GE: Agentic RAG** | Plan retrieval + multi-hop |
| Agent thừa quyền tool **GF: Least Priv.** | Scope động + JIT theo task |
| Agent khác hệ không nói chuyện **GG: Interop** | MCP + A2A + ACP |
| Test thiếu edge case **GH: PBT** | Property + fuzz + shrink |
| Call lặp vẫn tốn token **GI: KV+Sem Cache** | 2 tầng cache LLM |
| Không biết agent lời/lỗ **GJ: Token Econ** | Cost model + pricing + forecast |
| Tenant rò dữ liệu nhau **GK: Tenant Isol.** | Container + cache per tenant |
| RAG trả lời "bịa" **GL: RAG Eval** | Faithfulness + relevancy |
| Agent trôi tính cách **GM: Persona** | Persona profile + consistency |
| Agent đốt budget **GN: Rate Limit** | Token bucket + quota + queue |
| Retrieval thiếu sót **GO: Hybrid Search** | BM25 + vector + rerank |
| Không tái dựng được quyết định **GP: Audit Trail** | Immutable + decision trace |
| Agent giao việc vô quyền **GQ: Delegation** | Contract + chain + revoke |
| Data độc lừa agent **GR: Inject Defense** | Sanitize + tách data + allowlist |
| Agent trao đổi lột xác **GT: Comm** | Message bus + event-driven |
| Agent loopy hết $ **GU: Loop Guard** | Circuit breaker + checkpoint |
| Output không đúng JSON **GV: Constrain** | Mask token theo grammar/schema |
| Suy luận 1 lần dễ sai | **GW: Self-Consis.** | N-sample + vote đa số |
| 5-shot tĩnh lệch query **GX: Few-Shot** | Retrieval ví dụ động |
| Sinh chậm từng token **GY: Spec Decode** | Draft + verify song song |
| N tool call chậm tuần tự **GZ: Par-Tool** | Gom call độc lập — chạy song song |
| Query ngắn miss retrieval **HA: Rewrite** | LLM viết lại trước khi tìm |
| Doc dài index phẳng miss **HB: Chunking** | Parent-child 2 cấp |
| Model nặng không fit local **HC: Quantize** | GGUF/INT4 nén trọng số |
| Embedding chọn mò **HD: Embed Eval** | Gold set + recall@K/NDCG |
| Index stale khi doc đổi **HE: Index Maint** | Incremental + reindex nền |
| PII lọt vào LLM **HF: PII Redact** | Detector + placeholder + sweep |
| LLM treo vô hạn **HG: Deadline** | Budget thời gian + partial |
| Cần giao diện tiếng nói **HH: Voice** | VAD + STT + LLM + TTS |
| Web không có API **HI: Web Agent** | Playwright điều khiển DOM |
| Tool trả quá nhiều token **HJ: Compress** | Nén output trước khi inject |
| Câu không nguồn **HK: Grounding** | Verify claim + citation |
| Cần sinh ảnh/video **HL: Media Out** | Gen model + validate + lưu |
| Đổi agent rủi cao **HM: Flags** | Rollout % + rollback tức |
| Nhiều request tốn tiền **HN: Batch** | Gom window — 1 forward |
| Cần info mới ngoài RAG **HO: Web Search** | SERP API + citation |
| Model nhớ fact sai **HP: K-Edit** | ROME/MEMIT sửa trọng số |
| Prompt lẫn thứ bậc **HQ: Hierarch** | System > user > injected |
| Agent tự submit/pay **HR: Approval** | Gate duyệt trước critical |
| User không thấy kết quả **HS: Notify** | Push Slack/email/SMS |
| Output không đúng JSON **GV: Constrain** | Mask token theo grammar/schema |
| Suy luận run một lần sai | **GW: Self-Consis.** | N-sample + vote đa số |
| 5-shot tĩnh lệch query **GX: Few-Shot** | Retrieval ví dụ động theo câu hỏi |
| Cẩm nang cấm kỵ **AU: Anti-Patterns** | Checklist khi review kiến trúc |
