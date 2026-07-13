/**
 * @my-agent/eval — parity harness + drift grading + no-egress guard (§15).
 *
 * UNIT scenarios (zero-cost, deterministic) · INTEGRATION (local services) ·
 * CREDENTIALED (real API key). The substrate for the §5 accuracy-preservation gate.
 */
export { ParityHarness, defaultHarness } from "./harness.js";
export type { ParityScenario, ScenarioResult } from "./harness.js";
export { identicalPassthrough, keyFactPreserved } from "./harness.js";
export { installEgressGuard, restoreEgress, checkGoldenAge, EgressViolationError } from "./egress.js";
export {
  IntegrationTier,
  CredentialedTier,
  toolCallConversation,
  warnFixtureFreshness,
  FRESHNESS_WARN_DAYS,
} from "./tiers.js";
export type {
  IntegrationTurn,
  IntegrationScenario,
  IntegrationResult,
  CredentialedScenario,
  CredentialedResult,
  FreshnessWarning,
} from "./tiers.js";
