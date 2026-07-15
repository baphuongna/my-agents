/**
 * Single source of truth for the default model.
 *
 * Resolution order:
 * 1. MYA_MODEL env var (explicit user override)
 * 2. First configured provider's model (auto-detect from env keys)
 * 3. "auto" (let pi-ai pick from available providers)
 *
 * NEVER hardcode a model name outside this file.
 */

/** Provider env keys in priority order for auto-detection. */
const PROVIDER_PRIORITY: Array<{ envKey: string; model: string }> = [
  { envKey: "MINIMAX_API_KEY", model: "MiniMax-M3" },
  { envKey: "ANTHROPIC_API_KEY", model: "claude-sonnet-4-20250514" },
  { envKey: "OPENAI_API_KEY", model: "gpt-4o-mini" },
  { envKey: "GEMINI_API_KEY", model: "gemini-2.0-flash" },
  { envKey: "DEEPSEEK_API_KEY", model: "deepseek-chat" },
  { envKey: "GROQ_API_KEY", model: "llama-3.3-70b-versatile" },
  { envKey: "XAI_API_KEY", model: "grok-3" },
  { envKey: "MISTRAL_API_KEY", model: "mistral-large-latest" },
  { envKey: "TOGETHER_API_KEY", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  { envKey: "OPENROUTER_API_KEY", model: "anthropic/claude-3.5-sonnet" },
];

/**
 * Resolve the default model.
 * - If MYA_MODEL is set, use it.
 * - Otherwise auto-detect from the first provider with an API key.
 * - Returns "auto" if no provider is configured (pi will handle it).
 */
export function getDefaultModel(): string {
  // 1. Explicit override
  const env = process.env["MYA_MODEL"];
  if (env && env.trim()) return env.trim();

  // 2. Auto-detect from configured providers
  for (const p of PROVIDER_PRIORITY) {
    if (process.env[p.envKey]) return p.model;
  }

  // 3. Let pi decide
  return "auto";
}
