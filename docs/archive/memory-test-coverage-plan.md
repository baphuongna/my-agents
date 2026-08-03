# Memory Test Coverage — Completion Plan

**Goal**: Cover all remaining edge/boundary/security/scale/concurrency cases (the ~30 gaps from the coverage audit). Each case → a test. Execute all, report pass/fail.

---

## Group A — Boundary conditions (exact limits)
- A1: jaccard exactly 0.7 → NOT conflict (strict `>`), 0.71 → conflict
- A2: valid_until exactly == now → purged (expired boundary)
- A3: trust exactly 0.0 → recall score 0 (invisible); 1.0 → score = base
- A4: applyFeedback helpful at trust=1.0 → stays 1.0 (clamp); unhelpful at 0.0 → stays 0.0

## Group B — Consolidation runtime
- B1: consolidate preserves agent_id (role working → role episodic)
- B2: consolidate + trust propagation (verify behavior: reset to 0.5? or preserved?)
- B3: dream excludes role memories (scope='global' filter at runtime)

## Group C — True concurrency (Node worker_threads)
- C1: concurrent writes (4 threads) — no deadlock, all persist
- C2: concurrent recall during write — no corruption

## Group D — Scale
- D1: 2000 stale rows → purge LIMIT 1000 (verify capped per tick)
- D2: 60 brain candidates → conflict topN=50 cap (some missed — document)
- D3: 150 referents → staleMemories LIMIT (bounded)

## Group E — Security (latent surface)
- E1: trackReferent `../../../etc/passwd` → path traversal (info via hash) — document risk
- E2: applyFeedback pump trust to 1 / drive to 0 (manipulation) — document risk

## Group F — Edge data
- F1: NULL agent_id + scope='role' → orphan (recall never returns it)
- F2: empty-string agentId "" → treated as no-role (global)
- F3: scope='role' but no agentId → orphan
- F4: old rows NULL agent_id + scope='global' → still visible (migration compat)

## Group G — Unicode/special
- G1: CJK content jaccard (東京タワー vs 東京スカイツリー → low/0)
- G2: long content (>4KB) — jaccard doesn't crash
- G3: large file >256KB → hash skipped (mtime+size only)

## Group H — Cross-table
- H1: applyFeedback working-only / episodic-only / non-existent (null)

## Group I — Lifecycle full
- I1: capture → lifecycle() consolidate → recall episodic end-to-end
- I2: TTL expiry fires in lifecycle (purgeExpired wired)

---

## Execution
- A, B, F, G, H, I → unit tests (memory-edge-cases.test.ts)
- C → node worker_threads script (concurrency-realtest.mjs)
- D → node script (scale-realtest.mjs)
- E → unit test documenting the latent risk (not "fix", document)
