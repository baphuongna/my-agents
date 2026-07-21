/**
 * @my-agent/ai — provider abstraction (§6).
 *
 * ProviderProfile + MockProvider (deterministic replay) · ProviderRegistry
 * (taint/cooldown) · streamWithFallback (ordered, skip-tainted) · OpenAIAdapter
 * (real HTTP/SSE provider).
 */
export { MockProvider, textMock } from "./mock.js";
export type { MockTrace } from "./mock.js";
export { ProviderRegistry } from "./registry.js";
export type { TaintedProfile, TaintReason } from "./registry.js";
export { streamWithFallback } from "./fallback.js";
export type { FallbackResult } from "./fallback.js";
export { OpenAIAdapter } from "./openai.js";
export type { OpenAIAdapterOptions } from "./openai.js";
export { PiAiProviderBridge } from "./pi-ai-bridge.js";
export type { PiAiProviderBridgeOptions } from "./pi-ai-bridge.js";
export {
  KeyState,
  KeyRouter,
  OVERLOADED_RE,
  RATE_LIMITED_RE,
  UNAUTHORIZED_RE,
  initKeyStates,
  pickNextKey,
  matchProvider,
  waitForNextKey,
  defaultConfig,
  configPath,
  loadConfig,
  resolveProviderName,
} from "./key-rotation.js";
export type {
  ApiKey,
  ProviderConfig,
  KeyRouterConfig,
  KeyStatus,
  RotationReason,
} from "./key-rotation.js";
export type { ProviderProfile, StreamEvent } from "@my-agent/core";
export { resolveModelForPhase, parseModelRoutingFromMeta, buildDefaultTierConfig, resolveTierModel, loadModelTierConfig, saveModelTierConfig, sortedTierNames, getModelTierConfigPath, SMALL_MODEL_HINTS, BIG_MODEL_HINTS } from "./model-routing.js";
export type { ModelRoute, ModelRoutingConfig, ModelTier, ModelTierConfig } from "./model-routing.js";
export { generatePkce, buildAuthUrl, exchangeCode, refreshAccessToken, verifyPkce, verifyCallbackState, LoopbackServer } from "./oauth.js";
export type { PkcePair, AuthRequest, CallbackResult, TokenResponse } from "./oauth.js";
export { scanProviders, isProviderConfigured, manifestToProfile, getConfiguredProviders } from "./provider-discovery.js";
export type { ProviderPackageManifest } from "./provider-discovery.js";
