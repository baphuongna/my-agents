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

// Internal blocklist of known-bad hostname patterns (defense-in-depth, no API key needed).
// R1-fix: match hostname ONLY (not path/query) to avoid false positives on
// legitimate security-research URLs like wikipedia.org/wiki/Malware.
const BLOCKED_HOSTNAMES = [
  /-login-secure\./i,
  /-verify-account\./i,
  /free-[a-z]+-download\./i,
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
    if (!a.url) return { callId: "check_url_safety", ok: false, output: null, error: "url required" };

    let parsed: URL;
    try {
      parsed = new URL(a.url);
    } catch {
      return { callId: "check_url_safety", ok: false, output: null, error: "invalid URL" };
    }

    const reasons: string[] = [];
    const warnings: string[] = [];

    const hostname = parsed.hostname.toLowerCase();

    // 1. Internal heuristic check (hostname only — R1-fix)
    for (const pattern of BLOCKED_HOSTNAMES) {
      if (pattern.test(hostname)) {
        reasons.push(`matched suspicious hostname pattern: ${pattern.source}`);
      }
    }

    // 2. Shortener warning
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
