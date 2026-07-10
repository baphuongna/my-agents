/**
 * @my-agent/eval — parity harness + drift grading (§15).
 *
 * MOCK scenarios (zero-cost, deterministic) · LIVE scenarios (need API key).
 * The substrate for the §5 accuracy-preservation gate.
 */
export { ParityHarness, defaultHarness } from "./harness.js";
export type { ParityScenario, ScenarioResult } from "./harness.js";
export { identicalPassthrough, keyFactPreserved } from "./harness.js";
