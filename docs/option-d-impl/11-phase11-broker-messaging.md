# Phase 11: Broker Inter-Agent Messaging

> Depends on: Phase 1 (intercom package), Phase 4 (PiInProcessRuntime loads intercom extension), Phase 5 (RuntimePool)
> Estimated: 2h
> Spec reference: §4 (Broker), IC3 decision

## Objective

Enable inter-agent communication through the pi-intercom broker. Agents can:
- **send** — fire-and-forget message to another agent
- **ask** — request/response with timeout
- **reply** — respond to a pending ask
- **mailbox** — async message queue for offline agents

This is NOT new code — pi-intercom (Phase 1) already implements the broker. This phase verifies it works end-to-end when multiple RuntimePool sessions are active.

## Deliverables

| File | Purpose |
|---|---|
| `packages/print/src/runtimes/broker-messaging.test.ts` | [smoke] inter-agent messaging tests |
| (No new source files) | pi-intercom extension handles everything |

## Implementation Steps

### Step 1: Verify broker auto-spawn

Pi-intercom auto-spawns a broker process when the first extension instance starts. Each PiInProcessSession loads the intercom extension (Phase 4), so the broker is automatically available.

```typescript
// This happens automatically in PiInProcessRuntime.start():
//   1. extensionFactories includes pi-intercom
//   2. DefaultResourceLoader loads both mya-bridge + pi-intercom
//   3. pi-intercom connects to (or spawns) broker via PI_CODING_AGENT_DIR
//   4. Broker manages Unix socket at ~/.mya/agent/intercom.sock
```

### Step 2: Verify intercom tool registration

The pi-intercom extension registers a tool that pi's agent can call:

```typescript
// When a pi session receives a prompt like:
//   "Send a message to session 'worker-1' asking for the latest test results"
// The agent calls the intercom tool:
//   intercom.send({ target: "worker-1", message: "What are the latest test results?" })
//   → broker routes to worker-1's session
//   → worker-1's agent processes and replies via intercom.reply()
//   → original session receives the reply
```

### Step 3: Test multi-session messaging

Create 2 sessions via RuntimePool, verify they can communicate:

```typescript
// packages/print/src/runtimes/broker-messaging.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RuntimePool } from "./pool.js";
import { createStubRouter, stubEnricher, stubCostTracker } from "./stubs.js";

describe("[smoke] broker inter-agent messaging", () => {
  let pool: RuntimePool;

  beforeAll(async () => {
    const runtimes = new Map<string, AgentRuntime>();
    runtimes.set("pi", new PiInProcessRuntime(piDeps));
    pool = new RuntimePool(
      createStubRouter(runtimes), runtimes, stubEnricher, stubCostTracker
    );
  });

  afterAll(() => pool.dispose());

  it("two sessions can send/ask/reply via broker", async () => {
    // Create 2 sessions
    const session1 = await pool.acquire("test-session-1");
    const session2 = await pool.acquire("test-session-2");

    // Session 1 sends a message to session 2
    await session1.prompt(
      "Use the intercom tool to send a message to session 'test-session-2': " +
      "'Are you online?'"
    );

    // Session 2 receives and responds
    await session2.prompt("Check your mailbox and reply to any pending messages.");

    // Session 1 receives reply (next prompt cycle)
    await session1.prompt("Check your mailbox for replies.");

    // Verify text buffer contains expected exchange
    const buffer1 = (session1 as RuntimeSessionAdapter).getTextBuffer();
    expect(buffer1).toContain("online");  // Response received
  });

  it("mailbox delivers to offline agents when they come online", async () => {
    // Send to a session that doesn't exist yet
    const session1 = await pool.acquire("test-sender");
    await session1.prompt(
      "Send a message to session 'offline-agent': 'Wake up'"
    );

    // Create the offline agent
    const offline = await pool.acquire("offline-agent");
    await offline.prompt("Check your mailbox");

    const buffer = (offline as RuntimeSessionAdapter).getTextBuffer();
    expect(buffer).toContain("Wake up");
  });
});
```

### Step 4: Verify broker injection turn pairing

From spec BC fix: when the broker injects a message into a session, `agent_settled` fires without a prior `turn_start`. The PiInProcessSession subscriber detects this and emits a synthetic `turn_start` to maintain turn pairing.

```typescript
// This is already handled in Phase 4's PiInProcessSession.subscribe():
// if (e.type === "agent_settled" && !this.turnActive) {
//   this.emit({ type: "turn_start", model: ..., sessionId: ... });
// }
// Test this path in the broker-messaging test.
```

## Test Plan

### `broker-messaging.test.ts` [smoke]

| Case | Description | Verification |
|---|---|---|
| send/ask/reply | 2 sessions exchange messages | Text buffers contain expected content |
| mailbox delivery | Message to offline session | Delivered when session comes online |
| broker injection turn pairing | Broker injects message | Synthetic turn_start emitted (turn pairing maintained) |
| multiple concurrent sessions | 3+ sessions active | All can send/receive independently |
| broker reconnect | Kill broker process, restart | Sessions reconnect automatically |

## Acceptance Criteria

- [ ] pi-intercom broker auto-spawns when first PiInProcessSession starts
- [ ] Intercom tool is registered in pi's agent (visible in /tools API)
- [ ] `send` delivers messages to target session
- [ ] `ask` returns response within timeout
- [ ] `reply` resolves pending ask
- [ ] Mailbox delivers messages to sessions that come online later
- [ ] Broker injection produces correct turn_start/turn_end pairing
- [ ] Multiple concurrent sessions can communicate independently
- [ ] No MYA_BROKER_SOCKET env var needed (IC3 decision)
- [ ] PI_CODING_AGENT_DIR points to ~/.mya/agent (shared with auth.json)

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Broker process crashes | MEDIUM — messaging breaks | Pi-intercom auto-restarts broker on connection failure |
| Unix socket permission denied | LOW | PI_CODING_AGENT_DIR owned by user; socket inherits perms |
| Message lost during reconnect | LOW | Pi-intercom uses mailbox persistence (writes to disk) |
| Test requires actual LLM calls | HIGH — slow, expensive | Mark as [smoke] tier. Consider mocking for CI. |
| Broker injection race condition | LOW | BC fix already handles: turnActive flag prevents unpaired turn_end |

## Rollback

- No source code changes in this phase (all handled by pi-intercom extension)
- Delete test file: `broker-messaging.test.ts`
- RuntimePool continues working without broker (messaging is optional)
