/**
 * @my-agent/council — multi-model council provider (§6) + hindsight reviewer (§10).
 *
 * CouncilProvider (implements ProviderProfile): fan-out to N members → aggregate
 * (attributed | majority | judge). Drops into the provider registry / fallback
 * chain like any single profile.
 *
 * HindsightReviewer: a second-model critic that reviews a (question, answer)
 * pair and emits structured issues + approve/reject. Used as an advisor lane
 * (oh-my-pi §10).
 */
export { CouncilProvider } from "./council.js";
export type { CouncilMember, CouncilProviderOptions, CouncilStrategy } from "./council.js";
export { HindsightReviewer } from "./hindsight.js";
export type { HindsightResult, HindsightIssue } from "./hindsight.js";
export { adversarialReview } from "./adversarial.js";
export type { AdversarialReviewConfig, AdversarialReviewResult, FindingVote } from "./adversarial.js";
