/**
 * @my-agent/ai — Provider package discovery (boot-time, no runtime install).
 *
 * B1: scans for provider manifests in node_modules/@mya/provider-* and
 * ~/.mya/providers/*.json. Pre-installed packages are discovered at boot.
 *
 * Source: §06 ProviderProfile + §17 Extension Model, PLAN-FEATURES B1.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ProviderProfile } from "@my-agent/core";

/** A declarative provider manifest (§17 PackageManifest extension). */
export interface ProviderPackageManifest {
  name: string;
  version: string;
  apiVersion: string;
  id: string;
  baseUrl: string;
  envVar: string;
  defaultModel: string;
  models?: string[];
  supportsVision?: boolean;
}

/** Scan for provider manifests at boot-time. Returns parsed manifests. */
export function scanProviders(): ProviderPackageManifest[] {
  const manifests: ProviderPackageManifest[] = [];

  // 1. Scan ~/.mya/providers/*.json
  const userProvidersDir = join(homedir(), ".mya", "providers");
  if (existsSync(userProvidersDir)) {
    try {
      for (const file of readdirSync(userProvidersDir)) {
        if (!file.endsWith(".json")) continue;
        try {
          const raw = JSON.parse(readFileSync(join(userProvidersDir, file), "utf8"));
          if (isValidManifest(raw)) manifests.push(raw);
        } catch { /* skip corrupt */ }
      }
    } catch { /* dir read error */ }
  }

  // 2. Scan node_modules/@mya/provider-* (if they ship manifest.json)
  try {
    const nmDir = join(process.cwd(), "node_modules", "@mya");
    if (existsSync(nmDir)) {
      for (const dir of readdirSync(nmDir)) {
        if (!dir.startsWith("provider-")) continue;
        const manifestPath = join(nmDir, dir, "manifest.json");
        if (!existsSync(manifestPath)) continue;
        try {
          const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
          if (isValidManifest(raw)) manifests.push(raw);
        } catch { /* skip */ }
      }
    }
  } catch { /* nm scan error */ }

  return manifests;
}

/** Check if a discovered provider is configured (env var set). */
export function isProviderConfigured(manifest: ProviderPackageManifest): boolean {
  return !!process.env[manifest.envVar];
}

/** Build a ProviderProfile from a manifest (when configured). */
export function manifestToProfile(manifest: ProviderPackageManifest): ProviderProfile | null {
  if (!isProviderConfigured(manifest)) return null;
  // Return a profile stub — the actual adapter creation happens in the
  // OpenAI-compatible adapter or PiAiProviderBridge.
  return {
    id: manifest.id,
    model: process.env[`${manifest.envVar}_MODEL`] ?? manifest.defaultModel,
    stream: async () => ({ events: [] }),
    health: () => "Healthy" as const,
  };
}

/** Get all configured providers from discovered manifests. */
export function getConfiguredProviders(): ProviderProfile[] {
  return scanProviders()
    .map(manifestToProfile)
    .filter((p): p is ProviderProfile => p !== null);
}

function isValidManifest(raw: unknown): raw is ProviderPackageManifest {
  if (typeof raw !== "object" || raw === null) return false;
  const m = raw as Record<string, unknown>;
  return typeof m.name === "string" &&
    typeof m.id === "string" &&
    typeof m.baseUrl === "string" &&
    typeof m.envVar === "string";
}
