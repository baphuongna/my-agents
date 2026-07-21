/**
 * @my-agent/tools — URL safety / reputation check tool.
 *
 * C5: checks a URL against phishing/malware reputation services.
 * Complements the existing SSRF guard (security-guard.ts) which only checks
 * for private/internal IPs. This tool checks for KNOWN-BAD domains.
 *
 * Source: §07 Tools + §14 Security, PLAN-FEATURES C5.
 */
import type { ToolImpl } from "./registry.js";
import type { ToolResult } from "@my-agent/core";

// Internal blocklist of known-bad patterns (defense-in-depth, no API key needed).
const BLOCKED_PATTERNS = [
  /\bphishing\b/i,
  /\bmalware\b/i,
  /\b scam\b/i,
  /-login-secure\./i,
  /-verify-account\./i,
  /free-[a-z]+-download\./i,
  /\bbit\.ly\b/i, // shorteners often abused (warning, not block)
];

const SHORTENERS = new Set(["bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly"]);

export const urlSafetyTool: ToolImpl = {
  meta: {
    name: "check_url_safety",
    description: "Check a URL for phishing/malware reputation. Returns {safe, reasons[], warnings[]}. Uses internal heuristics + optional Google Safe Browsing API (MYA_SAFE_BROWSING_KEY).",
    args: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to check" },
      },
      required: ["url"],
    },
    requiredMode: "ReadOnly",
  },
  async run(args): Promise<ToolResult> {
    const a = args as { url?: string };
    if (!a.url) return { callId: "check_url_safety", ok: false, error: "url required" };

    let parsed: URL;
    try {
      parsed = new URL(a.url);
    } catch {
      return { callId: "check_url_safety", ok: false, error: "invalid URL" };
    }

    const reasons: string[] = [];
    const warnings: string[] = [];

    // 1. Internal heuristic check
    const urlString = a.url.toLowerCase();
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(urlString)) {
        reasons.push(`matched suspicious pattern: ${pattern.source}`);
      }
    }

    // 2. Shortener warning
    const hostname = parsed.hostname.toLowerCase();
    if (SHORTENERS.has(hostname)) {
      warnings.push(`URL shortener detected (${hostname}) — destination unknown`);
    }

    // 3. Suspicious TLD warning
    const suspiciousTlds = [".tk", ".ml", ".ga", ".cf", ".gq"];
    if (suspiciousTlds.some((tld) => hostname.endsWith(tld))) {
      warnings.push(`suspicious TLD: ${hostname}`);
    }

    // 4. IP address as hostname (often phishing)
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
      warnings.push("raw IP address as hostname");
    }

    // 5. Optional Google Safe Browsing API check
    const sbKey = process.env.MYA_SAFE_BROWSING_KEY;
    if (sbKey) {
      try {
        const sbRes = await fetch(
          `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${sbKey}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              threatInfo: {
                threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE"],
                platformTypes: ["ANY_PLATFORM"],
                threatEntryTypes: ["URL"],
                threatEntries: [{ url: a.url }],
              },
            }),
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (sbRes.ok) {
          const sbData = await sbRes.json() as { matches?: Array<{ threatType: string }> };
          if (sbData.matches?.length) {
            for (const m of sbData.matches) {
              reasons.push(`Safe Browsing: ${m.threatType}`);
            }
          }
        }
      } catch {
        // Safe Browsing API failure is non-fatal — fall back to heuristics only.
      }
    }

    const safe = reasons.length === 0;
    return {
      callId: "check_url_safety",
      ok: true,
      output: { safe, reasons, warnings, hostname },
    };
  },
};
