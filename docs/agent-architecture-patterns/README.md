# mya Agent Architecture Patterns — 28 Hướng Kiến Trúc

> Phân tích chi tiết 28 hướng kiến trúc cho mya — từ conventional (wrap/proxy/shell) 
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

## So sánh nhanh

```
Coupling:     A(red) B-G(h-h) H-Z(green)
Agent-agnostic: A(no) B-Z(yes)
Code sẵn:     A,I,K,H,R,U(yes)  Others(no/partial)
Effort thấp:  B,F,R,T(3-5 ngày)  Others(1-3 tuần)
```

## Hướng nào cho mya?

| Tiêu chí | Hướng | Lý do |
|---|---|---|
| Ít effort nhất | **T: Stigmergy** | fs.watch session files → trigger |
| Thiết thực nhất | **R: pi RPC** | pi đã có 33 commands, verify work |
| Elegant nhất | **U: Tuple Space** | Agent tự tìm việc, SQLite sẵn |
| Lâu dài sạch nhất | **G: Proxy+Watcher** | Agent-agnostic + inject + observe |
| Tham vọng nhất | **N: Agent OS** | mya = platform, agents = apps |
