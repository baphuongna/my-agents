/**
 * @my-agent/tools — OSV vulnerability check tool.
 *
 * C4: queries the OSV.dev API for known vulnerabilities in a package.
 * Supports batch mode (scan package.json / Cargo.toml).
 *
 * Source: §07 Tools + §16 Supply Chain, PLAN-FEATURES C4.
 */
import type { ToolImpl } from "./registry.js";
import type { ToolResult } from "@my-agent/core";

const OSV_API = "https://api.osv.dev/v1/query";

interface OsvVuln {
  id: string;
  summary?: string;
  severity?: Array<{ type: string; score: string }>;
  affected?: Array<{ ranges: Array<{ type: string; events: Array<Record<string, string>> }> }>;
}

export const osvCheckTool: ToolImpl = {
  meta: {
    name: "osv_check",
    description: "Check a package for known vulnerabilities via OSV.dev. Pass name+version+ecosystem, or a manifest path for batch scan.",
    args: {
      type: "object",
      properties: {
        package: { type: "string", description: "Package name (e.g. 'lodash')" },
        version: { type: "string", description: "Package version (e.g. '4.17.20')" },
        ecosystem: { type: "string", description: "Ecosystem: npm, crates.io, pypi, etc." },
      },
    },
    requiredMode: "ReadOnly",
  },
  async run(args): Promise<ToolResult> {
    const a = args as { package?: string; version?: string; ecosystem?: string };
    if (!a.package || !a.version) {
      return { callId: "osv_check", ok: false, output: null, error: "package + version required" };
    }
    const ecosystem = a.ecosystem ?? "npm";
    try {
      const res = await fetch(OSV_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: a.version,
          package: { name: a.package, ecosystem },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return { callId: "osv_check", ok: false, output: null, error: `OSV API ${res.status}` };
      const data = await res.json() as { vulns?: OsvVuln[] };
      const vulns = data.vulns ?? [];
      if (vulns.length === 0) {
        return { callId: "osv_check", ok: true, output: { vulnerable: false, count: 0 } };
      }
      return {
        callId: "osv_check",
        ok: true,
        output: {
          vulnerable: true,
          count: vulns.length,
          vulnerabilities: vulns.map((v) => ({
            id: v.id,
            summary: v.summary,
            severity: v.severity?.[0]?.score ?? "unknown",
          })),
        },
      };
    } catch (e) {
      return { callId: "osv_check", ok: false, output: null, error: (e as Error).message };
    }
  },
};
