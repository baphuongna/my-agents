# Eval & Supply Chain

> Part of the Unified Agent SPEC — see [00-OVERVIEW.md](00-OVERVIEW.md). Section §15 · §16.



## 15. Eval & Quality Gates

- **Mock parity harness:** deterministic mock provider + scripted scenario JSON + request-level behavioral diff. *(source: [claw-code](../../claw-code/) `mock_parity_scenarios.json` + `run_mock_parity_diff.py`.)*
- **Drift gate (R25-17):** compression ships BEHIND a **deterministic-replay drift grader** (the zero-cost, CI-runnable merge-block — replay a golden `LlmTrace` with vs without compression, diff final responses; `ε = 0`). The live GSM8K/TruthfulQA lm-eval (headroom's real eval suite = GSM8K/TruthfulQA via lm-eval + before/after + LLM-as-judge) is a **credentialed-tier aspiration**, NOT a merge-block gate — never ship compression without the deterministic-replay gate. *(source: [headroom](../../headroom/) + [mya-v1](../../mya-v1/) #04.)*
- **Parity-test crate** for any reference algorithm reimplemented (golden fixtures) — caveat: `headroom-parity` has **3 of 7 comparators still `todo!` stubs (Phase 0)**; only Diff/Tokenizer/SmartCrusher/ContentDetector are real. *(source: [headroom](../../headroom/) [`headroom-parity`](../../headroom/crates/headroom-parity/).)*
- **Test classification** unit/integration/credentialed + **no-egress guard** on non-credentialed tests. *(source: [claw-code](../../claw-code/) + [MyAgents](../../MyAgents/).)*
- **Deterministic `MockProvider`** with replay + `TestTier`. *(source: [mya-v1](../../mya-v1/) `mya-eval::mock`.)*

**Concrete eval shapes (round 16):**
```ts
// Mock-parity scenario = deterministic replay + behavioral diff
interface ParityScenario {
  name: string;                       // "streaming_text" | "write_denied" | "auto_compact" ...
  mockResponses: MockResponse[];      // canned provider replies
  steps: BehaviorStep[];              // expected tool calls / state transitions
  assert: "exact" | "subset";          // diff mode
}
type TestTier = "unit" | "integration" | "credentialed";
// CI runs unit+integration; credentialed = opt-in. no-egress guard: a fence FAILS if any
// network call fires outside the credentialed tier. *(claw-code + MyAgents.)*
```

---
## 16. Supply Chain

- **Min-release-age gate** (refuse deps younger than N days) + transitive `[patch]`/overrides for known-bad transitives. *(source: [openclaw](../../openclaw/) `minimumReleaseAge` + [hermes](../../hermes-agent/).)*
- **Exact-pin** runtime deps (no floats); deliberate hardening (cf. May-2026 Mini Shai-Hulud worm). *(source: [hermes](../../hermes-agent/).)*
- **Lazy, vetted feature bundles** with a hardcoded allowlist + writable target + **resolution appended-last** so core can never be shadowed; refuse on version-sentinel mismatch (the inherited enforcer; full ABI stamp = SPEC proposal, [§23 Open Questions](11-invariants-roadmap.md) #6). *(source: [hermes](../../hermes-agent/) [`lazy_deps.py`](../../hermes-agent/tools/lazy_deps.py) + [mya-v1](../../mya-v1/) #11.)*
- **`cargo-deny` / `npm audit`** in CI; root `deny.toml` canonical. *(source: [mya-v1](../../mya-v1/) #18.)*
- **Tension resolved — lazy runtime installs vs exact-pin hardening (round 8):** lazy feature bundles (install-on-first-use) introduce *new code at runtime*, which conflicts with exact-pinning. Resolution: the lazy allow-list is **version-pinned in the lockfile at release time** (the bundle's *version* is fixed; only its *materialization* is lazy), install target is **appended-last** to resolution, and any install off the pinned version is refused. Fail-open (feature unavailable) never means fail-open-on-supply-chain. *(source: [hermes](../../hermes-agent/) `lazy_deps` + [openclaw](../../openclaw/) age-gate, reconciled.)*
- **Supply-chain hole 1 — lazy transitive closure (R25-26):** the **release lockfile must include the full transitive closure of every lazy bundle** (generated via `npm install --package-lock-only` with all bundles present); runtime materialization is **lockfile-strict (`npm ci`)** — never `npm install`. This closes the gap where a lazy bundle's transitives are unresolved at release time.

---
