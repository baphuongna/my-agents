/**
 * Sticky session routing helpers.
 *
 * Provider profiles can inject a session_id into extra_body for sticky routing.
 * This pins every turn to the same upstream endpoint, keeping cache_control
 * breakpoints warm (e.g. Anthropic prompt caching).
 *
 * Ported from Hermes build_extra_body (deep-dive-r2.md §4.1).
 *
 * Usage: call `buildStickyExtraBody({ sessionId })` and merge the result into
 * the provider's `extra_body` / request extras before streaming.
 */

export interface StickySessionOpts {
  sessionId?: string;
  providerPreferences?: Record<string, unknown>;
}

/**
 * Build the extra_body for sticky routing.
 *
 * Providers that support this: OpenRouter (session_id), custom gateways,
 * load-balanced OpenAI-compatible endpoints.
 *
 * Returns an empty object when no session/preferences are provided.
 */
export function buildStickyExtraBody(opts: StickySessionOpts): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (opts.sessionId) {
    body["session_id"] = opts.sessionId;
  }
  if (opts.providerPreferences) {
    body["provider"] = opts.providerPreferences;
  }
  return body;
}
