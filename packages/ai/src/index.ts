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
export type { ProviderProfile, StreamEvent } from "@my-agent/core";
export { generatePkce, buildAuthUrl, exchangeCode, refreshAccessToken, verifyPkce, LoopbackServer } from "./oauth.js";
export type { PkcePair, AuthRequest, CallbackResult, TokenResponse } from "./oauth.js";
