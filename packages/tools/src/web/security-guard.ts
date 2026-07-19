/**
 * security-guard.ts — the SOLE web boundary for mya.
 *
 * Path containment was removed from mya (pi-core parity), so this guard is the
 * single chokepoint every web_fetch / browser_navigate URL must pass through.
 * It implements the 6-layer "security gauntlet" distilled from the hermes
 * `browser_tool.py` deep-read (see docs/web-lookup-architecture-deepdive.md
 * "Security gauntlet" + docs/PLAN-BROWSER.md §5 Phase 1):
 *
 *   1. SECRET-IN-URL BLOCK      — exfil via prompt-injected `evil.com/?key=sk-…`
 *   2. SSRF METADATA FLOOR      — UNCONDITIONAL; even local Chromium on a cloud
 *                                 VM reaches host IMDS → IAM-cred exfil.
 *   3. SSRF PRIVATE/INTERNAL    — RFC1918 / loopback / link-local (configurable)
 *   4. POST-REDIRECT RE-CHECK   — `checkRedirect()` re-runs the gauntlet on the
 *                                 final URL after HTTP redirects land.
 *   5. DOMAIN BLOCKLIST HOOK    — fnmatch-style host patterns (in-memory).
 *   6. BOT-DETECTION AWARENESS  — returns a WARNING (never a block).
 *
 * DNS resolution: the sync {@link checkUrl} inspects the hostname directly (is it
 * an IP literal in a blocked range? a known metadata hostname?) — it does NOT
 * resolve DNS. {@link checkUrlAsync} adds resolve-then-check: a DNS hostname is
 * resolved via the OS resolver and every resolved address is checked against the
 * metadata floor + private/internal ranges (fail-closed on DNS error). This
 * closes the common DNS-rebinding case (a hostname that DIRECTLY resolves to a
 * private/metadata IP). The full split-resolution TOCTOU (public-at-check,
 * private-at-connect with attacker-controlled fast-TTL DNS) still requires
 * connection-level IP pinning (Smokescreen-style) — documented, deferred. The
 * metadata floor is hostname+IP based, so the most dangerous deterministic
 * endpoints are blocked unconditionally even by the sync path.
 *
 * Constraints: TS strict + noUncheckedIndexedAccess + ESM; only `node:net`
 * is imported (no external deps — §18 minimal core). Never throws — every
 * failure is a typed {@link GuardDecision}.
 */
import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

// ─── DNS resolver seam (dependency-injected for testing) ────────────────────
/** Resolves a hostname to a list of {address, family} records. Defaults to the
 *  OS resolver (`node:dns/promises` lookup, respects `/etc/hosts`) with a
 *  {@link DNS_TIMEOUT_MS} cap so a malicious slow-DNS server cannot stall the
 *  guard indefinitely. Overridable via {@link _setDnsResolverForTest} so unit
 *  tests can simulate DNS-rebinding without real network DNS. */
type DnsResolver = (host: string) => Promise<{ address: string; family: number }[]>;
/** Per-call DNS lookup timeout. On expiry the lookup rejects and checkUrlAsync
 *  fails CLOSED (the host cannot be verified safe). Bounds total time across
 *  redirect hops so a malicious slow-DNS server cannot stall the guard. */
const DNS_TIMEOUT_MS = 5_000;
/** Default resolver: OS lookup with a {@link DNS_TIMEOUT_MS} cap (timer cleared
 *  on resolution so no pending timers leak). */
const defaultDnsResolver: DnsResolver = (host) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("DNS lookup timed out")),
      DNS_TIMEOUT_MS,
    );
    dnsLookup(host, { all: true }).then(
      (addrs) => {
        clearTimeout(timer);
        resolve(addrs);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
let resolveDns: DnsResolver = defaultDnsResolver;
/** @internal Test seam — override the DNS resolver, or pass null to restore the
 *  default OS resolver. */
export function _setDnsResolverForTest(r: DnsResolver | null): void {
  resolveDns = r ?? defaultDnsResolver;
}

// ─── Public interface (fetch.ts depends on this exact shape) ────────────────

export type GuardCategory =
  | "secret-url"
  | "ssrf-metadata"
  | "ssrf-private"
  | "blocklist"
  | "invalid-url";

export type GuardDecision =
  | { ok: true }
  | { ok: false; reason: string; category: GuardCategory };

export interface SecurityGuardOptions {
  /** When true, RFC1918 / loopback / link-local IPs are allowed (local-only
   *  agents). The metadata floor (layer 2) is NEVER overridden by this. */
  allowPrivateUrls?: boolean;
  /** Optional fnmatch-style host patterns (e.g. `"*.evil.com"`). */
  blocklist?: string[];
}

export interface BotDetectionResult {
  detected: boolean;
  patterns: string[];
}

// ─── Layer 1: secret-in-URL ─────────────────────────────────────────────────

/**
 * API-key / credential prefix regex. A leading non-alphanumeric boundary
 * (`^` or a char outside [A-Za-z0-9]) prevents mid-word false positives such as
 * "r**isk-**management" or "des**k-**top" while still catching `=sk-ant-…`,
 * `/sk-ant-…`, `?key=AKIA…`. The `i` flag raises recall (evaders mixing case)
 * without introducing false positives because the boundary still applies.
 *
 * After this prefix we require ≥10 token chars — the body of a real key — so a
 * bare `sk-` substring never fires on its own.
 */
const SECRET_PREFIX_RE =
  /(?:^|[^A-Za-z0-9])(?:sk-ant-|sk-|AKIA|ghp_|gho_|ghu_|ghr_|ghs_|glpat-|npm_|ya29\.|xox[baprs]-|AIza)[A-Za-z0-9_-]{10,}/i;

/**
 * Query-parameter NAME words that signal a credential. We split the param name
 * on `[_\-.]` and match whole tokens, so `monkey` / `keyboard` / `keynote` do
 * NOT trip (no `key` token) while `api_key`, `access_token`, `user-token` do.
 */
const SENSITIVE_PARAM_WORDS = new Set([
  "key",
  "token",
  "secret",
  "password",
  "passwd",
  "apikey",
  "auth",
  "authorization",
  "credential",
  "credentials",
  "bearer",
]);

/** A credential-like VALUE: matches a known key prefix, or is a long run of
 *  token characters (base64url-ish). Short values like `true` / `en_US` pass. */
const CRED_LIKE_RE = /^[A-Za-z0-9_+/=.\-]{10,}$/;

// ─── Layer 2: SSRF metadata floor (UNCONDITIONAL) ───────────────────────────

/**
 * Cloud metadata endpoints blocked for EVERY backend — including a local
 * headless Chromium — because a local browser running on a cloud VM can still
 * reach the host IMDS and exfiltrate IAM credentials. This list is never
 * relaxed by {@link SecurityGuardOptions.allowPrivateUrls}.
 */
const METADATA_HOSTS = new Set([
  "169.254.169.254", // AWS / GCP IMDS (IPv4)
  "169.254.170.2", // AWS ECS task metadata (IPv4)
  "metadata.google.internal", // GCP IMDS (DNS)
  "metadata", // Azure-style short name (also resolves to 169.254.169.254)
]);

/** IPv6 cloud-metadata endpoints; compared in EXPANDED form to accept any
 *  valid compression of the same address. */
const METADATA_IPV6 = ["fd00:ec2::254"]; // AWS IMDS (IPv6)

// ─── Layer 6: bot-detection awareness ───────────────────────────────────────

/**
 * Title/content fragments that indicate an anti-bot interstitial. Detection
 * yields a WARNING only (never blocks) so the caller can retry / surface
 * mitigations to the model. Case-insensitive substring match.
 */
const BOT_PATTERNS = [
  "captcha",
  "cloudflare",
  "just a moment",
  "bot detected",
  "unusual traffic",
  "unusual activity",
  "access denied",
  "are you a robot",
  "verify you are human",
];

// ─── Helpers ────────────────────────────────────────────────────────────────

/** decodeURIComponent that swallows malformed-sequence errors. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Collect the raw URL plus every distinct percent-decoded form (up to 3 passes).
 * This defeats single-encoding (`%73k%2D` → `sk-`) AND double-encoding
 * (`%2573k` → `%73k` → `sk-`); the loop stops as soon as decoding stabilises.
 */
function collectDecodedForms(raw: string): string[] {
  const forms: string[] = [raw];
  let cur = raw;
  for (let i = 0; i < 3; i++) {
    const next = safeDecode(cur);
    if (next === cur) break;
    forms.push(next);
    cur = next;
  }
  return forms;
}

/** Lowercase, strip IPv6 brackets and any trailing dot from a URL hostname. */
function normalizeHost(hostname: string): string {
  let h = hostname.toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (h.endsWith(".")) h = h.slice(0, -1);
  return h;
}

/** Expand a compressed IPv6 literal into 8 numeric 16-bit groups, or null if
 *  the literal is malformed. Validates each group is 1-4 hex digits. */
function expandIPv6(ip: string): number[] | null {
  // At most one "::" allowed.
  const doubleColonCount = (ip.match(/::/g) ?? []).length;
  if (doubleColonCount > 1) return null;

  let segments: string[];
  const idx = ip.indexOf("::");
  if (idx >= 0) {
    const left = ip.slice(0, idx);
    const right = ip.slice(idx + 2);
    const leftParts = left ? left.split(":") : [];
    const rightParts = right ? right.split(":") : [];
    const fill = 8 - leftParts.length - rightParts.length;
    if (fill < 0) return null;
    segments = [...leftParts, ...Array.from({ length: fill }, () => "0"), ...rightParts];
  } else {
    segments = ip.split(":");
  }
  if (segments.length !== 8) return null;

  const groups: number[] = [];
  for (const seg of segments) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(seg)) return null;
    groups.push(parseInt(seg, 16));
  }
  return groups;
}

/** True if an IPv4 dotted-quad literal is in a blocked (private/internal)
 *  range: RFC1918, loopback, link-local, or unspecified/current-network. */
function ipv4InBlockedRange(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const octets: number[] = [];
  for (const p of parts) {
    // WHATWG URL already canonicalises octal/decimal IPs to dotted form, but
    // be defensive: each octet must be a bare base-10 integer 0-255.
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    if (n < 0 || n > 255) return false;
    octets.push(n);
  }
  const a = octets[0]!;
  const b = octets[1]!;
  if (a === 10) return true; // 10.0.0.0/8 (RFC1918)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 (RFC1918)
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 (RFC1918)
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / zero-conf
  if (a === 0) return true; // 0.0.0.0/8 unspecified / "this network"
  return false;
}

/** If an IPv6 address embeds an IPv4 literal (::ffff:a.b.c.d mapped, or the
 *  deprecated ::a.b.c.d compatible form), return the dotted-quad string. */
function extractEmbeddedIPv4(groups: number[]): string | null {
  if (groups.length !== 8) return null;
  if (!groups.slice(0, 5).every((g) => g === 0)) return null;
  const g5 = groups[5]!;
  if (g5 !== 0 && g5 !== 0xffff) return null;
  const g6 = groups[6]!;
  const g7 = groups[7]!;
  return `${(g6 >> 8) & 0xff}.${g6 & 0xff}.${(g7 >> 8) & 0xff}.${g7 & 0xff}`;
}

/** True if an expanded IPv6 address (8 groups) is in a blocked range. */
function ipv6Blocked(groups: number[]): boolean {
  if (groups.length !== 8) return false;
  if (groups.every((g) => g === 0)) return true; // :: unspecified
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true; // ::1 loopback
  if ((groups[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((groups[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA (RFC4193)
  // IPv4-mapped / IPv4-compatible embedded addresses (::ffff:127.0.0.1, …).
  const embedded = extractEmbeddedIPv4(groups);
  if (embedded && ipv4InBlockedRange(embedded)) return true;
  return false;
}

/** Convert an fnmatch pattern to a case-insensitive anchored RegExp.
 *  Supports `*` (any run), `?` (one char) and `[seq]` / `[!seq]` classes. */
function fnmatchToRegex(pattern: string): RegExp {
  let out = "^";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === "*") {
      out += ".*";
      i++;
      // Collapse runs of consecutive '*' → a single '.*' (ReDoS defense: N
      // stars would otherwise emit '.*.*.*…', causing catastrophic backtracking
      // against long non-matching hostnames — event-loop-blocking DoS).
      while (pattern[i] === "*") i++;
    } else if (c === "?") {
      out += ".";
      i++;
    } else if (c === "[") {
      let cls = "[";
      i++;
      if (pattern[i] === "!") {
        cls += "^";
        i++;
      }
      // A leading ']' inside the class is a literal.
      if (pattern[i] === "]") {
        cls += "\\]";
        i++;
      }
      while (i < pattern.length && pattern[i] !== "]") {
        const ch = pattern[i]!;
        cls += ch === "\\" ? "\\\\" : ch;
        i++;
      }
      if (pattern[i] === "]") i++; // consume closing bracket
      out += cls + "]";
    } else {
      out += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i++;
    }
  }
  out += "$";
  return new RegExp(out, "i");
}

function isSensitiveParamName(name: string): boolean {
  const parts = name.toLowerCase().split(/[_.\-]/);
  return parts.some((p) => SENSITIVE_PARAM_WORDS.has(p));
}

function looksLikeCredential(value: string): boolean {
  if (!value) return false;
  if (SECRET_PREFIX_RE.test(value)) return true;
  return value.length >= 10 && CRED_LIKE_RE.test(value);
}

// ─── Layer checks ───────────────────────────────────────────────────────────

/** Layer 1: scan every decoded form for a key prefix, then check sensitive
 *  query params. Returns a human reason, or null if clean. */
function checkSecretInUrl(rawUrl: string, url: URL): string | null {
  for (const form of collectDecodedForms(rawUrl)) {
    if (SECRET_PREFIX_RE.test(form)) {
      return "URL contains a credential / API-key pattern (possibly percent-encoded)";
    }
  }
  for (const [name, value] of url.searchParams) {
    if (isSensitiveParamName(name) && looksLikeCredential(value)) {
      return `sensitive query parameter '${name}' carries a credential-like value`;
    }
  }
  return null;
}

/** Layer 2: UNCONDITIONAL cloud-metadata floor. */
function isMetadataHost(host: string): boolean {
  if (METADATA_HOSTS.has(host)) return true;
  if (isIP(host) === 6) {
    const expanded = expandIPv6(host);
    if (expanded) {
      for (const m of METADATA_IPV6) {
        const me = expandIPv6(m);
        if (me && me.join(",") === expanded.join(",")) return true;
      }
      // Bug C fix: recognise IPv4-mapped (`::ffff:a.b.c.d`) and the
      // deprecated IPv4-compatible (`::a.b.c.d`) forms of cloud-metadata
      // endpoints. WHATWG URL canonicalises dotted-quad IPv6 inputs to
      // their hex group form (e.g. `::ffff:169.254.169.254` →
      // `::ffff:a9fe:a9fe`), so `expandIPv6` returns 8 groups here and
      // `extractEmbeddedIPv4` can recover the dotted-quad. If that
      // dotted-quad is a known metadata host, treat the IPv6 literal as
      // a metadata endpoint — this is UNCONDITIONAL and is not bypassable
      // by `allowPrivateUrls`. Without this, `::ffff:169.254.169.254`
      // fell through to layer 3 (`ssrf-private`) and was bypassable.
      const embedded = extractEmbeddedIPv4(expanded);
      if (embedded && METADATA_HOSTS.has(embedded)) return true;
    }
  }
  return false;
}

/** Layer 3: private / internal / loopback / link-local / unspecified. */
function isPrivateInternal(host: string): boolean {
  const v = isIP(host);
  if (v === 4) return ipv4InBlockedRange(host);
  if (v === 6) {
    const groups = expandIPv6(host);
    return groups ? ipv6Blocked(groups) : false;
  }
  return false; // DNS hostname — see DNS-rebinding caveat in file header.
}

/** Layer 5: fnmatch blocklist. Returns the matched pattern, or null. */
function matchBlocklist(host: string, patterns: readonly string[] | undefined): string | null {
  if (!patterns || patterns.length === 0) return null;
  for (const pat of patterns) {
    try {
      if (fnmatchToRegex(pat).test(host)) return pat;
    } catch {
      // Skip patterns that compile to an invalid RegExp.
    }
  }
  return null;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Run the full security gauntlet (layers 1, 2, 3, 5) against a URL.
 * Non-`http(s)` schemes are rejected as `invalid-url`. Never throws.
 */
export function checkUrl(rawUrl: string, opts?: SecurityGuardOptions): GuardDecision {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: `invalid URL: ${rawUrl}`, category: "invalid-url" };
  }

  // Only http/https may traverse the web boundary (file://, ftp://, … blocked).
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      reason: `disallowed URL scheme '${url.protocol}'`,
      category: "invalid-url",
    };
  }

  // Layer 1 — secret-in-URL (checked before any host work).
  const secretReason = checkSecretInUrl(rawUrl, url);
  if (secretReason) {
    return { ok: false, reason: secretReason, category: "secret-url" };
  }

  const host = normalizeHost(url.hostname);

  // Layer 2 — metadata floor: UNCONDITIONAL (allowPrivateUrls cannot bypass).
  if (isMetadataHost(host)) {
    return {
      ok: false,
      reason: `cloud metadata endpoint blocked: ${host}`,
      category: "ssrf-metadata",
    };
  }

  // Layer 3 — private / internal (skipped only when allowPrivateUrls is set).
  if (!opts?.allowPrivateUrls && isPrivateInternal(host)) {
    return {
      ok: false,
      reason: `private/internal address blocked: ${host}`,
      category: "ssrf-private",
    };
  }

  // Layer 5 — domain blocklist.
  const matched = matchBlocklist(host, opts?.blocklist);
  if (matched) {
    return {
      ok: false,
      reason: `host matches blocklist pattern: ${matched}`,
      category: "blocklist",
    };
  }

  return { ok: true };
}

/**
 * Layer 4 — post-redirect re-check. Applies the SAME gauntlet to the final URL
 * after HTTP redirects, so a 302 from a safe URL onto a metadata / private /
 * secret-bearing target is blocked before the body is returned. Delegates to
 * {@link checkUrl}.
 */
export function checkRedirect(finalUrl: string, opts?: SecurityGuardOptions): GuardDecision {
  return checkUrl(finalUrl, opts);
}

/** Check a single RESOLVED IP literal against the metadata floor + private /
 *  internal ranges. Returns a blocking decision, or null if the IP is
 *  acceptable. The metadata floor is UNCONDITIONAL (allowPrivateUrls cannot
 *  bypass it). */
function checkResolvedIp(ip: string, opts?: SecurityGuardOptions): GuardDecision | null {
  if (isMetadataHost(ip)) {
    return {
      ok: false,
      reason: `hostname resolved to cloud metadata endpoint: ${ip}`,
      category: "ssrf-metadata",
    };
  }
  if (!opts?.allowPrivateUrls && isPrivateInternal(ip)) {
    return {
      ok: false,
      reason: `hostname resolved to private/internal address: ${ip}`,
      category: "ssrf-private",
    };
  }
  return null;
}

/**
 * The full security gauntlet WITH DNS resolution. Runs the sync {@link checkUrl}
 * first (lexical checks + IP-literal ranges + metadata hostnames + blocklist),
 * then — if the host is a DNS name rather than an IP literal — resolves it via
 * the OS resolver (`node:dns/promises` lookup, respects `/etc/hosts`) and checks
 * EVERY resolved address against the metadata floor + private/internal ranges.
 *
 * **Fail-closed:** a DNS resolution error blocks the request — we cannot verify
 * the host is not private/metadata. (The fetch would fail anyway on an
 * unresolvable host, so there is no real availability cost.)
 *
 * Closes the common DNS-rebinding case: a hostname that DIRECTLY resolves to a
 * blocked IP. The full split-resolution TOCTOU (public-at-check,
 * private-at-connect) still requires connection-level IP pinning — see the file
 * header. Use this at connection boundaries (webFetch, browser_navigate); use
 * the sync {@link checkUrl} for routing decisions that must stay synchronous.
 */
export async function checkUrlAsync(
  rawUrl: string,
  opts?: SecurityGuardOptions,
): Promise<GuardDecision> {
  // 1. Full sync gauntlet (scheme, secret, metadata-hostname, IP-literal, blocklist).
  const syncDecision = checkUrl(rawUrl, opts);
  if (!syncDecision.ok) return syncDecision;

  // 2. Only DNS names need resolution (IP literals already checked by checkUrl).
  let host: string;
  try {
    host = normalizeHost(new URL(rawUrl).hostname);
  } catch {
    return { ok: true }; // sync check already passed; defensive.
  }
  if (isIP(host) !== 0) return { ok: true }; // IP literal — no DNS needed.

  // 3. Resolve via the OS resolver. Fail-closed on error.
  let addrs: { address: string; family: number }[];
  try {
    addrs = await resolveDns(host);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      reason: `DNS resolution failed for '${host}' (fail-closed): ${msg}`,
      category: "ssrf-private",
    };
  }

  // 4. ANY blocked resolved address blocks the request (an attacker controlling
  //    DNS can return multiple records; a single private/metadata hit suffices).
  //    Defense-in-depth: an empty answer is treated as fail-closed too.
  if (addrs.length === 0) {
    return {
      ok: false,
      reason: `DNS returned no records for '${host}' (fail-closed)`,
      category: "ssrf-private",
    };
  }
  for (const { address } of addrs) {
    const ipDecision = checkResolvedIp(address, opts);
    if (ipDecision && !ipDecision.ok) return ipDecision;
  }

  return { ok: true };
}

/** Async post-redirect re-check (layer 4) — delegates to {@link checkUrlAsync}
 *  so a redirect onto a private/metadata DNS name is caught and the body is
 *  withheld. */
export async function checkRedirectAsync(
  finalUrl: string,
  opts?: SecurityGuardOptions,
): Promise<GuardDecision> {
  return checkUrlAsync(finalUrl, opts);
}

/**
 * Layer 6 — bot-detection awareness. Scans a page title (or content snippet)
 * for anti-bot interstitial markers. Returns a WARNING only — never blocks.
 */
export function detectBot(title: string): BotDetectionResult {
  if (!title) return { detected: false, patterns: [] };
  const lower = title.toLowerCase();
  const found: string[] = [];
  for (const p of BOT_PATTERNS) {
    if (lower.includes(p)) found.push(p);
  }
  return { detected: found.length > 0, patterns: found };
}
