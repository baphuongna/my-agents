/**
 * @my-agent/pkg — extension package host (§17).
 *
 * Four extension kinds (§17): extensions (tools/commands/events/UI), skills,
 * prompt-templates, themes. Each ships an `agent-package.json` manifest. Core =
 * interfaces + host; packages = implementations. Core stays frozen; packages
 * register at install time.
 *
 * Lifecycle (R25-27): install (--ignore-scripts) → verify(apiVersion + signature)
 * → register → (lazy) activate.
 *
 * Trust model (R30): packages run IN-PROCESS (loaded via jiti/dynamic import) —
 * TRUSTED CODE, same trust as any npm dependency. The ONLY hard gate for NATIVE
 * code is the third-party napi sigstore + content-hash policy (§14b, delegated
 * to @my-agent/natives.verifyNativeDeclaration).
 *
 * Source: §17 Extension Model; pi-coding-agent philosophy, hermes lazy_deps.
 */
import { verifyNativeDeclaration, type NativeDeclaration } from "@my-agent/natives";

/** The four extension kinds (§17). */
export type PackageKind = "extensions" | "skills" | "prompt-templates" | "themes";

/** A package manifest (§17 `agent-package.json`). */
export interface PackageManifest {
  name: string;
  version: string;
  kind: PackageKind[];
  /** Must intersect core's supported apiVersion range, or refuse-load. */
  apiVersion: string;
  provides?: { tools?: string[]; skills?: string[] };
  /** Advisory intent declarations (NOT a boundary — R30). */
  permissions?: { tools?: string[]; egress?: string[] };
  /** Prebuilt napi binary declaration (§14b RELEASE-BLOCKER if present). */
  native?: NativeDeclaration & { abiStamp: string; napiVersion: number };
  /** Install-time scripts; run AFTER verify. No OS sandbox (R30). */
  scripts?: string[];
}

/** A registered package (post-verify, pre/post-activate). */
export interface RegisteredPackage {
  manifest: PackageManifest;
  /** The loaded module (in-process, trusted). */
  module: unknown;
  activated: boolean;
  registeredAt: number;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "api-version" | "native-signature" | "native-missing" | "load-failed"; detail: string };

/** Parse a semver-ish range like "^1.0.0" / ">=1 <2" / "1.x" into a {min,maj}
 * intersect check. Deliberately simple (npm semver-range intersect is heavy). */
function apiVersionIntersects(declared: string, supported: string[]): boolean {
  // supported = e.g. ["1.x", "2.0.x"]; declared = "1.2.0"
  const dmajor = parseInt(declared.split(".")[0] ?? "0", 10);
  return supported.some((s) => {
    const smajor = parseInt(s.split(".")[0] ?? "0", 10);
    return smajor === dmajor;
  });
}

/** The package host: verify → register → (lazy) activate. Core stays frozen. */
export class PackageHost {
  private readonly registry = new Map<string, RegisteredPackage>();
  /** Supported apiVersion ranges (the core advertises these). */
  constructor(private readonly supportedApiVersions: string[] = ["1.x"]) {}

  /** Verify a manifest before load (§17 lifecycle). apiVersion intersect + the
   * native sigstore/content-hash gate (§14b). */
  verify(manifest: PackageManifest): VerifyResult {
    if (!apiVersionIntersects(manifest.apiVersion, this.supportedApiVersions)) {
      return {
        ok: false,
        reason: "api-version",
        detail: `manifest apiVersion ${manifest.apiVersion} does not intersect supported ${this.supportedApiVersions.join(",")}`,
      };
    }
    if (manifest.native) {
      const v = verifyNativeDeclaration(manifest.native);
      if (!v.ok) {
        return { ok: false, reason: "native-signature", detail: v.detail };
      }
    }
    return { ok: true };
  }

  /** Verify + register a package (load the module in-process, trusted). */
  async register(manifest: PackageManifest, loader: () => Promise<unknown>): Promise<RegisteredPackage> {
    const v = this.verify(manifest);
    if (!v.ok) throw new Error(`package ${manifest.name} refused-load: ${v.reason} (${v.detail})`);
    let module: unknown;
    try {
      module = await loader();
    } catch (e) {
      throw new Error(`package ${manifest.name} load-failed: ${(e as Error).message}`);
    }
    const reg: RegisteredPackage = { manifest, module, activated: false, registeredAt: Date.now() };
    this.registry.set(manifest.name, reg);
    return reg;
  }

  /** Lazily activate a registered package (call its activate() if present). */
  activate(name: string): void {
    const reg = this.registry.get(name);
    if (!reg) throw new Error(`package ${name} not registered`);
    const mod = reg.module as { activate?: () => void };
    if (mod && typeof mod.activate === "function") mod.activate();
    reg.activated = true;
  }

  /** Deactivate (call deactivate() if present). */
  deactivate(name: string): void {
    const reg = this.registry.get(name);
    if (!reg) return;
    const mod = reg.module as { deactivate?: () => void };
    if (mod && typeof mod.deactivate === "function") mod.deactivate();
    reg.activated = false;
  }

  get(name: string): RegisteredPackage | undefined {
    return this.registry.get(name);
  }
  list(): RegisteredPackage[] {
    return [...this.registry.values()];
  }
  /** Unregister (refuses if still activated — deactivate first). */
  unregister(name: string): void {
    const reg = this.registry.get(name);
    if (reg?.activated) throw new Error(`package ${name} still activated — deactivate first`);
    this.registry.delete(name);
  }
}
