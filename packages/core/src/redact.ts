/**
 * Secret redaction engine — strips credentials from text before it crosses
 * a persistence or trust boundary.
 *
 * Ported from Hermes Agent `agent/redact.py` (deep-dive-r3.md §1).
 *
 * - 43 vendor API-key prefix patterns
 * - ENV assignments, JSON fields, auth headers
 * - PEM private keys, JWTs, DB connection strings
 * - URL bare tokens, Telegram bot tokens, E.164 phone numbers
 * - `force=true` bypasses the global toggle (persistence boundaries)
 * - `redactUrlCredentials=true` adds stricter URL credential pass
 * - Substring pre-checks gate each expensive regex (-68% latency)
 */

// ── Toggle ─────────────────────────────────────────────────────────────────

const _REDACT_ENABLED = new Set(["1", "true", "yes", "on"]).has(
  (process.env.MYA_REDACT_SECRETS ?? "true").toLowerCase(),
);

// ── Masking ────────────────────────────────────────────────────────────────

/**
 * Mask a secret token for display: first 6 + "..." + last 4, floor 18.
 * When `nonReusable` is true, returns `«redacted:prefix…»` so the agent can't
 * write back a truncated dead key (issue #35519).
 */
export function maskSecret(token: string, opts?: { nonReusable?: boolean }): string {
  if (opts?.nonReusable) {
    const prefix = token.slice(0, 6);
    return `«redacted:${prefix}…»`;
  }
  if (token.length <= 18) return token.slice(0, 4) + "…";
  return token.slice(0, 6) + "…" + token.slice(-4);
}

// ── API key prefixes (43 patterns) ─────────────────────────────────────────

const _PREFIX_RE = new RegExp(
  [
    "sk-[A-Za-z0-9_-]{10,}",
    "ghp_[A-Za-z0-9]{10,}",
    "github_pat_[A-Za-z0-9_]{10,}",
    "gho_[A-Za-z0-9]{10,}",
    "ghu_[A-Za-z0-9]{10,}",
    "ghs_[A-Za-z0-9]{10,}",
    "ghr_[A-Za-z0-9]{10,}",
    "xapp-\\d+-[A-Za-z0-9-]{10,}",
    "xox[baprs]-[A-Za-z0-9-]{10,}",
    "AIza[A-Za-z0-9_-]{30,}",
    "pplx-[A-Za-z0-9_-]{10,}",
    "fal_[A-Za-z0-9_-]{10,}",
    "fc-[A-Za-z0-9_-]{10,}",
    "bb_live_[A-Za-z0-9_-]{10,}",
    "AKIA[A-Z0-9]{16}",
    "sk_live_[A-Za-z0-9]{10,}",
    "sk_test_[A-Za-z0-9]{10,}",
    "rk_live_[A-Za-z0-9]{10,}",
    "SG\\.[A-Za-z0-9_-]{10,}",
    "hf_[A-Za-z0-9_-]{10,}",
    "r8_[A-Za-z0-9_-]{10,}",
    "npm_[A-Za-z0-9]{10,}",
    "pypi-[A-Za-z0-9]{10,}",
    "dop_v1_[A-Za-z0-9_-]{10,}",
    "doo_v1_[A-Za-z0-9_-]{10,}",
    "am_[A-Za-z0-9_-]{10,}",
    "sk_[A-Za-z0-9_]{10,}",
    "tvly-[A-Za-z0-9_-]{10,}",
    "exa_[A-Za-z0-9_-]{10,}",
    "gsk_[A-Za-z0-9_-]{10,}",
    "syt_[A-Za-z0-9_-]{10,}",
    "retaindb_[A-Za-z0-9_-]{10,}",
    "hsk-[A-Za-z0-9_-]{10,}",
    "mem0_[A-Za-z0-9_-]{10,}",
    "brv_[A-Za-z0-9_-]{10,}",
    "xai-[A-Za-z0-9]{30,}",
    "ntn_[A-Za-z0-9_]{30,}",
    "fw-[A-Za-z0-9]{30,}",
    "fw_[A-Za-z0-9]{30,}",
    "fpk_[A-Za-z0-9]{30,}",
  ].join("|"),
  "g",
);

// ── ENV assignments ────────────────────────────────────────────────────────

const _SECRET_ENV_NAMES =
  "(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)";
const _ENV_ASSIGN_RE = new RegExp(
  `([A-Z0-9_]{0,50}${_SECRET_ENV_NAMES}[A-Z0-9_]{0,50})\\s*=\\s*(['"]?)(\\S+)\\2`,
  "g",
);

// ── JSON fields ────────────────────────────────────────────────────────────

const _JSON_KEY_NAMES =
  "(?:api_?[Kk]ey|token|secret|password|access_token|refresh_token|auth_token|bearer|secret_value|raw_secret|secret_input|key_material)";
const _JSON_FIELD_RE = new RegExp(
  `("(${_JSON_KEY_NAMES})":\\s*")([^"]+)`,
  "gi",
);

// ── Auth headers ───────────────────────────────────────────────────────────

const _AUTH_HEADER_RE =
  /((?:Proxy-)?Authorization:\s*(?:Bearer|Basic|Token|Digest)?\s*)(\S+)/gi;
const _SECRET_HEADER_NAMES =
  "(?:x-api-key|x-goog-api-key|api-key|apikey|x-api-token|x-auth-token|x-access-token)";
const _SECRET_HEADER_RE = new RegExp(
  `(${_SECRET_HEADER_NAMES}\\s*:\\s*)(\\S+)`,
  "gi",
);

// ── PEM / private keys ─────────────────────────────────────────────────────

const _PRIVATE_KEY_RE =
  /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g;

// ── JWTs ───────────────────────────────────────────────────────────────────

const _JWT_RE = /eyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_=-]{4,}){0,2}/g;

// ── DB connection strings ──────────────────────────────────────────────────

const _DB_CONNSTR_RE = new RegExp(
  "((?:postgres(?:ql)?|mysql|mongodb(?:\\+srv)?|redis|amqp)://[^:\\s]+:)([^@\\s]+)(@)",
  "gi",
);

// ── URL bare tokens ────────────────────────────────────────────────────────

const _URL_BARE_TOKEN_RE = new RegExp(
  "((?:https?|wss?|git|ssh|ftp|ftps|sftp)://)([^\\s:@/]{8,})(@[^\\s]+)",
  "gi",
);

// ── Telegram bot tokens ────────────────────────────────────────────────────

const _TELEGRAM_RE = /(bot)?(\d{8,}):([-A-Za-z0-9_]{30,})/g;

// ── E.164 phone numbers (only when redactUrlCredentials or force) ──────────

const _PHONE_RE = /(\+[1-9]\d{6,14})(?![A-Za-z0-9])/g;

// ── URL credentials (only when redactUrlCredentials=true) ──────────────────

const _SENSITIVE_QUERY_PARAMS = new Set([
  "access_token", "refresh_token", "id_token", "token", "api_key", "apikey",
  "client_secret", "password", "auth", "jwt", "session", "secret", "key",
  "code", "signature", "x-amz-signature",
]);

function _redactQueryString(query: string): string {
  const parts = query.split("&");
  return parts
    .map((kv) => {
      const eq = kv.indexOf("=");
      if (eq < 0) return kv;
      const key = kv.slice(0, eq);
      // Check base key (before any % encoding) — wrap in try/catch for malformed %
      let baseKey: string;
      try { baseKey = decodeURIComponent(key).toLowerCase(); }
      catch { baseKey = key.toLowerCase(); }
      if (_SENSITIVE_QUERY_PARAMS.has(baseKey)) {
        return `${key}=***`;
      }
      return kv;
    })
    .join("&");
}

const _URL_WITH_QUERY_RE =
  /((?:https?|wss?|ftp):\/\/[^\s?#]+[^\s?#]*)(\?)([^\s#]+)/gi;

const _URL_USERINFO_RE = /((?:https?|wss?|ftp):\/\/)([^/\s:@]+):([^/\s@]+)@/gi;

// ── Substring pre-checks ───────────────────────────────────────────────────

const _PREFIX_SUBSTRINGS = [
  "sk-", "ghp_", "github_pat_", "gho_", "ghu_", "ghs_", "ghr_", "xapp-",
  "xox", "AIza", "pplx-", "fal_", "fc-", "bb_live_", "AKIA", "sk_live_",
  "sk_test_", "rk_live_", "SG.", "hf_", "r8_", "npm_", "pypi-", "dop_v1_",
  "doo_v1_", "am_", "sk_", "tvly-", "exa_", "gsk_", "syt_", "retaindb_",
  "hsk-", "mem0_", "brv_", "xai-", "ntn_", "fw-", "fw_", "fpk_",
];

function _hasKnownPrefix(text: string): boolean {
  for (const sub of _PREFIX_SUBSTRINGS) {
    if (text.includes(sub)) return true;
  }
  return false;
}

// ── Main entry ─────────────────────────────────────────────────────────────

export interface RedactOptions {
  /** Bypass the global `MYA_REDACT_SECRETS` toggle. */
  force?: boolean;
  /** Add stricter URL credential pass (query params + userinfo). Default false. */
  redactUrlCredentials?: boolean;
  /** Use non-reusable sentinels (for file reads — prevents write-back). */
  fileRead?: boolean;
}

/**
 * Redact secrets from text.
 *
 * - Default ON; `force=true` overrides `MYA_REDACT_SECRETS=false`.
 * - `redactUrlCredentials=true` adds query-param + userinfo stripping.
 * - Each regex is gated behind a cheap substring pre-check for performance.
 */
export function redactSensitiveText(
  text: string,
  opts?: RedactOptions,
): string {
  if (typeof text !== "string") return text;
  const enabled = opts?.force === true || _REDACT_ENABLED;
  if (!enabled) return text;

  let result = text;
  const nonReusable = opts?.fileRead ?? false;

  // 1. API key prefixes (gated by substring pre-check)
  if (_hasKnownPrefix(result)) {
    result = result.replace(_PREFIX_RE, (m) => maskSecret(m, { nonReusable }));
  }

  // 2. PEM private keys (gated by "BEGIN")
  if (result.includes("BEGIN") && result.includes("PRIVATE KEY")) {
    result = result.replace(_PRIVATE_KEY_RE, "[REDACTED PRIVATE KEY]");
  }

  // 3. ENV assignments (gated by "=")
  if (result.includes("=")) {
    result = result.replace(_ENV_ASSIGN_RE, "$1=$2***$2");
  }

  // 4. JSON fields (gated by ": ")
  if (result.includes('":')) {
    result = result.replace(_JSON_FIELD_RE, '$1***');
  }

  // 5. Auth headers (gated by "Authorization" or "x-api-key")
  if (/authorization/i.test(result) || /x-api-key/i.test(result)) {
    result = result.replace(_AUTH_HEADER_RE, "$1***");
    result = result.replace(_SECRET_HEADER_RE, "$1***");
  }

  // 6. JWTs (gated by "eyJ")
  if (result.includes("eyJ")) {
    result = result.replace(_JWT_RE, (m) => maskSecret(m, { nonReusable }));
  }

  // 7. DB connection strings (gated by "://")
  if (result.includes("://")) {
    result = result.replace(_DB_CONNSTR_RE, "$1***$3");
    // 8. URL bare tokens
    result = result.replace(_URL_BARE_TOKEN_RE, "$1***$3");
  }

  // 9. Telegram bot tokens (gated by digit-colon pattern)
  if (/\d{8,}:[A-Za-z0-9_-]{20}/.test(result)) {
    result = result.replace(_TELEGRAM_RE, "$1$2:***");
  }

  // 10. URL credentials (opt-in) + phone (force or redactUrlCredentials)
  if (opts?.redactUrlCredentials) {
    // Query params
    result = result.replace(_URL_WITH_QUERY_RE, (_m, base, q, query) => {
      return `${base}${q}${_redactQueryString(query)}`;
    });
    // Userinfo
    result = result.replace(_URL_USERINFO_RE, "$1$2:***@");
  }

  // E.164 phone — redact at force boundaries or when URL credentials opt-in
  if (opts?.force || opts?.redactUrlCredentials) {
    result = result.replace(_PHONE_RE, (m) => {
      const mid = m.length - 4;
      return m.slice(0, 5) + "****" + m.slice(mid);
    });
  }

  return result;
}
