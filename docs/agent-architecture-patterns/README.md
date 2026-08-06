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


### Nhóm 70: Security Ops (Vòng 54)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [234-secret-rotation.md](234-secret-rotation.md) | HZ: Secret Rotation | 🟡 | ⚠️ (SecretStore.rotate/revoke sẵn — thiếu s | 2-3 tuần |
| [235-output-moderation.md](235-output-moderation.md) | IA: Output Moderation | 🟡 | ⚠️ (redact + threat-scan sẵn — thiếu modera | 2-3 tuần |
| [236-behavior-anomaly.md](236-behavior-anomaly.md) | IB: Behavior Anomaly | 🟢 | ⚠️ (audit + telemetry sẵn — thiếu baseline  | 2-3 tuần |

### Nhóm 71: Uncertainty & World (Vòng 55)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [237-conformant-planning.md](237-conformant-planning.md) | IC: Conformant Planning | 🟡 | ❌ (có lookahead-tree 185 + structured-reas | 3-5 tuần |
| [238-uncertainty-quantification.md](238-uncertainty-quantification.md) | ID: Uncertainty Quantification | 🟡 | ⚠️ (budget/threat-scan sẵn — thiếu confiden | 2-3 tuần |
| [239-world-model.md](239-world-model.md) | IE: World Model | 🟡 | ⚠️ (memory graph + lookahead 185 — thiếu pr | 4-6 tuần |

### Nhóm 72: Data & Privacy (Vòng 56)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [240-data-lineage.md](240-data-lineage.md) | IF: Data Lineage | 🟡 | ⚠️ (audit 198 + memory graph sẵn — thiếu pr | 2-3 tuần |
| [241-differential-privacy.md](241-differential-privacy.md) | IG: Differential Privacy | 🔴 | ❌ (redact 214 + audit 198 sẵn — thiếu DP n | 4-6 tuần |
| [242-memory-rollback.md](242-memory-rollback.md) | IH: Memory Rollback | 🟡 | ⚠️ (memory brain-store + lifecycle sẵn — th | 2-3 tuần |

### Nhóm 73: Ops & SLO (Vòng 57)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [243-agent-slo-sli.md](243-agent-slo-sli.md) | II: Agent SLO/SLI | 🟢 | ⚠️ (telemetry + cost sẵn — thiếu SLO target | 2-3 tuần |
| [244-incident-runbooks.md](244-incident-runbooks.md) | IJ: Incident Runbook | 🟡 | ⚠️ (retry 203 + self-heal 169 + DLQ 231 sẵn | 2-3 tuần |
| [245-capacity-planning.md](245-capacity-planning.md) | IK: Capacity Planning | 🟢 | ⚠️ (cost + budget + rate-limit sẵn — thiếu  | 2-3 tuần |

### Nhóm 74: Eval Advanced (Vòng 58)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [246-judge-calibration.md](246-judge-calibration.md) | IL: Judge Calibration | 🟡 | ⚠️ (eval harness + council sẵn — thiếu judg | 2-3 tuần |
| [247-differential-testing.md](247-differential-testing.md) | IM: Differential Testing | 🟢 | ⚠️ (eval harness + versioning 135 sẵn — thi | 1-2 tuần |
| [248-success-criteria-engineering.md](248-success-criteria-engineering.md) | IN: Success Criteria Engineering | 🟡 | ⚠️ (eval tiers + structured-output 175 sẵn  | 1-2 tuần |

### Nhóm 75: Time & Speed (Vòng 59)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [249-priority-scheduling.md](249-priority-scheduling.md) | IO: Priority Scheduling | 🟡 | ⚠️ (kanban queue + 215 deadline-bound sẵn — | 2 tuần |
| [250-context-prefetching.md](250-context-prefetching.md) | IP: Context Prefetching | 🟡 | ⚠️ (prompt-cache 166 + semantic-cache 191 s | 2 tuần |
| [251-time-aware-planning.md](251-time-aware-planning.md) | IQ: Time-Aware Planning | 🟡 | ⚠️ (cron 148 + 215 deadline-bound + time he | 3-4 tuần |

### Nhóm 76: User Experience (Vòng 60)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [252-command-palette.md](252-command-palette.md) | IR: Command Palette | 🟡 | ⚠️ (tool registry sẵn — thiếu fuzzy search  | 2-3 tuần |
| [253-change-preview-diff.md](253-change-preview-diff.md) | IS: Change Preview & Diff | 🟡 | ⚠️ (hashline-edit-pro diff sẵn — thiếu pre- | 2-3 tuần |
| [254-offline-first.md](254-offline-first.md) | IT: Offline-First | 🟡 | ⚠️ (task queue + retry sẵn — thiếu sync eng | 3-4 tuần |

### Nhóm 77: Emergence & Cooperation (Vòng 61)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [255-emergent-behavior-detection.md](255-emergent-behavior-detection.md) | IU: Emergent Behavior Detection | 🟡 | ⚠️ (audit + drift detection sẵn — thiếu ano | 2-3 tuần |
| [256-contract-net-protocol.md](256-contract-net-protocol.md) | IV: Contract-Net Protocol | 🟢 | ⚠️ (202 agent-communication + task delegati | 2-3 tuần |
| [257-blast-radius-containment.md](257-blast-radius-containment.md) | IW: Blast Radius Containment | 🟡 | ⚠️ (sandbox + permission scope sẵn — thiếu  | 2-3 tuần |

### Nhóm 78: Model Security (Vòng 62)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [258-model-poisoning-detection.md](258-model-poisoning-detection.md) | IX: Model Poisoning Detection | 🔴 | ❌ (không có model eval pipeline) | 4-6 tuần |
| [259-prompt-hardening.md](259-prompt-hardening.md) | IY: Prompt Hardening | 🟡 | ⚠️ (GR 200 injection defense sẵn — thiếu st | 3-4 tuần |
| [260-tool-arg-injection.md](260-tool-arg-injection.md) | IZ: Tool-Argument Injection | 🟡 | ⚠️ (tool schema + Zod validation sẵn — thiế | 2-3 tuần |

### Nhóm 79: Ops at Scale (Vòng 63)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [261-multi-region-failover.md](261-multi-region-failover.md) | JA: Multi-Region Failover | 🔴 | ❌ (provider failover sẵn — thiếu region ro | 4-6 tuần |
| [262-compliance-automation.md](262-compliance-automation.md) | JB: Compliance Automation | 🟡 | ⚠️ (audit-trails 198 + PII redaction 214 sẵ | 3-5 tuần |
| [263-collaborative-sessions.md](263-collaborative-sessions.md) | JC: Collaborative Sessions | 🔴 | ❌ (single-session sẵn — thiếu CRDT merge + | 4-6 tuần |

### Nhóm 80: Cognition (Vòng 64)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [264-temporal-knowledge.md](264-temporal-knowledge.md) | JD: Temporal Knowledge | 🟡 | ⚠️ (memory store + core.time sẵn — thiếu ti | 3-4 tuần |
| [265-hallucination-detection.md](265-hallucination-detection.md) | JE: Hallucination Detection | 🟡 | ⚠️ (219 grounding + 205 self-consistency sẵ | 3-4 tuần |
| [266-runaway-loop-detection.md](266-runaway-loop-detection.md) | JF: Runaway Loop Detection | 🟡 | ⚠️ (203 retry-limit + 42 circuit-breaker sẵ | 2-3 tuần |

### Nhóm 81: Novel Architectures (Vòng 65)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [267-neural-symbolic.md](267-neural-symbolic.md) | JG: Neuro-Symbolic | 🟡 | ⚠️ (tool call + structured output sẵn — thi | 4-6 tuần |
| [268-petri-net-workflow.md](268-petri-net-workflow.md) | JH: Petri Net Workflow | 🟢 | ⚠️ (pi-extensible-workflows + pi-dynamic-wo | 3-5 tuần |
| [269-counterfactual-reasoning.md](269-counterfactual-reasoning.md) | JI: Counterfactual Reasoning | 🟡 | ⚠️ (104 task-decomp + planning sẵn — thiếu  | 3-4 tuần |

### Nhóm 82: Performance (Vòng 66)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [270-request-coalescing.md](270-request-coalescing.md) | JJ: Request Coalescing | 🟡 | ⚠️ (semantic cache sẵn — chưa có single-fli | 1-2 tuần |
| [271-speculative-task-execution.md](271-speculative-task-execution.md) | JK: Speculative Task Execution | 🟡 | ⚠️ (parallel executor chưa có — chưa có spe | 2-4 tuần |
| [272-graceful-degradation.md](272-graceful-degradation.md) | JL: Graceful Degradation | 🟡 | ⚠️ (feature flag sẵn HM; chưa có degradatio | 2-3 tuần |

### Nhóm 83: Security & Trust (Vòng 67)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [273-signed-agent-actions.md](273-signed-agent-actions.md) | JM: Signed Agent Actions | 🟡 | ⚠️ (audit log sẵn GP — chưa có chữ ký số) | 2-4 tuần |
| [274-containerized-tool-execution.md](274-containerized-tool-execution.md) | JN: Containerized Tool Execution | 🔴 | ⚠️ (sandbox EC sẵn — chưa có per-tool conta | 3-6 tuần |
| [275-ssrf-via-tools.md](275-ssrf-via-tools.md) | JO: SSRF Prevention | 🟡 | ⚠️ (fetch tool sẵn — chưa có allowlist/bloc | 1-3 tuần |

### Nhóm 84: Memory & Learning (Vòng 68)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [276-procedural-memory.md](276-procedural-memory.md) | JP: Procedural Memory | 🟡 | ⚠️ (hierarchical memory FI sẵn — chưa tách  | 2-4 tuần |
| [277-reasoning-memoization.md](277-reasoning-memoization.md) | JQ: Reasoning Memoization | 🟡 | ⚠️ (semantic cache GI sẵn — chưa có reasoni | 1-2 tuần |
| [278-after-action-review.md](278-after-action-review.md) | JR: After-Action Review | 🟡 | ⚠️ (self-improving DA sẵn — chưa có formal  | 1-2 tuần |

### Nhóm 85: Distributed State (Vòng 69)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [279-crdt-agent-state.md](279-crdt-agent-state.md) | JS: CRDT Agent State | 🟡 | ❌ (SQLite state — chưa có CRDT merge) | 3-6 tuần |
| [280-optimistic-concurrency.md](280-optimistic-concurrency.md) | JT: Optimistic Concurrency | 🟡 | ⚠️ (SQLite — chưa có version/CAS retry) | 1-2 tuần |
| [281-tool-idempotency-keys.md](281-tool-idempotency-keys.md) | JU: Idempotency Keys | 🟡 | ⚠️ (retry GU sẵn — chưa có idempotency-key  | 1-2 tuần |

### Nhóm 86: Data Security (Vòng 70)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [282-encrypted-memory-at-rest.md](282-encrypted-memory-at-rest.md) | JV: Encrypted Memory at-Rest | 🟡 | ⚠️ (memory store sẵn — chưa có encryption l | 2-4 tuần |
| [283-data-classification.md](283-data-classification.md) | JW: Data Classification | 🟡 | ⚠️ (PII detect HF sẵn — chưa có classificat | 2-4 tuần |
| [284-data-minimization.md](284-data-minimization.md) | JX: Data Minimization | 🟡 | ⚠️ (prompt compression CV sẵn — chưa có exp | 1-2 tuần |

### Nhóm 87: Prompt Techniques (Vòng 71)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [285-step-back-prompting.md](285-step-back-prompting.md) | JY: Step-Back Prompting | 🟢 | ❌ (chưa có step-back prompt template) | 0.5-1 tuần |
| [286-chain-of-verification.md](286-chain-of-verification.md) | JZ: Chain-of-Verification (CoVe) | 🟢 | ❌ (chưa có CoVe loop) | 0.5-1.5 tuần |
| [287-program-aided-lm.md](287-program-aided-lm.md) | KA: Program-Aided Language Models (PAL) | 🟡 | ⚠️ (code-exec tool + sandbox sẵn — chưa có  | 1-2 tuần |

### Nhóm 88: Tooling (Vòng 72)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [288-tool-polyfill-fallback.md](288-tool-polyfill-fallback.md) | KB: Tool Polyfill & Fallback | 🟡 | ⚠️ (tool registry sẵn — chưa có polyfill/fa | 1-2 tuần |
| [289-tool-dry-run.md](289-tool-dry-run.md) | KC: Tool Dry-Run | 🟡 | ⚠️ (approval gate HR sẵn — chưa có dry-run  | 1-2 tuần |
| [290-tool-precondition-checks.md](290-tool-precondition-checks.md) | KD: Tool Precondition Checks | 🟢 | ⚠️ (tool có schema validation — chưa có sta | 0.5-1.5 tuần |

### Nhóm 89: Multi-agent Ops (Vòng 73)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [291-cancel-propagation.md](291-cancel-propagation.md) | KE: Cancel Propagation | 🟡 | ⚠️ (subagent spawn sẵn — thiếu AbortSignal  | 1-2 tuần |
| [292-agent-lifecycle-hooks.md](292-agent-lifecycle-hooks.md) | KF: Agent Lifecycle Hooks | 🟡 | ⚠️ (pool start/stop sẵn — thiếu hook regist | 1 tuần |
| [293-hermetic-config.md](293-hermetic-config.md) | KG: Hermetic Config | 🟢 | ⚠️ (config sẵn — thiếu pinning + hashing) | 1 tuần |

### Nhóm 90: Communication Contracts (Vòng 74)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [294-agent-message-contracts.md](294-agent-message-contracts.md) | KH: Agent Message Contracts | 🟢 | ⚠️ (tool schema sẵn — thiếu message contrac | 1-2 tuần |
| [295-agent-error-codes.md](295-agent-error-codes.md) | KI: Agent Error Codes | 🟢 | ⚠️ (retry/catch sẵn — thiếu code chuẩn + ta | 1 tuần |
| [296-agent-diagnostics-cli.md](296-agent-diagnostics-cli.md) | KJ: Agent Diagnostics CLI | 🟢 | ⚠️ (logs/otel sẵn — thiếu lệnh chẩn đoán tổ | 1-2 tuần |

### Nhóm 91: Eval & QA (Vòng 75)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [297-golden-trace-replay.md](297-golden-trace-replay.md) | KK: Golden Trace Replay | 🟢 | ⚠️ (trajectory-replay sẵn — thiếu golden se | 1-2 tuần |
| [298-mock-llm-server.md](298-mock-llm-server.md) | KL: Mock LLM Server | 🟢 | ⚠️ (eval-harness sẵn — thiếu mock LLM endpo | 1 tuần |
| [299-regression-gates-ci.md](299-regression-gates-ci.md) | KM: Regression Gates CI | 🟢 | ⚠️ (eval-harness/CI sẵn — thiếu threshold g | 1-2 tuần |

### Nhóm 92: Scheduling & Cost (Vòng 76)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [300-offpeak-batch-window.md](300-offpeak-batch-window.md) | KN: Off-Peak Batch Window | 🟢 | ⚠️ (batch/scheduled sẵn — thiếu off-peak de | 1-2 tuần |
| [301-latency-budget-routing.md](301-latency-budget-routing.md) | KO: Latency-Budget Routing | 🟢 | ⚠️ (routing/cascade sẵn — thiếu latency-bud | 1-2 tuần |
| [302-inference-budget-arbitration.md](302-inference-budget-arbitration.md) | KP: Inference Budget Arbitration | 🟡 | ⚠️ (cost-budget sẵn — thiếu arbitration nhi | 1-2 tuần |

### Nhóm 93: Security Testing (Vòng 77)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [303-redteam-automation.md](303-redteam-automation.md) | KQ: Redteam Automation | 🟢 | ⚠️ (red-teaming doc sẵn — thiếu pipeline tự | 2-3 tuần |
| [304-prompt-fuzzing.md](304-prompt-fuzzing.md) | KR: Prompt Fuzzing | 🟢 | ⚠️ (property-based testing sẵn — thiếu prom | 1-2 tuần |
| [305-security-eval-suite.md](305-security-eval-suite.md) | KS: Security Eval Suite | 🟢 | ⚠️ (eval-harness sẵn — thiếu benchmark bảo  | 2 tuần |

### Nhóm 94: UX Advanced (Vòng 78)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [306-multi-window-views.md](306-multi-window-views.md) | KT: Multi-Window Views | 🟡 | ⚠️ (TUI sẵn — thiếu layout đa-ô có thể cấu  | 2-3 tuần |
| [307-output-verbosity-adapt.md](307-output-verbosity-adapt.md) | KU: Output Verbosity Adapt | 🟢 | ⚠️ (config sẵn — thiếu adaptive logic) | 1 tuần |
| [308-first-run-experience.md](308-first-run-experience.md) | KV: First-Run Experience | 🟡 | ⚠️ (onboarding doc sẵn — thiếu guided flow) | 2 tuần |

### Nhóm 95: Inference Ops (Vòng 79)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [309-autoscaling-llm.md](309-autoscaling-llm.md) | KW: Autoscaling LLM | 🟡 | ⚠️ (rate-limit/pool sẵn — thiếu autoscale l | 2-3 tuần |
| [310-inference-slot-scheduler.md](310-inference-slot-scheduler.md) | KX: Inference Slot Scheduler | 🟡 | ⚠️ (rate-limit/pool sẵn — thiếu slot schedu | 2-3 tuần |
| [311-warm-pool-cache.md](311-warm-pool-cache.md) | KY: Warm Pool / Model Cache | 🟡 | ⚠️ (connection-pool/prompt-cache sẵn — thiế | 1-2 tuần |

### Nhóm 96: Knowledge (Vòng 80)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [312-knowledge-retention-policy.md](312-knowledge-retention-policy.md) | KZ: Knowledge Retention Policy | 🟡 | ⚠️ (memory store + distill sẵn — thiếu TTL  | 2-3 tuần |
| [313-incremental-kb-build.md](313-incremental-kb-build.md) | LA: Incremental KB Build | 🟡 | ⚠️ (distill + memory + embed sẵn — thiếu in | 3-4 tuần |
| [314-knowledge-conflict-merge.md](314-knowledge-conflict-merge.md) | LB: Knowledge Conflict Merge | 🟡 | ⚠️ (memory + embed dedup sẵn — thiếu confli | 3-4 tuần |

### Nhóm 97: Coordination (Vòng 81)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [315-plan-merge-agents.md](315-plan-merge-agents.md) | LC: Plan Merge Agents | 🟡 | ⚠️ (104 task-decomp + subagents + planning  | 4-5 tuần |
| [316-resource-negotiation.md](316-resource-negotiation.md) | LD: Resource Negotiation | 🟡 | ⚠️ (256 contract-net + 302 inference-budget | 4-5 tuần |
| [317-cross-agent-txn.md](317-cross-agent-txn.md) | LE: Cross-Agent Transaction | 🟡 | ⚠️ (subagents + tool-call sẵn — thiếu saga  | 4-6 tuần |

### Nhóm 98: Observability Deep (Vòng 82)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [318-token-trace-visual.md](318-token-trace-visual.md) | LF: Token-Level Trace Visual | 🟡 | ⚠️ (provider + agent-loop + tool-call sẵn — | 3-4 tuần |
| [319-latency-breakdown.md](319-latency-breakdown.md) | LG: Latency Breakdown | 🟢 | ⚠️ (agent-loop + provider + tool-call sẵn — | 2-3 tuần |
| [320-cost-per-step.md](320-cost-per-step.md) | LH: Cost Per Step | 🟢 | ⚠️ (provider + agent-loop + 302 budget sẵn  | 2-3 tuần |

### Nhóm 99: Testing Reliability (Vòng 83)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [321-flaky-test-stabilization.md](321-flaky-test-stabilization.md) | LI: Flaky Test Stabilization | 🟡 | ⚠️ (vitest + test harness sẵn — thiếu flaky | 3-4 tuần |
| [322-chaos-agents.md](322-chaos-agents.md) | LJ: Chaos Agents | 🟡 | ⚠️ (tool-call + agent-loop + retry sẵn — th | 3-4 tuần |
| [323-load-testing-agents.md](323-load-testing-agents.md) | LK: Load Testing Agents | 🟢 | ⚠️ (agent-loop + concurrency + provider sẵn | 3-4 tuần |

### Nhóm 100: Model Updates (Vòng 84)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [324-model-upgrade-rollout.md](324-model-upgrade-rollout.md) | LL: Model Upgrade Rollout | 🟡 | ⚠️ (178 routing + eval + provider sẵn — thi | 3-4 tuần |
| [325-model-retirement.md](325-model-retirement.md) | LM: Model Retirement | 🟡 | ⚠️ (178 routing + prompts + eval sẵn — thiế | 2-3 tuần |
| [326-embedding-model-switch.md](326-embedding-model-switch.md) | LN: Embedding Model Switch | 🟡 | ⚠️ (packages/memory + embed sẵn — thiếu re- | 3-4 tuần |

### Nhóm 101: Agent Interaction (Vòng 85)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [327-interruptible-agents.md](327-interruptible-agents.md) | LO: Interruptible Agents | 🟡 | ⚠️ (agent-loop + checkpoint sẵn — thiếu int | 3-4 tuần |
| [328-deferred-questions.md](328-deferred-questions.md) | LP: Deferred Questions | 🟢 | ⚠️ (agent-loop + mailbox/channel sẵn — thiế | 2-3 tuần |
| [329-quick-action-shortcuts.md](329-quick-action-shortcuts.md) | LQ: Quick Action Shortcuts | 🟢 | ⚠️ (agent-loop + history + commands sẵn — t | 2 tuần |

### Nhóm 102: Safety (Vòng 86)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [330-safety-case-evidence.md](330-safety-case-evidence.md) | LR: Safety Case Evidence | 🟡 | ❌ (audit log sẵn — chưa có structured safe | 2-3 tuần |
| [331-escalation-timeouts.md](331-escalation-timeouts.md) | LS: Escalation Timeouts | 🟢 | ⚠️ (timeout/throttle sẵn — chưa có escalati | 1-2 tuần |
| [332-runtime-policy-enforcement.md](332-runtime-policy-enforcement.md) | LT: Runtime Policy Enforcement | 🟡 | ⚠️ (permissions/validation sẵn — chưa có dy | 1.5-2.5 tuần |

### Nhóm 103: Data Ops (Vòng 87)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [333-data-versioning.md](333-data-versioning.md) | LU: Data Versioning | 🟡 | ❌ (eval log sẵn — chưa có dataset versioni | 1.5-2.5 tuần |
| [334-synthetic-data-quality.md](334-synthetic-data-quality.md) | LV: Synthetic Data Quality | 🟡 | ❌ (eval framework sẵn — chưa có synthetic  | 1.5-2.5 tuần |
| [335-feedback-flywheel.md](335-feedback-flywheel.md) | LW: Feedback Flywheel | 🟡 | ⚠️ (eval/correction log sẵn — chưa có feedb | 2-3 tuần |

### Nhóm 104: Tool Ecosystem (Vòng 88)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [336-tool-discovery-gateway.md](336-tool-discovery-gateway.md) | LX: Tool Discovery Gateway | 🟡 | ⚠️ (tool-registry sẵn — chưa có multi-sourc | 1.5-2.5 tuần |
| [337-context-tool-reco.md](337-context-tool-reco.md) | LY: Context-Aware Tool Recommendation | 🟡 | ❌ (tool list sẵn — chưa có context-based r | 1.5-2.5 tuần |
| [338-tool-usage-insights.md](338-tool-usage-insights.md) | LZ: Tool Usage Insights | 🟢 | ⚠️ (audit log/telemetry sẵn — chưa có patte | 1-2 tuần |

### Nhóm 105: Comm Protocols (Vòng 89)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [339-agent-middleware.md](339-agent-middleware.md) | MA: Agent Middleware | 🟡 | ⚠️ (agent loop sẵn — chưa có pluggable midd | 1-2 tuần |
| [340-event-schema-registry.md](340-event-schema-registry.md) | MB: Event Schema Registry | 🟡 | ⚠️ (event-sourcing sẵn — chưa có schema reg | 1.5-2.5 tuần |
| [341-async-req-reply.md](341-async-req-reply.md) | MC: Async Request-Reply | 🟡 | ⚠️ (agent messaging sẵn — chưa có correlati | 1-2 tuần |

### Nhóm 106: Output Quality (Vòng 90)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [342-output-quality-pipeline.md](342-output-quality-pipeline.md) | MD: Output Quality Pipeline | 🟢 | ⚠️ (validation/guardrail sẵn — chưa có stru | 1-2 tuần |
| [343-answer-relevance-score.md](343-answer-relevance-score.md) | ME: Answer Relevance Score | 🟢 | ❌ (eval framework sẵn — chưa có relevance/ | 1-2 tuần |
| [344-citation-health-check.md](344-citation-health-check.md) | MF: Citation Health Check | 🟢 | ❌ (output ready — chưa có citation validat | 0.5-1.5 tuần |

### Nhóm 107: Synthesis (Vòng 91)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [345-adaptive-goal-priorities.md](345-adaptive-goal-priorities.md) | MG: Adaptive Goal Priorities | 🟡 | ⚠️ (task decomposition sẵn — chưa có dynami | 2-3 tuần |
| [346-slow-fast-reasoning.md](346-slow-fast-reasoning.md) | MH: Slow-Fast Reasoning | 🟡 | ⚠️ (CoT/step-back sẵn — chưa có dual-system | 1.5-2.5 tuần |
| [347-privacy-budget-agent.md](347-privacy-budget-agent.md) | MI: Privacy Budget Agent | 🟡 | ⚠️ (data-minimization/classification sẵn —  | 2-3 tuần |

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







































### Nhóm — B1: Code & Memory (Phần B — khảo sát source/)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [348-ast-code-knowledge-graph.md](348-ast-code-knowledge-graph.md) | MJ: AST Code Knowledge Graph | 🟡 | ⚠️ (code-index.ts semantic embeddings | 3-4 tuần |
| [349-synthesis-with-gap-analysis.md](349-synthesis-with-gap-analysis.md) | MK: Synthesis with Gap Analysis | 🟡 | ⚠️ (retrieval + grounding + conflict | 2-3 tuần |
| [350-agent-session-history-indexing.md](350-agent-session-history-indexing.md) | ML: Agent Session History Indexing | 🟡 | ⚠️ (SQLite store + event-stream + rag | 2-3 tuần |
| [351-append-only-memory-accumulation.md](351-append-only-memory-accumulation.md) | MM: Append-Only Memory Accumulation | 🟡 | ⚠️ (memory store + graph + lifecycle | 3-4 tuần |
| [352-memory-confidence-scoring.md](352-memory-confidence-scoring.md) | MN: Memory Confidence Scoring | 🟡 | ⚠️ (lifecycle.ts + weibull.ts + confl | 2-3 tuần |
| [353-memory-state-versioning.md](353-memory-state-versioning.md) | MO: Memory State Versioning | 🟡 | ⚠️ (brain-store + SQLite sẵn — chưa c | 2-3 tuần |
| [354-attention-based-memory-decay.md](354-attention-based-memory-decay.md) | MP: Attention-Based Memory Decay | 🟡 | ⚠️ (lifecycle.ts Ebbinghaus decay + w | 2-3 tuần |
| [355-memory-provenance-traceability.md](355-memory-provenance-traceability.md) | MQ: Memory Provenance Traceability | 🟡 | ⚠️ (graph.ts + grounding.ts + audit s | 2-3 tuần |
| [356-time-aware-memory-retrieval.md](356-time-aware-memory-retrieval.md) | MR: Time-Aware Memory Retrieval | 🟢 | ⚠️ (retrieve.ts + lifecycle decay + w | 1-2 tuần |
| [357-entity-trajectory-scoring.md](357-entity-trajectory-scoring.md) | MS: Entity Trajectory Scoring | 🟡 | ⚠️ (graph.ts entity nodes + lifecycle | 2-3 tuần |
| [358-execution-trace-world-modeling.md](358-execution-trace-world-modeling.md) | MT: Execution Trace World Modeling | 🟡 | ⚠️ (world-model 239 + dream-cycle + t | 4-6 tuần |

### Nhóm — B2: Context & Token (Phần B — khảo sát source/)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [359-content-type-aware-compression.md](359-content-type-aware-compression.md) | MU: Content-Type-Aware Compression | 🟡 | ⚠️ (100 prompt-compression + 218 tool | 1.5-2 tuần |
| [360-model-output-token-shaping.md](360-model-output-token-shaping.md) | MV: Model Output Token Shaping | 🟢 | ⚠️ (307 verbosity-adapt + 346 slow-fa | 1-1.5 tuần |
| [361-cache-prefix-preserving-compression.md](361-cache-prefix-preserving-compression.md) | MW: Cache-Prefix-Preserving Compression | 🟡 | ⚠️ (166 prompt-caching-layer + 191 kv | 1.5-2 tuần |
| [362-event-sourced-session-continuity.md](362-event-sourced-session-continuity.md) | MX: Event-Sourced Session Continuity | 🟡 | ⚠️ (230 event-sourcing-outbox + 242 m | 2-3 tuần |
| [363-programmatic-context-mining.md](363-programmatic-context-mining.md) | MY: Programmatic Context Mining | 🟡 | ⚠️ (133 agent-sandbox + 179 agent-tes | 2-2.5 tuần |
| [364-fetch-index-then-search.md](364-fetch-index-then-search.md) | MZ: Fetch-Index-Then-Search | 🟢 | ⚠️ (217 web-browsing + 223 web-search | 1.5-2 tuần |
| [365-deterministic-command-reducers.md](365-deterministic-command-reducers.md) | NA: Deterministic Command Reducers | 🟢 | ⚠️ (218 tool-output-compression sẵn — | 1.5-2 tuần |
| [366-seamless-compaction-continuity.md](366-seamless-compaction-continuity.md) | NB: Seamless Compaction Continuity | 🟡 | ⚠️ (121 long-context + 182 conversati | 2-2.5 tuần |
| [367-designated-scratchpad.md](367-designated-scratchpad.md) | NC: Designated Scratchpad | 🟢 | ⚠️ (133 agent-sandbox + filesystem to | 0.5-1 tuần |

### Nhóm — B3: Editing & Workflow (Phần B — khảo sát source/)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [368-hash-anchored-editing.md](368-hash-anchored-editing.md) | ND: Hash-Anchored Editing | 🟡 | ⚠️ (edit tool sẵn — chưa có hash-anch | 2-3 tuần |
| [369-mandatory-undo-precondition.md](369-mandatory-undo-precondition.md) | NE: Mandatory Undo Precondition | 🟡 | ⚠️ (edit tool + git sẵn — chưa có pre | 1-2 tuần |
| [370-read-tracked-edit-guard.md](370-read-tracked-edit-guard.md) | NF: Read-Tracked Edit Guard | 🟡 | ⚠️ (read tool + edit tool sẵn — chưa | 2 tuần |
| [371-impact-cascade-diagnostics.md](371-impact-cascade-diagnostics.md) | NG: Impact Cascade Diagnostics | 🟡 | ⚠️ (edit + diagnostics sẵn — chưa có | 3-4 tuần |
| [372-diagnostic-triage-dispositions.md](372-diagnostic-triage-dispositions.md) | NH: Diagnostic Triage Dispositions | 🟢 | ⚠️ (diagnostics sẵn — chưa có disposi | 2 tuần |
| [373-plan-as-branch-workflow.md](373-plan-as-branch-workflow.md) | NI: Plan-as-Branch Workflow | 🟡 | ⚠️ (git + agent-loop sẵn — chưa có pl | 2-3 tuần |
| [374-conditional-rule-loading.md](374-conditional-rule-loading.md) | NJ: Conditional Rule Loading | 🟡 | ⚠️ (system prompt injection sẵn — chư | 2 tuần |
| [375-differential-workflow-resume.md](375-differential-workflow-resume.md) | NK: Differential Workflow Resume | 🟡 | ⚠️ (subagent + workflow sẵn — chưa có | 3-4 tuần |
| [376-model-tier-routing.md](376-model-tier-routing.md) | NL: Model Tier Routing | 🟢 | ⚠️ (model config sẵn — chưa có per-ca | 2 tuần |
| [377-tool-execution-order-preservation.md](377-tool-execution-order-preservation.md) | NM: Tool Execution Order Preservation | 🟡 | ⚠️ (parallel tool calls sẵn — chưa có | 2 tuần |
| [378-single-writer-session-lease.md](378-single-writer-session-lease.md) | NN: Single-Writer Session Lease | 🟢 | ⚠️ (session JSONL sẵn — chưa có lease | 2 tuần |
| [379-workflow-keyword-triggering.md](379-workflow-keyword-triggering.md) | NO: Workflow Keyword Triggering | 🟢 | ⚠️ (intent routing sẵn — chưa có keyw | 1-2 tuần |
| [380-context-filesystem-abstraction.md](380-context-filesystem-abstraction.md) | NP: Context Filesystem Abstraction | 🟡 | ⚠️ (memory + file tools sẵn — chưa có | 3-4 tuần |

### Nhóm — B4: Multi-agent & Platform (Phần B — khảo sát source/)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [381-inter-session-message-broker.md](381-inter-session-message-broker.md) | NQ: Inter-Session Message Broker | 🟢 | ✅ (packages/intercom đã có broker + | 0.5-1 tuần (đã có — tài liệu hóa + mở rộng) |
| [382-structured-escalation-protocol.md](382-structured-escalation-protocol.md) | NR: Structured Escalation Protocol | 🟢 | ✅ (packages/intercom đã có contact_s | 0.5 tuần (đã có — tài liệu hóa) |
| [383-omnichannel-agent-gateway.md](383-omnichannel-agent-gateway.md) | NS: Omnichannel Agent Gateway | 🟡 | ⚠️ (gateway + channel-adapters sẵn — | 3-5 tuần |
| [384-agent-daemon-lifecycle.md](384-agent-daemon-lifecycle.md) | NT: Agent Daemon Lifecycle | 🟡 | ⚠️ (cron + lifecycle-hooks sẵn — chưa | 2-3 tuần |
| [385-meeting-presence-agents.md](385-meeting-presence-agents.md) | NU: Meeting Presence Agents | 🟡 | ⚠️ (tts + memory sẵn — chưa có meetin | 4-6 tuần |
| [386-privacy-mode-enforcement.md](386-privacy-mode-enforcement.md) | NV: Privacy Mode Enforcement | 🟡 | ⚠️ (privacy-budget + data-minimizatio | 3-4 tuần |
| [387-agent-blocked-signaling.md](387-agent-blocked-signaling.md) | NW: Agent Blocked Signaling | 🟢 | ⚠️ (print/TUI + lifecycle-hooks sẵn — | 1.5-2 tuần |
| [388-skill-lifecycle-curation.md](388-skill-lifecycle-curation.md) | NX: Skill Lifecycle Curation | 🟡 | ⚠️ (packages/skills sẵn — chưa có usa | 2-3 tuần |
| [389-agent-environment-hibernation.md](389-agent-environment-hibernation.md) | NY: Agent Environment Hibernation | 🟡 | ⚠️ (lifecycle-hooks + memory sẵn — ch | 2-3 tuần |
| [390-low-cost-agent-triggers.md](390-low-cost-agent-triggers.md) | NZ: Low-Cost Agent Triggers | 🟢 | ⚠️ (cron + lifecycle-hooks sẵn — chưa | 1.5-2 tuần |

### Nhóm — B5: UI · Auth · Trust · Research (Phần B — khảo sát source/)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [391-biometric-agent-gate.md](391-biometric-agent-gate.md) | OA: Biometric Agent Gate | 🟢 | ⚠️ (desktop + rpc + permission-prompt | 2-3 tuần |
| [392-trust-scoped-context-blocks.md](392-trust-scoped-context-blocks.md) | OB: Trust-Scoped Context Blocks | 🟡 | ⚠️ (context assembly + message types | 2-3 tuần |
| [393-dual-channel-agent-communication.md](393-dual-channel-agent-communication.md) | OC: Dual-Channel Agent Communication | 🟢 | ⚠️ (streaming + print/TUI sẵn — chưa | 1.5-2 tuần |
| [394-safeguard-model-tiering.md](394-safeguard-model-tiering.md) | OD: Safeguard Model Tiering | 🟡 | ⚠️ (model-cascade + tier-routing sẵn | 2-3 tuần |
| [395-minimal-code-ladder.md](395-minimal-code-ladder.md) | OE: Minimal Code Ladder | 🟢 | ⚠️ (codebase search + tool registry s | 1-2 tuần |
| [396-repository-graph-planning.md](396-repository-graph-planning.md) | OF: Repository Graph Planning | 🟡 | ⚠️ (file-watcher + symbol search sẵn | 3-4 tuần |
| [397-adaptive-topology-search.md](397-adaptive-topology-search.md) | OG: Adaptive Topology Search | 🟡 | ⚠️ (subagent + workflows sẵn — chưa c | 3-4 tuần |
| [398-test-gated-convergence.md](398-test-gated-convergence.md) | OH: Test-Gated Convergence | 🟢 | ⚠️ (tool-test-harness + test runner s | 1.5-2 tuần |
| [399-rl-from-execution-feedback.md](399-rl-from-execution-feedback.md) | OI: RL from Execution Feedback | 🟡 | ⚠️ (tool-test-harness + eval sẵn — ch | 6-8 tuần |
| [400-harness-as-distillation-surface.md](400-harness-as-distillation-surface.md) | OJ: Harness as Distillation Surface | 🟡 | ⚠️ (eval + test-harness sẵn — chưa có | 5-7 tuần |
| [401-observability-driven-harness.md](401-observability-driven-harness.md) | OK: Observability-Driven Harness | 🟡 | ⚠️ (eval + tool-test-harness + lifecy | 4-5 tuần |
| [402-request-type-authorization.md](402-request-type-authorization.md) | OL: Request Type Authorization | 🟢 | ⚠️ (permission-prompt + dynamic-permi | 2-3 tuần |


### Nhóm — C1: Memory & Graph (403-420)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [403-windowed-history-retrieval.md](403-windowed-history-retrieval.md) | OM: Windowed History Retrieval | 🟢 | ⚠️ (session-history + memory retrieva | 1-2 tuần |
| [404-entity-query-expansion.md](404-entity-query-expansion.md) | ON: Entity Query Expansion | 🟢 | ⚠️ (entity-extraction + entity-store | 2 tuần |
| [405-bm25-entity-boost-fusion.md](405-bm25-entity-boost-fusion.md) | OO: BM25 Entity Boost Fusion | 🟢 | ⚠️ (hybrid-search + reranking sẵn — c | 2 tuần |
| [406-near-duplicate-gc.md](406-near-duplicate-gc.md) | OP: Near-Duplicate GC | 🟢 | ⚠️ (memory-add + conflict-merge sẵn — | 1-2 tuần |
| [407-add-v3-phased-commit.md](407-add-v3-phased-commit.md) | OQ: Add v3 Phased Commit | 🟡 | ⚠️ (memory-add + entity-extraction sẵ | 3-4 tuần |
| [408-provider-vector-plan-swap.md](408-provider-vector-plan-swap.md) | OR: Provider Vector Plan Swap | 🟡 | ⚠️ (provider-config + embedding sẵn — | 2-3 tuần |
| [409-slotted-memory-schema.md](409-slotted-memory-schema.md) | OS: Slotted Memory Schema | 🟡 | ⚠️ (memory-store + structured-output | 2-3 tuần |
| [410-pre-tool-context-injection.md](410-pre-tool-context-injection.md) | OT: Pre-Tool Context Injection | 🟡 | ⚠️ (lifecycle-hooks + tool-dispatch s | 2-3 tuần |
| [411-hot-cold-epistemic-tiers.md](411-hot-cold-epistemic-tiers.md) | OU: Hot-Cold Epistemic Tiers | 🟡 | ⚠️ (hierarchical-memory + decay sẵn — | 3 tuần |
| [412-dream-cycle-consolidation.md](412-dream-cycle-consolidation.md) | OV: Dream Cycle Consolidation | 🟡 | ⚠️ (scheduled-agents + memory-store s | 3-4 tuần |
| [413-knowledge-kind-typology.md](413-knowledge-kind-typology.md) | OW: Knowledge Kind Typology | 🟡 | ⚠️ (confidence-scoring + memory-store | 3 tuần |
| [414-holder-attributed-confidence.md](414-holder-attributed-confidence.md) | OX: Holder Attributed Confidence | 🟡 | ⚠️ (confidence-scoring + provenance s | 2-3 tuần |
| [415-time-travel-snapshot-query.md](415-time-travel-snapshot-query.md) | OY: Time-Travel Snapshot Query | 🟡 | ⚠️ (memory-state-versioning + tempora | 3-4 tuần |
| [416-ontology-schema-packs.md](416-ontology-schema-packs.md) | OZ: Ontology Schema Packs | 🟡 | ⚠️ (AST-KG + knowledge-graph sẵn — ch | 3 tuần |
| [417-per-identity-memory-drift.md](417-per-identity-memory-drift.md) | PA: Per-Identity Memory Drift | 🟡 | ⚠️ (delegated-identity + multi-tenanc | 3 tuần |
| [418-file-watch-incremental-graph.md](418-file-watch-incremental-graph.md) | PB: File-Watch Incremental Graph | 🟡 | ⚠️ (file-watcher + repo-graph sẵn — c | 3-4 tuần |
| [419-context-aware-inference-layer.md](419-context-aware-inference-layer.md) | PC: Context-Aware Inference Layer | 🟡 | ⚠️ (repo-graph + context-engineering | 3 tuần |
| [420-cross-platform-runtime-adapters.md](420-cross-platform-runtime-adapters.md) | PD: Cross-Platform Runtime Adapters | 🟡 | ⚠️ (interop protocols + transports sẵ | 4-5 tuần |

### Nhóm — C2: Session & Workflow (421-438)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [421-tiered-review-agent-pipeline.md](421-tiered-review-agent-pipeline.md) | PE: Tiered Review Agent Pipeline | 🟡 | ⚠️ (codebase-memory-mcp graph + impac | 2-3 tuần |
| [422-deterministic-context-compactor.md](422-deterministic-context-compactor.md) | PF: Deterministic Context Compactor | 🟢 | ⚠️ (summarize + rank + merge sẵn tron | 1.5-2 tuần |
| [423-lineage-scoped-recall.md](423-lineage-scoped-recall.md) | PG: Lineage-Scoped Recall | 🟢 | ⚠️ (lineage.ts + recall-scope.ts sẵn | 1-1.5 tuần |
| [424-cross-agent-session-library.md](424-cross-agent-session-library.md) | PH: Cross-Agent Session Library | 🟡 | ⚠️ (pi-session-manager dataset cache | 2-2.5 tuần |
| [425-session-branch-tree-reconstruction.md](425-session-branch-tree-reconstruction.md) | PI: Session Branch Tree Reconstruction | 🟢 | ⚠️ (entry parsing với parentId/parent | 1-1.5 tuần |
| [426-workflow-call-index-journaling.md](426-workflow-call-index-journaling.md) | PJ: Workflow Call-Index Journaling | 🟡 | ⚠️ (workflow.ts journal + resume + fi | 2-2.5 tuần |
| [427-orchestrator-determinism-realm.md](427-orchestrator-determinism-realm.md) | PK: Orchestrator Determinism Realm | 🟡 | ⚠️ (DETERMINISM_PRELUDE sẵn trong pi- | 1-1.5 tuần |
| [428-idle-gated-session-messaging.md](428-idle-gated-session-messaging.md) | PL: Idle-Gated Session Messaging | 🟡 | ⚠️ (pi-intercom lifecycleStatus + inb | 1.5-2 tuần |
| [429-warm-fresh-dual-analysis-server.md](429-warm-fresh-dual-analysis-server.md) | PM: Warm-Fresh Dual Analysis Server | 🟡 | ⚠️ (pi-lens warm-attach + cold/warm r | 2-2.5 tuần |
| [430-cold-warm-ipc-sidechannel-routing.md](430-cold-warm-ipc-sidechannel-routing.md) | PN: Cold-Warm IPC Sidechannel Routing | 🟡 | ⚠️ (pi-lens IPC path + request/respon | 1.5-2 tuần |
| [431-verified-ui-action-transition.md](431-verified-ui-action-transition.md) | PO: Verified UI Action Transition | 🟡 | ⚠️ (pi-computer-use prepareAction + v | 2-3 tuần |
| [432-agent-prompt-cache-miss-attribution.md](432-agent-prompt-cache-miss-attribution.md) | PP: Agent Prompt Cache-Miss Attribution | 🟢 | ⚠️ (cacheRead field + cost.ts 50% rul | 1-1.5 tuần |
| [433-agent-branch-summarization-backfill.md](433-agent-branch-summarization-backfill.md) | PQ: Agent Branch Summarization Backfill | 🟢 | ⚠️ (branch_summary entry type + pi-vc | 1.5-2 tuần |
| [434-server-snapshot-broadcast.md](434-server-snapshot-broadcast.md) | PR: Server Snapshot Broadcast | 🟡 | ⚠️ (gateway multi-connection + event | 1.5-2 tuần |
| [435-session-log-config-entry-scope.md](435-session-log-config-entry-scope.md) | PS: Session Log Config Entry Scope | 🟢 | ⚠️ (JSONL entry format + toolCallId l | 0.5-1 tuần |
| [436-openclaw-commitments.md](436-openclaw-commitments.md) | PT: Openclaw Commitments | 🟡 | ⚠️ (openclaw commitments module sẵn — | 2-2.5 tuần |
| [437-openclaw-standing-orders.md](437-openclaw-standing-orders.md) | PU: Openclaw Standing Orders | 🟡 | ⚠️ (openclaw persisted config + exec- | 2-2.5 tuần |
| [438-openclaw-parallel-specialist-lanes.md](438-openclaw-parallel-specialist-lanes.md) | PV: Openclaw Parallel Specialist Lanes | 🟡 | ⚠️ (openclaw lanes + subagent-spawn s | 2-3 tuần |

### Nhóm — C3: Platform & Ops (439-456)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [439-openclaw-queue-steering.md](439-openclaw-queue-steering.md) | PW: Queue Steering | 🟢 | ⚠️ (agent-loop + message queue sẵn — | 2-3 tuần |
| [440-openclaw-active-memory-recall-subagent.md](440-openclaw-active-memory-recall-subagent.md) | PX: Active Memory Recall Subagent | 🟡 | ⚠️ (subagent + memory query sẵn — chư | 2-3 tuần |
| [441-openclaw-dreaming-sleep-phases.md](441-openclaw-dreaming-sleep-phases.md) | PY: Dreaming Sleep Phases | 🟡 | ⚠️ (memory-consolidation sẵn — chưa c | 3-4 tuần |
| [442-openclaw-progress-drafts.md](442-openclaw-progress-drafts.md) | PZ: Progress Drafts | 🟢 | ⚠️ (message editing + streaming sẵn — | 1-2 tuần |
| [443-openclaw-managed-worktrees.md](443-openclaw-managed-worktrees.md) | QA: Managed Worktrees | 🟡 | ⚠️ (git tools + bash sẵn — chưa có wo | 2-3 tuần |
| [444-openclaw-channel-docking.md](444-openclaw-channel-docking.md) | QB: Channel Docking | 🟡 | ⚠️ (session store + transport layer s | 2-3 tuần |
| [445-openclaw-resumable-approval-pipeline.md](445-openclaw-resumable-approval-pipeline.md) | QC: Resumable Approval Pipeline | 🟡 | ⚠️ (tool execution + permission-promp | 3-4 tuần |
| [446-openhuman-subconscious-steering.md](446-openhuman-subconscious-steering.md) | QD: Subconscious Steering | 🟡 | ⚠️ (system-prompt + background loop s | 2-3 tuần |
| [447-openhuman-goal-reflection-agent.md](447-openhuman-goal-reflection-agent.md) | QE: Goal Reflection Agent | 🟡 | ⚠️ (subagent + memory sẵn — chưa có g | 2-3 tuần |
| [448-openhuman-idle-thread-continuation.md](448-openhuman-idle-thread-continuation.md) | QF: Idle Thread Continuation | 🟡 | ⚠️ (agent-loop + scheduler sẵn — chưa | 2-3 tuần |
| [449-openhuman-command-class-gate.md](449-openhuman-command-class-gate.md) | QG: Command Class Gate | 🟢 | ⚠️ (permission-prompt + dynamic-permi | 2-3 tuần |
| [450-openhuman-agent-proposed-workflow.md](450-openhuman-agent-proposed-workflow.md) | QH: Agent Proposed Workflow | 🟡 | ⚠️ (workflows package + dynamic-workf | 3-4 tuần |
| [451-openhuman-memory-diff-readmarker.md](451-openhuman-memory-diff-readmarker.md) | QI: Memory Diff Readmarker | 🟡 | ⚠️ (memory store + git tools sẵn — ch | 2-3 tuần |
| [452-inter-client-user-message-envelope.md](452-inter-client-user-message-envelope.md) | QJ: Inter-Client User Message Envelope | 🟡 | ⚠️ (transport + message handling sẵn | 2-3 tuần |
| [453-herdr-screen-manifest-agent-state.md](453-herdr-screen-manifest-agent-state.md) | QK: Screen Manifest Agent State | 🟡 | ⚠️ (terminal/PTY + regex sẵn — chưa c | 2-3 tuần |
| [454-oh-my-pi-stream-abort-rule-injection.md](454-oh-my-pi-stream-abort-rule-injection.md) | QL: Stream Abort Rule Injection | 🟡 | ⚠️ (streaming + system-reminder sẵn — | 2-3 tuần |
| [455-oh-my-pi-fuzzy-kernel-tool-reentry.md](455-oh-my-pi-fuzzy-kernel-tool-reentry.md) | QM: Fuzzy Kernel Tool Reentry | 🟡 | ⚠️ (code-exec tool + kernel sẵn — chư | 3-4 tuần |
| [456-oh-my-pi-lsp-wired-edits.md](456-oh-my-pi-lsp-wired-edits.md) | QN: LSP Wired Edits | 🟡 | ⚠️ (edit tool + file ops sẵn — chưa c | 3-4 tuần |

### Nhóm — C4: Debugging & Context (457-474)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [457-oh-my-pi-dap-driven-debugging.md](457-oh-my-pi-dap-driven-debugging.md) | QO: DAP-Driven Debugging | 🟡 | ⚠️ (packages/dap + dap-server sẵn — c | 3-4 tuần |
| [458-oh-my-pi-advisor-second-model.md](458-oh-my-pi-advisor-second-model.md) | QP: Advisor Second-Model | 🟡 | ⚠️ (packages/council multi-model + 07 | 3-4 tuần |
| [459-oh-my-pi-conflict-uri-resolution.md](459-oh-my-pi-conflict-uri-resolution.md) | QQ: Conflict URI Resolution | 🟡 | ⚠️ (read/edit/apply-patch sẵn — chưa | 2-3 tuần |
| [460-oh-my-pi-atomic-commit-splitting.md](460-oh-my-pi-atomic-commit-splitting.md) | QR: Atomic Commit Splitting | 🟢 | ⚠️ (bash git + edit sẵn — chưa có dif | 2-3 tuần |
| [461-oh-my-pi-collab-session-relay.md](461-oh-my-pi-collab-session-relay.md) | QS: Collab Session Relay | 🟡 | ⚠️ (packages/collab relay + intercom | 3-4 tuần |
| [462-hermes-incremental-micro-compaction.md](462-hermes-incremental-micro-compaction.md) | QT: Incremental Micro-Compaction | 🟡 | ⚠️ (memory + context-window manager s | 2-3 tuần |
| [463-openviking-typed-query-retrieval.md](463-openviking-typed-query-retrieval.md) | QU: Typed Query Retrieval | 🟢 | ⚠️ (find/grep + search-index sẵn — ch | 2-3 tuần |
| [464-mya-v1-hardware-peripheral-tools.md](464-mya-v1-hardware-peripheral-tools.md) | QV: Hardware Peripheral Tools | 🟡 | ❌ (chưa có Peripheral trait — cần Ru | 5-6 tuần |
| [465-fff-frequency-ranked-fuzzy-finder.md](465-fff-frequency-ranked-fuzzy-finder.md) | QW: Frequency-Ranked Fuzzy Finder | 🟢 | ⚠️ (find + fuzzy-score sẵn — chưa có | 1-2 tuần |
| [466-context-citation-attribution.md](466-context-citation-attribution.md) | QX: Context Citation Attribution | 🟢 | ⚠️ (memory + trajectory sẵn — chưa có | 2-3 tuần |
| [467-staged-memory-writes.md](467-staged-memory-writes.md) | QY: Staged Memory Writes | 🟡 | ⚠️ (packages/memory brain-store sẵn — | 3-4 tuần |
| [468-text-embedded-ui-directives.md](468-text-embedded-ui-directives.md) | QZ: Text-Embedded UI Directives | 🟢 | ⚠️ (output stream + bash git sẵn — ch | 2-3 tuần |
| [469-terminal-state-as-files.md](469-terminal-state-as-files.md) | RA: Terminal State as Files | 🟢 | ⚠️ (bash tool + terminal session sẵn | 1-2 tuần |
| [470-runtime-transition-reminders.md](470-runtime-transition-reminders.md) | RB: Runtime Transition Reminders | 🟢 | ⚠️ (system prompt + context builder s | 1-2 tuần |
| [471-phase-topics-broadcast.md](471-phase-topics-broadcast.md) | RC: Phase Topics Broadcast | 🟢 | ⚠️ (lifecycle-hooks + progress sẵn — | 1-2 tuần |
| [472-jittered-bounded-scheduling.md](472-jittered-bounded-scheduling.md) | RD: Jittered Bounded Scheduling | 🟢 | ⚠️ (packages/cron cron-store sẵn — ch | 2-3 tuần |
| [473-permission-allowlist-mining.md](473-permission-allowlist-mining.md) | RE: Permission Allowlist Mining | 🟢 | ⚠️ (124 dynamic-permissions + traject | 2-3 tuần |
| [474-fuzzy-code-emulator.md](474-fuzzy-code-emulator.md) | RF: Fuzzy Code Emulator | 🟡 | ❌ (chưa có code emulator — cần parse | 4-5 tuần |

### Nhóm — C5: Compression & Search (475-492)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [475-plan-after-trial.md](475-plan-after-trial.md) | RG: Plan-After-Trial | 🟡 | ⚠️ (agent loop + tool exec sẵn — chưa | 2-3 tuần |
| [476-fuzzer-crash-feedback.md](476-fuzzer-crash-feedback.md) | RH: Fuzzer Crash Feedback | 🟡 | ⚠️ (code-exec + test runner sẵn — chư | 3-4 tuần |
| [477-agent-out-of-sync-recovery.md](477-agent-out-of-sync-recovery.md) | RI: Agent Out-of-Sync Recovery | 🟡 | ⚠️ (session state + context sẵn — chư | 3-4 tuần |
| [478-transactional-action-sandbox.md](478-transactional-action-sandbox.md) | RJ: Transactional Action Sandbox | 🟡 | ⚠️ (FS tools + edit sẵn — chưa có tra | 3-4 tuần |
| [479-server-side-tool-profiles.md](479-server-side-tool-profiles.md) | RK: Server-Side Tool Profiles | 🟢 | ⚠️ (MCP tool registry sẵn — chưa có t | 2-3 tuần |
| [480-thread-scoped-worktree.md](480-thread-scoped-worktree.md) | RL: Thread-Scoped Worktree | 🟡 | ⚠️ (session/branch sẵn — chưa có work | 3-4 tuần |
| [481-decision-complete-plan-contract.md](481-decision-complete-plan-contract.md) | RM: Decision-Complete Plan Contract | 🟡 | ⚠️ (plan/TODO tracking + tool-gate sẵ | 2-3 tuần |
| [482-memory-index-in-context.md](482-memory-index-in-context.md) | RN: Memory Index In-Context | 🟡 | ⚠️ (hierarchical/slotted memory sẵn — | 1.5-2 tuần |
| [483-session-resume-category-snapshot.md](483-session-resume-category-snapshot.md) | RO: Session-Resume Category Snapshot | 🟢 | ⚠️ (session event tracking + compacti | 2-3 tuần |
| [484-per-agent-context-search-throttle.md](484-per-agent-context-search-throttle.md) | RP: Per-Agent-Context Search Throttle | 🟢 | ⚠️ (search/MCP sẵn — chưa có per-agen | 1-1.5 tuần |
| [485-out-of-band-byte-marker-bridge.md](485-out-of-band-byte-marker-bridge.md) | RQ: Out-Of-Band Byte Marker Bridge | 🟢 | ⚠️ (PostToolUse hook + telemetry sẵn | 1 tuần |
| [486-soft-shell-exit-classifier.md](486-soft-shell-exit-classifier.md) | RR: Soft-Shell-Exit Classifier | 🟢 | ⚠️ (bash/exec tool + exit-code handli | 0.5-1 tuần |
| [487-real-conversation-import-gate.md](487-real-conversation-import-gate.md) | RS: Real-Conversation Import Gate | 🟢 | ⚠️ (session import/library sẵn — chưa | 1-1.5 tuần |
| [488-transcript-retention-policy.md](488-transcript-retention-policy.md) | RT: Transcript Retention Policy | 🟢 | ⚠️ (history/store + token tracking sẵ | 1.5-2 tuần |
| [489-deterministic-rollup-semantic-corpus.md](489-deterministic-rollup-semantic-corpus.md) | RU: Deterministic Rollup Semantic Corpus | 🟢 | ⚠️ (semantic search/indexing sẵn — ch | 2-3 tuần |
| [490-readiness-gated-search-freshness.md](490-readiness-gated-search-freshness.md) | RV: Readiness-Gated Search Freshness | 🟡 | ⚠️ (search + indexing sẵn — chưa có d | 2-3 tuần |
| [491-cache-invalidation-aware-compression.md](491-cache-invalidation-aware-compression.md) | RW: Cache-Invalidation-Aware Compression | 🟡 | ⚠️ (361 MW cache-prefix-preserving + | 2-3 tuần |
| [492-auth-tiered-compression-policy.md](492-auth-tiered-compression-policy.md) | RX: Auth-Tiered Compression Policy | 🟡 | ⚠️ (359 MU content-type + 361 MW cach | 2-3 tuần |

### Nhóm — C6: Guard & Safety (493-510)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [493-reversible-context-compression.md](493-reversible-context-compression.md) | RY: Reversible Context Compression | 🟡 | ⚠️ (packages/ai LLM client + context- | 2-3 tuần |
| [494-holdout-control-savings-accounting.md](494-holdout-control-savings-accounting.md) | RZ: Holdout-Control Savings Accounting | 🟢 | ⚠️ (packages/ai compressor + budget t | 1-2 tuần |
| [495-never-worse-output-guard.md](495-never-worse-output-guard.md) | SA: Never-Worse Output Guard | 🟢 | ⚠️ (packages/ai compressor sẵn — chưa | 0.5-1 tuần |
| [496-tee-full-output-recovery-hint.md](496-tee-full-output-recovery-hint.md) | SB: Tee Full-Output Recovery Hint | 🟢 | ⚠️ (packages/ai compressor + session | 1-2 tuần |
| [497-project-filter-trust-records.md](497-project-filter-trust-records.md) | SC: Project Filter Trust Records | 🟡 | ⚠️ (packages/ai compressor + config l | 2-3 tuần |
| [498-compression-attribution-footer.md](498-compression-attribution-footer.md) | SD: Compression Attribution Footer | 🟢 | ⚠️ (packages/ai compressor sẵn — chưa | 1 tuần |
| [499-user-proficiency-adaptive-communication.md](499-user-proficiency-adaptive-communication.md) | SE: User Proficiency Adaptive Communication | 🟢 | ⚠️ (packages/agent system-prompt sẵn | 2 tuần |
| [500-harness-config-drift-detection.md](500-harness-config-drift-detection.md) | SF: Harness Config Drift Detection | 🟢 | ⚠️ (skill registry + AGENTS.md sẵn — | 1-2 tuần |
| [501-tool-argument-hallucination-guard.md](501-tool-argument-hallucination-guard.md) | SG: Tool Argument Hallucination Guard | 🟢 | ⚠️ (tool dispatcher + tool.meta schem | 1-2 tuần |
| [502-deferred-simplification-ledger.md](502-deferred-simplification-ledger.md) | SH: Deferred Simplification Ledger | 🟢 | ⚠️ (source tree + lint pipeline sẵn — | 1-2 tuần |
| [503-anti-slop-triage-taxonomy.md](503-anti-slop-triage-taxonomy.md) | SI: Anti-Slop Triage Taxonomy | 🟢 | ⚠️ (packages/ai LLM client sẵn — chưa | 1-2 tuần |
| [504-workspace-clone-session-partitioning.md](504-workspace-clone-session-partitioning.md) | SJ: Workspace Clone Session Partitioning | 🟢 | ⚠️ (session store + cwd tracking sẵn | 1 tuần |
| [505-runtime-api-key-rotation.md](505-runtime-api-key-rotation.md) | SK: Runtime API Key Rotation | 🟡 | ⚠️ (packages/ai LLM client + retry sẵ | 1-2 tuần |
| [506-multi-question-structured-picker.md](506-multi-question-structured-picker.md) | SL: Multi-Question Structured Picker | 🟢 | ⚠️ (packages/intercom interactive UI | 1-2 tuần |
| [507-truncated-tool-call-fail-closed.md](507-truncated-tool-call-fail-closed.md) | SM: Truncated Tool Call Fail-Closed | 🟢 | ⚠️ (LLM stream parsing + tool dispatc | 1 tuần |
| [508-session-html-export.md](508-session-html-export.md) | SN: Session HTML Export | 🟢 | ⚠️ (session store JSONL + CLI sẵn — c | 1-2 tuần |
| [509-per-file-mutation-queue.md](509-per-file-mutation-queue.md) | SO: Per-File Mutation Queue | 🟡 | ⚠️ (tool dispatcher + edit/write tool | 1-2 tuần |
| [510-plugin-abi-shadow-policy.md](510-plugin-abi-shadow-policy.md) | SP: Plugin ABI Shadow Policy | 🟡 | ⚠️ (plugin loader + tool registry sẵn | 1-2 tuần |

### Nhóm — C7: Platform & Retrieval (511-528)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [511-provider-ranking-attribution.md](511-provider-ranking-attribution.md) | SQ: Provider Ranking Attribution | 🟢 | ⚠️ (transport + headers sẵn — chưa có | 1-2 tuần |
| [512-agent-changed-file-git.md](512-agent-changed-file-git.md) | SR: Agent-Changed-File Git | 🟢 | ⚠️ (edit/write tools + IPC sẵn — chưa | 2-3 tuần |
| [513-sandboxed-script-trusted-host-split.md](513-sandboxed-script-trusted-host-split.md) | SS: Sandboxed-Script / Trusted-Host Split | 🟡 | ⚠️ (shell exec + worktree sẵn — chưa | 3-4 tuần |
| [514-preflight-static-model-resolution.md](514-preflight-static-model-resolution.md) | ST: Preflight Static Model Resolution | 🟢 | ⚠️ (model config + validation sẵn — c | 2-3 tuần |
| [515-hermes-scale-to-zero-cron.md](515-hermes-scale-to-zero-cron.md) | SU: Hermes Scale-to-Zero Cron | 🟢 | ❌ (cron/scheduler chưa có — cần exte | 3-4 tuần |
| [516-herdr-daemon-live-runtime-handoff.md](516-herdr-daemon-live-runtime-handoff.md) | SV: Herdr Daemon Live-Runtime Handoff | 🟡 | ❌ (chưa có FD-passing handoff + runt | 5-6 tuần |
| [517-openhuman-tool-scoped-memory-rules.md](517-openhuman-tool-scoped-memory-rules.md) | SW: Openhuman Tool-Scoped Memory Rules | 🟡 | ⚠️ (memory + tool policy sẵn — chưa c | 3-4 tuần |
| [518-gbrain-entity-create-safety-hint.md](518-gbrain-entity-create-safety-hint.md) | SX: Gbrain Entity-Create Safety Hint | 🟢 | ⚠️ (memory store + lookup sẵn — chưa | 2-3 tuần |
| [519-hermes-persisted-restart-loop-breaker.md](519-hermes-persisted-restart-loop-breaker.md) | SY: Hermes Persisted Restart-Loop Breaker | 🟢 | ❌ (chưa có boot-persist window + aut | 2-3 tuần |
| [520-hermes-cache-aware-review-fork-replay.md](520-hermes-cache-aware-review-fork-replay.md) | SZ: Hermes Cache-Aware Review Fork-Replay | 🟡 | ⚠️ (subagent + transcript sẵn — chưa | 3-4 tuần |
| [521-openhuman-ambient-window-context-capture.md](521-openhuman-ambient-window-context-capture.md) | TA: Openhuman Ambient Window-Context Capture | 🟡 | ❌ (chưa có ambient capture + OCR/vis | 4-5 tuần |
| [522-branch-atlas-session-tree-ui.md](522-branch-atlas-session-tree-ui.md) | TB: Branch-Atlas Session-Tree UI | 🟡 | ⚠️ (session/branch persist sẵn — chưa | 4-5 tuần |
| [523-code-community-detection.md](523-code-community-detection.md) | TC: Code Community Detection | 🟡 | ❌ (chưa có code-graph + Leiden commu | 3-4 tuần |
| [524-failure-derived-instruction-learning.md](524-failure-derived-instruction-learning.md) | TD: Failure-Derived Instruction Learning | 🟡 | ⚠️ (memory + review sẵn — chưa có fai | 3-4 tuần |
| [525-graph-edge-provenance-tags.md](525-graph-edge-provenance-tags.md) | TE: Graph-Edge Provenance Tags | 🟢 | ⚠️ (code-graph + symbol resolution sẵ | 2-3 tuần |
| [526-hybrid-lsp-semantic-resolution.md](526-hybrid-lsp-semantic-resolution.md) | TF: Hybrid LSP Semantic Resolution | 🟡 | ❌ (chưa có LSP integration + semanti | 4-5 tuần |
| [527-prewarmed-session-pool.md](527-prewarmed-session-pool.md) | TG: Prewarmed Session Pool | 🟡 | ⚠️ (session cache sẵn — chưa có prewa | 2-3 tuần |
| [528-retrieval-trajectory-inspection.md](528-retrieval-trajectory-inspection.md) | TH: Retrieval Trajectory Inspection | 🟢 | ❌ (chưa có retrieval-trajectory logg | 2-3 tuần |


### Nhóm — Phần D: 9arm-skills (529-531)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [529-cheap-model-delegation.md](529-cheap-model-delegation.md) | TI: Cheap Model Delegation | 🟢 | ⚠️ (subagent pool + spawnSubagent sẵn | 1-2 tuần |
| [530-clean-handoff-ritual.md](530-clean-handoff-ritual.md) | TJ: Clean Handoff Ritual | 🟢 | ⚠️ (session + spill + memory sẵn — ch | 1-2 tuần |
| [531-debug-mantra-discipline.md](531-debug-mantra-discipline.md) | TK: Debug Mantra Discipline | 🟢 | ✅ (skill system + system prompt sẵn | 0.5-1 tuần |

### Nhóm — Phần D: ClaudeSkills (532-538)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [532-routing-eval-cases.md](532-routing-eval-cases.md) | TL: Routing Eval Cases | 🟡 | ⚠️ (eval harness + ParityScenario sẵn | 1-2 tuần |
| [533-brief-full-delta-modes.md](533-brief-full-delta-modes.md) | TM: Brief / Full / Delta Modes | 🟢 | ⚠️ (eval harness + spill sẵn — chưa c | 1-2 tuần |
| [534-run-summary-observability.md](534-run-summary-observability.md) | TN: Run Summary Observability | 🟢 | ⚠️ (telemetry + audit log sẵn — chưa | 1 tuần |
| [535-degraded-mode-shrink.md](535-degraded-mode-shrink.md) | TO: Degraded Mode Shrink | 🟡 | ⚠️ (workflow runner + DegradedResult | 2-3 tuần |
| [536-skill-policy-boundary.md](536-skill-policy-boundary.md) | TP: Skill Policy Boundary | 🟢 | ⚠️ (threat-scan + redact sẵn — chưa c | 1-2 tuần |
| [537-handoff-session-reset.md](537-handoff-session-reset.md) | TQ: Handoff Session Reset | 🟢 | ❌ (chưa có handoff-format schema + w | 1-2 tuần |
| [538-skill-curated-promotion.md](538-skill-curated-promotion.md) | TR: Skill Curated Promotion | 🟡 | ⚠️ (SkillStore + curator sẵn — chưa c | 2-3 tuần |

### Nhóm — Phần D: DISTILL-R2 (563-567)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [563-fidelity-scorecard-persistence.md](563-fidelity-scorecard-persistence.md) | UQ: Fidelity-Scorecard Persistence | 🟢 | ⚠️ (eval + llm-as-judge sẵn — chưa có | 2-3 tuần |
| [564-benchmark-anti-cheating.md](564-benchmark-anti-cheating.md) | UR: Benchmark Anti-Cheating | 🟢 | ❌ (chưa có example/test overlap dete | 1-2 tuần |
| [565-corpus-pii-scrubbing.md](565-corpus-pii-scrubbing.md) | US: Corpus PII-Scrubbing | 🟢 | ❌ (chưa có PII-scrubber) | **Effort: | 1-2 tuần |
| [566-source-liveness-gate.md](566-source-liveness-gate.md) | UT: Source-Liveness Gate | 🟢 | ⚠️ (tools fetch sẵn — chưa có batch U | 1-2 tuần |
| [567-selective-self-disclosure.md](567-selective-self-disclosure.md) | UU: Selective Self-Disclosure | 🟢 | ❌ (chưa có topic-selector + disclosu | 2-3 tuần |

### Nhóm — Phần D: Deep-Research-skills (561-562)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [561-outline-first-research.md](561-outline-first-research.md) | UO: Outline-First Research | 🟢 | ⚠️ (workflows + subagents sẵn — chưa | 2-3 tuần |
| [562-search-site-module-routing.md](562-search-site-module-routing.md) | UP: Search-Site-Module Routing | 🟢 | ⚠️ (tools search sẵn — chưa có source | 2-3 tuần |

### Nhóm — Phần D: ECC (547-554)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [547-memory-persistence-hooks.md](547-memory-persistence-hooks.md) | UA: Memory Persistence Hooks | 🟡 | ⚠️ (session + memory store sẵn — chưa | 2-3 tuần |
| [548-instinct-continuous-learning.md](548-instinct-continuous-learning.md) | UB: Instinct Continuous Learning | 🟡 | ⚠️ (tool dispatch + memory sẵn — chưa | 3-4 tuần |
| [549-strategic-compact-reminder.md](549-strategic-compact-reminder.md) | UC: Strategic Compact Reminder | 🟢 | ⚠️ (compress + idle-trigger sẵn — chư | 2 tuần |
| [550-self-eval-evidence-rubric.md](550-self-eval-evidence-rubric.md) | UD: Self-Eval Evidence Rubric | 🟡 | ⚠️ (eval + audit sẵn — chưa có self-e | 2-3 tuần |
| [551-worktree-lifecycle-service.md](551-worktree-lifecycle-service.md) | UE: Worktree Lifecycle Service | 🟡 | ⚠️ (git ops + sync sẵn — chưa có work | 3-4 tuần |
| [552-mcp-inventory-consolidation.md](552-mcp-inventory-consolidation.md) | UF: MCP Inventory Consolidation | 🟡 | ⚠️ (MCP tool + composio sẵn — chưa có | 2-3 tuần |
| [553-harness-adapter-matrix.md](553-harness-adapter-matrix.md) | UG: Harness Adapter Matrix | 🟢 | ⚠️ (harness context sẵn — chưa có cro | 2 tuần |
| [554-observer-loop-guard.md](554-observer-loop-guard.md) | UH: Observer Loop Guard | 🟡 | ⚠️ (telemetry + audit sẵn — chưa có t | 2-3 tuần |

### Nhóm — Phần D: Understand-Anything (638-644)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [638-intermediate-results-on-disk.md](638-intermediate-results-on-disk.md) | XN: Intermediate Results On Disk | 🟡 | ⚠️ (có spill.ts + subagent — chưa có | 1-2 tuần |
| [639-incremental-fingerprint-analysis.md](639-incremental-fingerprint-analysis.md) | XO: Incremental Fingerprint Analysis | 🟡 | ⚠️ (có codegraph.ts build — chưa có f | 2 tuần |
| [640-token-gated-dashboard.md](640-token-gated-dashboard.md) | XP: Token-Gated Dashboard | 🟡 | ⚠️ (có web dashboard + signing — chưa | 1-2 tuần |
| [641-diff-ripple-analysis.md](641-diff-ripple-analysis.md) | XQ: Diff Ripple Analysis | 🟢 | ⚠️ (có codegraph + reference-graph — | 1-2 tuần |
| [642-topology-driven-tours.md](642-topology-driven-tours.md) | XR: Topology-Driven Tours | 🟡 | ⚠️ (có codegraph + reference-graph — | 2-3 tuần |
| [643-omitted-model-frontmatter.md](643-omitted-model-frontmatter.md) | XS: Omitted Model Frontmatter | 🟢 | ⚠️ (model field optional đã có — chưa | <1 tuần |
| [644-worktree-output-redirect.md](644-worktree-output-redirect.md) | XT: Worktree Output Redirect | 🟢 | ⚠️ (có tools path — chưa có worktree | 1 tuần |

### Nhóm — Phần D: claw-code (555-560)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [555-permission-mode-tooling.md](555-permission-mode-tooling.md) | UI: Permission Mode Tooling | 🟡 | ⚠️ (permission + approval sẵn — chưa | 2-3 tuần |
| [556-sidecar-rag-retrieval.md](556-sidecar-rag-retrieval.md) | UJ: Sidecar RAG Retrieval | 🟡 | ⚠️ (RAG + embeddings sẵn — chưa có si | 3-4 tuần |
| [557-lean-ndjson-agent.md](557-lean-ndjson-agent.md) | UK: Lean NDJSON Agent | 🟢 | ⚠️ (agent loop + tools sẵn — chưa có | 2 tuần |
| [558-plugin-hook-aggregation.md](558-plugin-hook-aggregation.md) | UL: Plugin Hook Aggregation | 🟡 | ⚠️ (tools + skills sẵn — chưa có plug | 2-3 tuần |
| [559-mock-parity-harness.md](559-mock-parity-harness.md) | UM: Mock-Parity Harness | 🟡 | ⚠️ (eval + tool-mocking sẵn — chưa có | 3-4 tuần |
| [560-session-fork-compaction.md](560-session-fork-compaction.md) | UN: Session Fork-Compaction | 🟡 | ⚠️ (session persist/restore sẵn — chư | 4-5 tuần |

### Nhóm — Phần D: deer-flow (539-546)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [539-deferred-skill-discovery.md](539-deferred-skill-discovery.md) | TS: Deferred Skill Discovery | 🟢 | ✅ (SkillStore progressive disclosure | 1 tuần |
| [540-slash-skill-activation.md](540-slash-skill-activation.md) | TT: Slash Skill Activation | 🟡 | ⚠️ (SkillStore + loadBody sẵn — chưa | 2-3 tuần |
| [541-request-scoped-secrets.md](541-request-scoped-secrets.md) | TU: Request-Scoped Secrets | 🟡 | ⚠️ (SecretStore + redact sẵn — chưa c | 2-3 tuần |
| [542-subagent-turn-budget-recovery.md](542-subagent-turn-budget-recovery.md) | TV: Subagent Turn-Budget Recovery | 🟡 | ⚠️ (subagent pool + lifecycle sẵn — c | 2-3 tuần |
| [543-durable-context-projection.md](543-durable-context-projection.md) | TW: Durable Context Projection | 🟡 | ❌ (chưa có pre-compaction capture + | 3-4 tuần |
| [544-debounced-memory-queue.md](544-debounced-memory-queue.md) | TX: Debounced Memory Queue | 🟢 | ⚠️ (memory store sẵn — chưa có deboun | 2-3 tuần |
| [545-config-hot-reload-boundary.md](545-config-hot-reload-boundary.md) | TY: Config Hot-Reload Boundary | 🟡 | ⚠️ (config load sẵn — chưa có STARTUP | 2 tuần |
| [546-harness-import-firewall.md](546-harness-import-firewall.md) | TZ: Harness Import Firewall | 🟢 | ⚠️ (lint-deps sẵn — chưa có harness-s | 1-2 tuần |

### Nhóm — Phần D: effective-html (568-570)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [568-bundled-example-corpus.md](568-bundled-example-corpus.md) | UV: Bundled Example Corpus | 🟢 | ⚠️ (skills artifact sẵn — chưa có bun | 1-2 tuần |
| [569-multi-harness-plugin-packaging.md](569-multi-harness-plugin-packaging.md) | UW: Multi-Harness Plugin Packaging | 🟡 | ⚠️ (bundle.mjs + skills sẵn — chưa có | 2-3 tuần |
| [570-fullscreen-svg-diagram.md](570-fullscreen-svg-diagram.md) | UX: Fullscreen SVG Diagram | 🟢 | ⚠️ (tools + print sẵn — chưa có SVG-d | 2-3 tuần |

### Nhóm — Phần D: nuwa-skill (571-577)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [571-cognitive-os-distillation.md](571-cognitive-os-distillation.md) | UY: Cognitive-OS Distillation | 🟡 | ⚠️ (prompts + skills sẵn — chưa có 5- | 3-4 tuần |
| [572-triple-verified-mental-model.md](572-triple-verified-mental-model.md) | UZ: Triple-Verified Mental Model | 🟢 | ❌ (chưa có 3-tier verify pipeline) | | 3-4 tuần |
| [573-parallel-source-silo-agents.md](573-parallel-source-silo-agents.md) | VA: Parallel Source-Silo Agents | 🟡 | ⚠️ (subagents + workflows sẵn — chưa | 2-3 tuần |
| [574-persona-agentic-protocol.md](574-persona-agentic-protocol.md) | VB: Persona Agentic Protocol | 🟡 | ⚠️ (skills + tools + RAG sẵn — chưa c | 3-4 tuần |
| [575-honest-boundary-contract.md](575-honest-boundary-contract.md) | VC: Honest Boundary Contract | 🟢 | ⚠️ (skill meta + tool-test-harness sẵ | 2-3 tuần |
| [576-source-blacklist-policy.md](576-source-blacklist-policy.md) | VD: Source Blacklist Policy | 🟢 | ⚠️ (RAG retrieval sẵn — chưa có sourc | 2-3 tuần |
| [577-failure-degrade-matrix.md](577-failure-degrade-matrix.md) | VE: Failure Degrade Matrix | 🟡 | ❌ (chưa có trigger→first-aid→fallbac | 3-4 tuần |

### Nhóm — Phần D: oh-my-pi (578-581)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [578-git-bare-checkpoint-engine.md](578-git-bare-checkpoint-engine.md) | VF: Git-Bare Checkpoint Engine | 🟡 | ⚠️ (bash git + session turn sẵn — chư | 3-4 tuần |
| [579-split-scope-restore.md](579-split-scope-restore.md) | VG: Split-Scope Restore | 🟢 | ⚠️ (git-checkpoint + session restore | 2-3 tuần |
| [580-nested-repo-boundary.md](580-nested-repo-boundary.md) | VH: Nested-Repo Boundary | 🟢 | ⚠️ (git-checkpoint sẵn — chưa có nest | 2-3 tuần |
| [581-curated-meta-package.md](581-curated-meta-package.md) | VI: Curated Meta-Package | 🟡 | ⚠️ (skills/extensions registry sẵn — | 3-4 tuần |

### Nhóm — Phần D: opencode (611-617)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [611-subagent-depth-gating.md](611-subagent-depth-gating.md) | WM: Subagent Depth Gating | 🟡 | ⚠️ (subagent pool + lifecycle sẵn — c | 2 tuần |
| [612-background-subagent-registry.md](612-background-subagent-registry.md) | WN: Background Subagent Registry | 🟡 | ⚠️ (subagent pool + async sẵn — chưa | 2-3 tuần |
| [613-persistent-session-todo.md](613-persistent-session-todo.md) | WO: Persistent Session Todo | 🟢 | ⚠️ (session + tools sẵn — chưa có tod | 1-2 tuần |
| [614-prune-protect-compaction.md](614-prune-protect-compaction.md) | WP: Prune-Protect Compaction | 🟡 | ⚠️ (compaction + spill sẵn — chưa có | 2 tuần |
| [615-mcp-local-oauth-provider.md](615-mcp-local-oauth-provider.md) | WQ: MCP Local OAuth Provider | 🟡 | ⚠️ (gateway + secrets sẵn — chưa có l | 2-3 tuần |
| [616-remote-skill-index-install.md](616-remote-skill-index-install.md) | WR: Remote Skill Index Install | 🟡 | ⚠️ (skills + curator sẵn — chưa có re | 2 tuần |
| [617-markdown-agent-definition.md](617-markdown-agent-definition.md) | WS: Markdown Agent Definition | 🟢 | ⚠️ (agent + skills frontmatter sẵn — | 2 tuần |

### Nhóm — Phần D: pi (606-610)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [606-threshold-auto-compaction.md](606-threshold-auto-compaction.md) | WH: Threshold Auto-Compaction | 🟡 | ⚠️ (session/history + compaction sẵn | 2-3 tuần |
| [607-event-intercept-extensions.md](607-event-intercept-extensions.md) | WI: Event Intercept Extensions | 🟡 | ⚠️ (extension system + events sẵn — c | 2-3 tuần |
| [608-skill-description-only-discovery.md](608-skill-description-only-discovery.md) | WJ: Skill Description-Only Discovery | 🟢 | ⚠️ (skills + curator sẵn — chưa có de | 1-2 tuần |
| [609-prompt-template-arg-grammar.md](609-prompt-template-arg-grammar.md) | WK: Prompt Template Arg Grammar | 🟢 | ⚠️ (prompts + skills sẵn — chưa có te | 2 tuần |
| [610-directory-trust-gate.md](610-directory-trust-gate.md) | WL: Directory Trust Gate | 🟡 | ⚠️ (permission + trust sẵn — chưa có | 2 tuần |

### Nhóm — Phần D: pi-agent-flow (596-601)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [596-uuid-tagged-steering-hint.md](596-uuid-tagged-steering-hint.md) | VX: UUID-Tagged Steering Hint | 🟢 | ⚠️ (system message + steer sẵn — chưa | 1-2 tuần |
| [597-sanitized-context-fork.md](597-sanitized-context-fork.md) | VY: Sanitized Context Fork | 🟡 | ⚠️ (subagent + redact sẵn — chưa có f | 2 tuần |
| [598-warp-new-session-transfer.md](598-warp-new-session-transfer.md) | VZ: Warp New Session Transfer | 🔴 | ❌ (cần warp extractor + session-buil | 3-4 tuần |
| [599-evidence-confidence-markers.md](599-evidence-confidence-markers.md) | WA: Evidence Confidence Markers | 🟢 | ⚠️ (system prompt + parser sẵn — chưa | 1-2 tuần |
| [600-structured-json-flow-report.md](600-structured-json-flow-report.md) | WB: Structured JSON Flow Report | 🟢 | ⚠️ (parser + prompt sẵn — chưa có JSO | 1-2 tuần |
| [601-batch-op-normalization.md](601-batch-op-normalization.md) | WC: Batch Op Normalization | 🟡 | ✅ (read/write/edit/bash tools sẵn — | 1-2 tuần |

### Nhóm — Phần D: pi-autoresearch (589-595)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [589-autonomous-experiment-loop.md](589-autonomous-experiment-loop.md) | VQ: Autonomous Experiment Loop | 🟡 | ⚠️ (agent loop + tools sẵn — chưa có | 2-3 tuần |
| [590-resumable-dual-session-files.md](590-resumable-dual-session-files.md) | VR: Resumable Dual Session Files | 🟢 | ⚠️ (session + log sẵn — chưa có dual- | 1-2 tuần |
| [591-compaction-rehydration.md](591-compaction-rehydration.md) | VS: Compaction Rehydration | 🟢 | ⚠️ (compaction + session sẵn — chưa c | 1-2 tuần |
| [592-hook-steer-contract.md](592-hook-steer-contract.md) | VT: Hook Steer Contract | 🟡 | ⚠️ (hooks + steer sẵn — chưa có stdin | 2 tuần |
| [593-backpressure-check-gate.md](593-backpressure-check-gate.md) | VU: Backpressure Check Gate | 🟡 | ⚠️ (gate logic sẵn — chưa có checks.s | 1-2 tuần |
| [594-extension-skill-separation.md](594-extension-skill-separation.md) | VV: Extension Skill Separation | 🟢 | ✅ (skills package sẵn — chỉ cần exte | 1-2 tuần |
| [595-finalize-independent-branches.md](595-finalize-independent-branches.md) | VW: Finalize Independent Branches | 🟡 | ⚠️ (git ops sẵn — chưa có independent | 2 tuần |

### Nhóm — Phần D: pi-bar (602-605)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [602-responsive-collapse-order.md](602-responsive-collapse-order.md) | WD: Responsive Collapse Order | 🟢 | ⚠️ (statusbar + print sẵn — chưa có c | 1-2 tuần |
| [603-template-eval-token-mix.md](603-template-eval-token-mix.md) | WE: Template Eval Token Mix | 🟢 | ⚠️ (print/template sẵn — chưa có eval | 1-2 tuần |
| [604-ordered-state-matching.md](604-ordered-state-matching.md) | WF: Ordered State Matching | 🟢 | ⚠️ (TUI + render sẵn — chưa có ordere | 1-2 tuần |
| [605-keyed-status-catchall.md](605-keyed-status-catchall.md) | WG: Keyed Status Catchall | 🟢 | ⚠️ (TUI render sẵn — chưa có keyed st | 1 tuần |

### Nhóm — Phần D: pi-boomerang (582-588)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [582-opaque-context-collapse.md](582-opaque-context-collapse.md) | VJ: Opaque Context Collapse | 🟡 | ⚠️ (subagent + summarizer sẵn — chưa | 3-4 tuần |
| [583-hidden-orchestrator-handoff.md](583-hidden-orchestrator-handoff.md) | VK: Hidden Orchestrator Handoff | 🟡 | ⚠️ (subagent + summary sẵn — chưa có | 2-3 tuần |
| [584-anchor-summary-accumulation.md](584-anchor-summary-accumulation.md) | VL: Anchor-Summary Accumulation | 🟢 | ⚠️ (memory + summary sẵn — chưa có an | 2-3 tuần |
| [585-rethrow-accumulate-loop.md](585-rethrow-accumulate-loop.md) | VM: Rethrow-Accumulate Loop | 🟡 | ⚠️ (agent-loop + summarizer sẵn — chư | 3-4 tuần |
| [586-per-step-model-switching.md](586-per-step-model-switching.md) | VN: Per-Step Model Switching | 🟡 | ⚠️ (catalog + skills sẵn — chưa có pe | 3-4 tuần |
| [587-one-shot-auto-wrapping.md](587-one-shot-auto-wrapping.md) | VO: One-Shot Auto-Wrapping | 🟢 | ⚠️ (prompt dispatch sẵn — chưa có one | 1-2 tuần |
| [588-operational-handoff-schema.md](588-operational-handoff-schema.md) | VP: Operational Handoff Schema | 🟢 | ⚠️ (subagent summary sẵn — chưa có fi | 2-3 tuần |

### Nhóm — Phần D: rpiv-mono (618-630)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [618-model-judged-loop-assess.md](618-model-judged-loop-assess.md) | WT: Model-Judged Loop Assess | 🟡 | ⚠️ (council + agent + eval sẵn — chưa | 2-3 tuần |
| [619-produces-acts-terminal-factories.md](619-produces-acts-terminal-factories.md) | WU: Produces / Acts / Terminal Factories | 🟡 | ⚠️ (workflow runner + worker sẵn — ch | 2-3 tuần |
| [620-outcome-collector-parser-validator.md](620-outcome-collector-parser-validator.md) | WV: Outcome Collector / Parser / Validator | 🟡 | ⚠️ (audit + telemetry sẵn — chưa có t | 2-3 tuần |
| [621-workflow-config-layering.md](621-workflow-config-layering.md) | WW: Workflow Config Layering | 🟢 | ⚠️ (skill store + config sẵn — chưa c | 1-2 tuần |
| [622-predicate-gate-routing.md](622-predicate-gate-routing.md) | WX: Predicate Gate Routing | 🟢 | ⚠️ (orchestration + audit sẵn — chưa | 2-3 tuần |
| [623-named-artifact-registry.md](623-named-artifact-registry.md) | WY: Named Artifact Registry | 🟢 | ⚠️ (spill + session state sẵn — chưa | 2-3 tuần |
| [624-tool-capability-reconciliation.md](624-tool-capability-reconciliation.md) | WZ: Tool Capability Reconciliation | 🟡 | ⚠️ (tool dispatch + builtin sẵn — chư | 1-2 tuần |
| [625-structured-questionnaire-tool.md](625-structured-questionnaire-tool.md) | XA: Structured Questionnaire Tool | 🟡 | ⚠️ (approval tool sẵn — chưa có struc | 2-3 tuần |
| [626-side-conversation-clone.md](626-side-conversation-clone.md) | XB: Side Conversation Clone | 🟡 | ⚠️ (subagent + session sẵn — chưa có | 2-3 tuần |
| [627-bounded-telemetry-dispatcher.md](627-bounded-telemetry-dispatcher.md) | XC: Bounded Telemetry Dispatcher | 🟡 | ⚠️ (telemetry + audit sẵn — chưa có b | 2-3 tuần |
| [628-subfolder-guidance-injection.md](628-subfolder-guidance-injection.md) | XD: Subfolder Guidance Injection | 🟡 | ⚠️ (prompts + session sẵn — chưa có s | 2-3 tuần |
| [629-skill-shell-placeholders.md](629-skill-shell-placeholders.md) | XE: Skill Shell Placeholders | 🟡 | ⚠️ (skill store + bash sẵn — chưa có | 2-3 tuần |
| [630-pluggable-web-providers.md](630-pluggable-web-providers.md) | XF: Pluggable Web Providers | 🟡 | ⚠️ (tool registry + dispatch sẵn — ch | 2-3 tuần |

### Nhóm — Phần D: scientific-agent-skills (631-637)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [631-deterministic-db-lookup.md](631-deterministic-db-lookup.md) | XG: Deterministic DB Lookup | 🟡 | ⚠️ (skills + web-fetch sẵn — chưa có | 3-4 tuần |
| [632-workflow-mining-autoskill.md](632-workflow-mining-autoskill.md) | XH: Workflow Mining Autoskill | 🔴 | ❌ (chưa có capture + embedding + ski | 5-6 tuần |
| [633-consciousness-council.md](633-consciousness-council.md) | XI: Consciousness Council | 🔴 | ⚠️ (council + adversarial sẵn — chưa | 4-5 tuần |
| [634-what-if-oracle.md](634-what-if-oracle.md) | XJ: What-If Oracle | 🟢 | ❌ (có skills + prompts — chưa có 6-b | 1-2 tuần |
| [635-hypothesis-tree-refinement.md](635-hypothesis-tree-refinement.md) | XK: Hypothesis Tree Refinement | 🟡 | ❌ (có eval + memory — chưa có hypoth | 3-4 tuần |
| [636-skill-frontmatter-portability.md](636-skill-frontmatter-portability.md) | XL: Skill Frontmatter Portability | 🟢 | ⚠️ (có frontmatter YAML + allowedTool | 1 tuần |
| [637-security-scan-gate.md](637-security-scan-gate.md) | XM: Security Scan Gate | 🟡 | ⚠️ (có cron scan + audit — chưa có 3- | 2-3 tuần |

### Nhóm — Phần D: x-research-skill (645-645)

| File | Hướng | Coupling | Code sẵn? | Effort |
|---|---|---|---|---|
| [645-watchlist-heartbeat.md](645-watchlist-heartbeat.md) | XU: Watchlist Heartbeat | 🟢 | ⚠️ (có cron + channels notify — chưa | 1-2 tuần |

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
