// packages/print/src/runtimes/build-env.ts
import { join } from "node:path";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";

interface AuthCredential {
  type: "api_key" | "oauth";
  key?: string;
}

interface AuthConfig {
  credentials: Record<string, AuthCredential>;
  env?: Record<string, string>;
}

function loadAuthConfig(): AuthConfig {
  const authPath = join(homedir(), ".mya", "agent", "auth.json");
  try {
    const raw = readFileSync(authPath, "utf-8");
    const parsed = JSON.parse(raw);
    // auth.json may have mixed shape — extract credentials and env separately
    if (typeof parsed !== "object" || parsed === null) return { credentials: {} };
    const { env, ...rest } = parsed;
    return { credentials: rest, env };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('[build-env] auth.json read error:', e);
    return { credentials: {} };
  }
}

export function buildAgentEnv(): Record<string, string> {
  const auth = loadAuthConfig();
  const env: Record<string, string> = {};

  for (const [providerId, credential] of Object.entries(auth.credentials)) {
    if (credential && typeof credential === "object" && credential.type === "api_key" && credential.key) {
      const envKey = `${providerId.toUpperCase().replace(/-/g, "_")}_API_KEY`;
      env[envKey] = credential.key;
    }
  }

  if (auth.env) Object.assign(env, auth.env);

  // IC3: PI_CODING_AGENT_DIR must point to mya's agent dir (shared with intercom)
  env.PI_CODING_AGENT_DIR = join(homedir(), ".mya", "agent");

  return env;
}
