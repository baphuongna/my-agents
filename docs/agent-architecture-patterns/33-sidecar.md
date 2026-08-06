# Hướng AG: Sidecar — mya là sidecar bên cạnh agent container

> **Nguồn gốc:** Kubernetes service mesh (Envoy sidecar proxy, 2016)
> **Coupling:** 🟢 Zero — sidecar bên cạnh agent
> **Agent-agnostic:** ✅ — bất kỳ agent + sidecar
> **Effort:** 1-2 tuần

## Nguồn gốc

K8s service mesh: sidecar proxy (Envoy) chạy BÊN CẠNH mỗi pod, intercept network traffic, cung cấp observability (metrics, logs, tracing), security (TLS, auth), routing (retries, timeouts). Application không cần biết sidecar tồn tại.

## Mô tả

mya = sidecar bên cạnh mỗi agent. Mỗi agent session spawn kèm 1 mya-sidecar process. Sidecar intercept agent's traffic (stdout, file writes, API calls), cung cấp: observability (metrics, logs, tracing), security (policy, audit), reliability (retry, timeout). Agent chạy native, không biết sidecar tồn tại.

## Kiến trúc

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              AGENT POD (container-like)              │   │
│  │                                                      │   │
│  │  ┌────────────────┐      ┌────────────────────┐      │   │
│  │  │  AGENT         │      │  MYA SIDECAR        │      │   │
│  │  │  (pi/claude)   │      │  (mya-sidecar proc) │      │   │
│  │  │                │      │                     │      │   │
│  │  │  own TUI       │      │  intercepts:        │      │   │
│  │  │  own tools     │      │  · stdout → log     │      │   │
│  │  │  own LLM       │──────│  · stdin ← forward  │      │   │
│  │  │  own context   │ stdio│  · file writes →    │      │   │
│  │  │                │      │    audit            │      │   │
│  │  └────────────────┘      │  · API calls →      │      │   │
│  │                          │    proxy (memory)   │      │   │
│  │                          │  provides:          │      │   │
│  │                          │  · observability    │      │   │
│  │                          │  · policy checks    │      │   │
│  │                          │  · retry/timeout    │      │   │
│  │                          │  · audit trail      │      │   │
│  │                          │  · metrics          │      │   │
│  │                          └─────────┬──────────┘      │   │
│  │                                    │                  │   │
│  └────────────────────────────────────┼──────────────────┘   │
│                                       │                      │
│  ┌────────────────────────────────────▼──────────────────┐   │
│  │              MYA CONTROL PLANE                       │   │
│  │  · Gateway API · Memory (Brain) · Audit · Dashboard  │   │
│  │  · Metrics (Prometheus) · Tracing (OTel)             │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  AGENT KHÔNG BIẾT SIDECAR TỒN TẠI.                          │
│  Sidecar cung cấp services mà agent không cần implement.    │
└──────────────────────────────────────────────────────────────┘
```

## Sidecar responsibilities

```
┌────────────────────────────────────────────────────────────┐
│                    MYA SIDECAR                             │
│                                                            │
│  OBSERVABILITY (thay vì agent tự log):                    │
│  · stdout/stderr → structured logs (JSONL)                 │
│  · turn events → metrics (tokens, cost, duration)          │
│  · tool calls → trace spans (distributed tracing)          │
│                                                            │
│  SECURITY:                                                 │
│  · policy check (is this action allowed?)                  │
│  · secret redaction (mask API keys in logs)                │
│  · audit trail (append to Merkle log)                      │
│                                                            │
│  RELIABILITY:                                              │
│  · retry (transient failures)                              │
│  · timeout (hang detection → kill + restart)               │
│  · circuit breaker (provider fail → fallback)              │
│                                                            │
│  INTEGRATION (opt-in):                                     │
│  · memory recall (inject context)                          │
│  · skills (inject into prompt)                             │
│  · cost tracking (token accounting)                        │
└────────────────────────────────────────────────────────────┘
```

## Implementation

```typescript
// packages/sidecar/src/index.ts
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

interface SidecarConfig {
  agentCmd: string;
  agentArgs: string[];
  metricsUrl?: string;       // Push metrics
  auditLog?: AuditLog;
  policyEngine?: PolicyEngine;
}

class MyaSidecar {
  private child: ChildProcess;

  constructor(private config: SidecarConfig) {}

  async start(): Promise<void> {
    // Spawn agent + attach to stdio
    this.child = spawn(this.config.agentCmd, this.config.agentArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Intercept stdout → logs + metrics + audit
    const rl = createInterface({ input: this.child.stdout });
    rl.on("line", (line) => this.handleAgentOutput(line));

    // Intercept stderr → error logs
    this.child.stderr?.on("data", (d) => this.handleAgentError(d));

    // Policy enforcement on stdin (before forwarding)
    // (would need to parse agent's internal protocol — complex)
  }

  private handleAgentOutput(line: string): void {
    // 1. Structured log
    console.log(JSON.stringify({ ts: Date.now(), stream: "stdout", line }));

    // 2. Metric extraction
    try {
      const event = JSON.parse(line);
      if (event.type === "turn_start") metrics.inc("agent.turn_start", { agent: this.config.agentCmd });
      if (event.type === "tool_call") metrics.inc("agent.tool_call", { tool: event.toolName });
      if (event.type === "message_end" && event.usage) {
        metrics.histogram("agent.tokens", event.usage.totalTokens);
        auditLog.append({ kind: "usage", tokens: event.usage.totalTokens });
      }
    } catch { /* not JSON — raw output */ }

    // 3. Memory extraction (autoCapture)
    // ... parse messages, extract facts → POST /memory/record
  }

  private handleAgentError(data: Buffer): void {
    const text = data.toString();
    if (this.config.policyEngine?.isFatalError(text)) {
      // Kill + restart via supervisor
      this.child.kill();
      metrics.inc("agent.crash");
    }
    console.error(JSON.stringify({ ts: Date.now(), stream: "stderr", text }));
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent completely unaware (zero coupling) | ❌ Sidecar process overhead per agent |
| ✅ Observability out-of-box (logs, metrics, traces) | ❌ Can't intercept internal state (only IO) |
| ✅ Security (policy, redaction, audit) | ❌ Complex stdio parsing (agent formats vary) |
| ✅ Reliability (retry, timeout, circuit breaker) | ❌ Sidecar crash = lost observability |
| ✅ Opt-in integration (memory, skills, cost) | |
| ✅ K8s-proven (Envoy) | |

## Khi nào chọn

- Want observability without agent cooperation
- Need per-agent security (policy + redaction + audit)
- Want reliability (retry, timeout, circuit breaker)
- Agents are black boxes (can't modify them)
- Running many agent processes (sidecar per agent)
