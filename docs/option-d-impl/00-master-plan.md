# Option D — Implementation Master Plan

> Source spec: `docs/option-d-spec-v8.md` (v11, FINAL — 2 consecutive clean review rounds)
> Created: from spec review process (11 rounds, ~100 findings fixed)

## 1. Overview

Transform mya from a single-runtime (pi-only) gateway into a **multi-agent orchestration platform** where:
- Each agent runtime (pi, claude, mya-native, future) runs natively via a uniform SPI
- A shared broker (pi-intercom) enables inter-agent messaging
- SmartRouter selects the best runtime per prompt
- PromptEnricher injects memory context automatically
- CostTracker aggregates token costs across all runtimes
- Dashboard renders any agent identically via uniform AgentEvent stream

## 2. Package Structure

```
packages/
  core/                      ← Phase 2: runtime-spi.ts (types only, no runtime deps)
  intercom/                  ← Phase 1: pi-intercom moved here (NEW package)
  print/src/
    runtimes/                ← Phase 4+: all runtime implementations
      pi-in-process.ts       ← Phase 4
      pi-event-normalizer.ts ← Phase 4
      mya-native.ts          ← Phase 6
      claude.ts              ← Phase 10
      claude-event-normalizer.ts ← Phase 10
      stubs.ts               ← Phase 5 (stub router/enricher/cost)
      pool.ts                ← Phase 5 (RuntimePool)
      adapter.ts             ← Phase 5 (RuntimeSessionAdapter)
      enricher.ts            ← Phase 7 (full PromptEnricher)
      router.ts              ← Phase 8 (full SmartRouter)
      cost-tracker.ts        ← Phase 12 (full CostTracker)
      build-env.ts           ← Phase 4 (buildAgentEnv)
  agent/                     ← EXISTING: AgentPool (will be replaced by RuntimePool)
  gateway/                   ← Phase 5: rewired to use RuntimePool
  memory/                    ← Phase 7: recall() used by enricher
```

## 3. Inter-Phase Contract

### What each phase EXPORTS (downstream phases depend on these):

| Phase | Exports | Consumed By |
|---|---|---|
| 1 | `@my-agent/intercom` package (default export: ExtensionFactory) | 4, 5, 11 |
| 2 | `AgentRuntime`, `RuntimeSession`, `AgentEvent`, `StartOpts`, `CompactionResult`, `ModelInfo`, `ThinkingLevel`, `AgentCapabilities`, `SessionState`, `PromptOpts`, **SmartRouter**, **EnrichContext**, **PromptEnricher**, **CostTracker** from `@my-agent/core` | ALL |
| 3 | `pi-event-map.md` (spike document: verified event types + payloads) | 4 |
| 4 | `PiInProcessRuntime`, `PiInProcessSession`, `PiEventNormalizer`, `buildAgentEnv` | 5 |
| 5 | `RuntimePool`, `RuntimeSessionAdapter`, `RuntimePoolEntry`, stubs | 6, 7, 8, 12, 13, gateway |
| 6 | `MyaNativeRuntime` | 5 (registered in runtimes map) |
| 7 | `PromptEnricher` (real impl, replaces stub) | 5 |
| 8 | `SmartRouter` (real impl, replaces stub) | 5 |
| 9 | `claude-cli-flags.md` (spike document) | 10 |
| 10 | `ClaudeRuntime`, `ClaudeSession`, `ClaudeEventNormalizer` | 5 |
| 11 | Inter-agent messaging via pi-intercom extension | (no code exports — runtime behavior) |
| 12 | `CostTracker` (real impl), `GET /sessions/:id/snapshot` route | 5, gateway |
| 13 | Shutdown handler, idle sweep integration, E2E tests | gateway |

### Critical Path (must be sequential):
```
1 (broker) ──┐
2 (SPI) ─────┤
3 (spike) ───┤
             ├──► 4 (pi runtime) ──► 5 (pool+gateway) ──► 6 (native) ──► 7 (enricher)
             │                                         ├──► 8 (router)
             │                                         ├──► 9 (spike) ──► 10 (claude)
             │                                         ├──► 11 (broker msg)
             │                                         ├──► 12 (cost+dash)
             │                                         └──► 13 (shutdown+e2e)
```

### Parallelizable after Phase 5:
- Phase 6 (MyaNativeRuntime) ∥ Phase 7 (Enricher) ∥ Phase 8 (Router) ∥ Phase 9 (Claude spike)

## 4. Key Decisions (from spec)

| Decision | Rationale |
|---|---|
| pi-intercom as second extension (IC3) | No MYA_BROKER_SOCKET env var. Self-manages via PI_CODING_AGENT_DIR |
| Pi stays in-process | Zero IPC overhead, 100% features. Subprocess for Claude/OpenCode only |
| Uniform AgentEvent type | ALL runtimes normalize to same format. Dashboard renders any agent |
| Prompt() is BLOCKING | pi's prompt() resolves on turn completion. Events stream DURING await |
| turn_start from prompt() | Emitted directly (not from normalizer). Guarantees 1:1 with turn_end |
| settled guard | Both 'close' and 'error' events check settled flag — prevents double turn_end |
| dreamCycle hoisted to shared-instances.ts | PiInProcessRuntime receives it via constructor (G1 fix) |
| IC6: no SessionMetaStore | Session state lives in RuntimeSession.getState() |
| Snapshot route in Phase 12 | GET /sessions/:id/snapshot — needs CostTracker data |

## 5. Milestones & Acceptance Gates

| Milestone | Phases | Gate Criteria |
|---|---|---|
| **M1: Foundation** | 1-3 | intercom package loads; SPI types compile; pi events mapped |
| **M2: First Agent** | 4-5 | PiInProcessRuntime creates sessions; RuntimePool manages lifecycle; gateway serves requests |
| **M3: Multi-Agent** | 6-8, 9-10 | 3+ runtimes registered; SmartRouter selects; Enricher injects memory |
| **M4: Orchestration** | 11-12 | Agents message each other; cost dashboard works |
| **M5: Production** | 13 | Graceful shutdown; E2E tests pass; 14 test files green |

## 6. Test Discipline

**NO TEST = NO MERGE** (IC8). Each phase MUST create matching test files.

| Test File | Phase | Location | Tier |
|---|---|---|---|
| `runtime-spi.test.ts` | 2 | `packages/core/src/` | [unit] |
| `intercom-extension.test.ts` | 1 | `packages/print/src/` | [smoke] |
| `pi-event-normalizer.test.ts` | 4 | `packages/print/src/runtimes/` | [unit] |
| `pi-in-process-runtime.test.ts` | 4 | `packages/print/src/runtimes/` | [smoke] |
| `runtime-pool.test.ts` | 5 | `packages/print/src/runtimes/` | [unit] |
| `runtime-session-adapter.test.ts` | 5 | `packages/print/src/runtimes/` | [unit] |
| `cron-agent-type.test.ts` | 5 | `packages/cron/src/` | [unit] |
| `mya-native-runtime.test.ts` | 6 | `packages/print/src/runtimes/` | [unit] |
| `prompt-enricher.test.ts` | 7 | `packages/print/src/runtimes/` | [unit] |
| `smart-router.test.ts` | 8 | `packages/print/src/runtimes/` | [unit] |
| `claude-session.test.ts` | 10 | `packages/print/src/runtimes/` | [real] |
| `broker-messaging.test.ts` | 11 | `packages/print/src/runtimes/` | [smoke] |
| `gateway-snapshot.test.ts` | 12 | `packages/gateway/src/` | [unit] |
| `e2e-shutdown.test.ts` | 13 | `packages/print/src/runtimes/` | [system] |

**Total: 14 spec-required test files + 1 optional (mya-native-event-normalizer.test.ts).** Runner: `npx vitest run --testTimeout=5000`.

## 7. Risk Register

| Risk | Mitigation | Phase |
|---|---|---|
| pi event types differ from spec assumptions | Phase 3 spike BEFORE Phase 4 implementation | 3→4 |
| Claude CLI flags unverified | Phase 9 spike BEFORE Phase 10 | 9→10 |
| AgentPool API mismatch breaks gateway | IC1: RuntimePool must implement ALL methods gateway calls | 5 |
| dreamCycle singleton split | Hoist to shared-instances.ts (D1 fix) | 4-5 |
| Module singleton duplication in bundle | bundle dedup (already solved for pi packages) | ALL |
| turn_end never fires (hang) | turnActive safety net + settled guard | 4, 10 |

## 8. Implementation Order Summary

```
Phase 1:  pi-intercom → packages/intercom/           [EST: 2h]
Phase 2:  AgentRuntime SPI types                      [EST: 1h]
Phase 3:  Spike: log pi events                        [EST: 1h]
Phase 4:  PiInProcessRuntime + normalizer             [EST: 4h]
Phase 5:  RuntimePool + adapter + gateway integration [EST: 4h]
Phase 6:  MyaNativeRuntime                            [EST: 2h]
Phase 7:  PromptEnricher (full)                       [EST: 2h]
Phase 8:  SmartRouter (full)                          [EST: 2h]
Phase 9:  Spike: Claude CLI                           [EST: 1h]
Phase 10: ClaudeRuntime                               [EST: 3h]
Phase 11: Broker inter-agent messaging                [EST: 2h]
Phase 12: CostTracker + dashboard + snapshot          [EST: 3h]
Phase 13: Shutdown + idle sweep + E2E                 [EST: 2h]
                                                    --------
                                              TOTAL: ~29h
```

## 9. Per-Phase Plan Files

| File | Phase(s) |
|---|---|
| `01-phase1-broker.md` | 1 |
| `02-phase2-spi-types.md` | 2 |
| `03-phase3-pi-spike.md` | 3 |
| `04-phase4-pi-runtime.md` | 4 |
| `05-phase5-pool-gateway.md` | 5 |
| `06-phase6-mya-native.md` | 6 |
| `07-phase7-enricher.md` | 7 |
| `08-phase8-router.md` | 8 |
| `09-phase9-claude-spike.md` | 9 |
| `10-phase10-claude-runtime.md` | 10 |
| `11-phase11-broker-messaging.md` | 11 |
| `12-phase12-cost-dashboard.md` | 12 |
| `13-phase13-shutdown-e2e.md` | 13 |
