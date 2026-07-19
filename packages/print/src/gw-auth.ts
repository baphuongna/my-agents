/** Phase 0C shared gateway auth helper. Reads the WS token the gateway writes to
 * ~/.mya/agent/gw.token (0600) so CLI/TUI HTTP callers can send Authorization:
 * Bearer. Used by cron-cli, launcher (the primary TUI), and channels-cli. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** Read the gateway WS token. Undefined if absent (gateway not running / dev). */
export function readGwToken(): string | undefined {
  try {
    return readFileSync(join(homedir(), ".mya", "agent", "gw.token"), "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Bearer auth headers for gateway HTTP calls. Empty object if no token file
 * (the call will then 401 unless the gateway runs with MYA_NO_WS_TOKEN). */
export function authHeaders(): Record<string, string> {
  const token = readGwToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** Merge auth headers into an existing headers object. */
export function withAuth(headers: Record<string, string> = {}): Record<string, string> {
  return { ...headers, ...authHeaders() };
}
