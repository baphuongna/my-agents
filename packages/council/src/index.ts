/**
 * @my-agent/council — multi-model council provider (§6).
 *
 * CouncilProvider (implements ProviderProfile): fan-out to N members → aggregate
 * (attributed | majority | judge). Drops into the provider registry / fallback
 * chain like any single profile.
 */
export { CouncilProvider } from "./council.js";
export type { CouncilMember, CouncilProviderOptions, CouncilStrategy } from "./council.js";
