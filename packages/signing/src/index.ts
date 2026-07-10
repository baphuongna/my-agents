/**
 * @my-agent/signing — package provenance + sigstore signing (§16/§17/§23 #6).
 *
 * Two complementary supply-chain mechanisms:
 *   1. **npm provenance** (SLSA): `npm publish --provenance` from GitHub Actions
 *      with OIDC produces a tamper-evident build provenance attestation, queryable
 *      via the npm registry (`npm view <pkg> --json` → distattestations). This
 *      package provides the consumer-side verification helper.
 *   2. **sigstore** (§23 #6's chosen scheme): sign a package tarball's digest with
 *      a sigstore identity (keyless via OIDC, or a key). The release workflow
 *      signs; the consumer verifies the bundle before activation.
 *
 * The spec resolves §23 #6: sigstore is the scheme; for third-party NATIVE
 * packages it is a release-blocker (§14b). npm provenance is the additional
 * npm-native attestation for non-native packages.
 *
 * Source: §16 Supply Chain, §17 Extension Model, §23 #6 (sigstore resolved).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

/** A sigstore bundle for a package tarball (the release artifact). */
export interface SigstoreBundle {
  packageName: string;
  version: string;
  /** SHA-256 of the tarball bytes. */
  tarballSha256: string;
  /** The sigstore bundle (DSSE envelope / message signature), opaque here. */
  signatureBundle: unknown;
  /** Identity that signed (OIDC issuer + subject, or a key id). */
  signer: { issuer?: string; subject?: string; keyId?: string };
}

// ─── digest ──────────────────────────────────────────────────────────────────

/** SHA-256 hex of a file's bytes. */
export function fileSha256(path: string): string {
  if (!existsSync(path)) throw new Error(`signing: file not found: ${path}`);
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** SHA-256 hex of a string/buffer. */
export function digestSha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

// ─── sigstore sign/verify (uses the optional `sigstore` npm package) ──────────

/**
 * Sign a package tarball with sigstore (keyless via OIDC in CI, or a key
 * locally). Returns a SigstoreBundle. Requires the optional `sigstore` dep.
 * Fail-closed: throws if sigstore isn't installed.
 */
export async function signTarball(opts: {
  packageName: string;
  version: string;
  tarballPath: string;
  /** Identity hint (for keyless, the OIDC flow handles this in CI). */
  signer?: { issuer?: string; subject?: string; keyId?: string };
}): Promise<SigstoreBundle> {
  const mod = (await importSigstore()) as {
    sign?: (payload: Buffer) => Promise<unknown>;
  };
  if (!mod.sign) throw new Error("signing: sigstore.sign unavailable");
  const payload = readFileSync(opts.tarballPath);
  const signatureBundle = await mod.sign(payload);
  return {
    packageName: opts.packageName,
    version: opts.version,
    tarballSha256: digestSha256(payload),
    signatureBundle,
    signer: opts.signer ?? {},
  };
}

/**
 * Verify a SigstoreBundle against a tarball. Checks: tarball digest matches the
 * bundle's recorded digest, AND the sigstore signature verifies (requires the
 * optional `sigstore` dep). Returns ok/reason.
 */
export async function verifyTarball(
  bundle: SigstoreBundle,
  tarballPath: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!existsSync(tarballPath)) return { ok: false, reason: `tarball missing: ${tarballPath}` };
  const actual = fileSha256(tarballPath);
  if (actual !== bundle.tarballSha256) {
    return { ok: false, reason: `tarball digest mismatch (expected ${bundle.tarballSha256}, got ${actual})` };
  }
  try {
    // C2 (security review): FAIL CLOSED. A missing signature bundle or a
    // missing sigstore module must NOT verify. The digest match above is
    // necessary but never sufficient.
    if (!bundle.signatureBundle) {
      return { ok: false, reason: "no signature bundle (sigstore required)" };
    }
    const mod = (await importSigstore()) as { verify?: (payload: Buffer, bundle: unknown) => Promise<boolean> };
    if (!mod.verify) {
      return { ok: false, reason: "sigstore module not installed (cannot verify)" };
    }
    const ok = await mod.verify(readFileSync(tarballPath), bundle.signatureBundle);
    return ok ? { ok: true } : { ok: false, reason: "sigstore signature did not verify" };
  } catch (e) {
    return { ok: false, reason: `sigstore verify error: ${(e as Error).message}` };
  }
}

/** Dynamically import the optional sigstore dep (graceful if absent). */
async function importSigstore(): Promise<Record<string, unknown>> {
  try {
    return await import("sigstore");
  } catch {
    return {};
  }
}

// ─── npm provenance (SLSA) consumer-side check ───────────────────────────────

/** A npm registry dist-attestation (provenance) entry. */
export interface NpmAttestation {
  pkg: string;
  version: string;
  /** The attestation type (e.g. "https://slsa.dev/provenance/v1"). */
  attestationType: string;
  /** The attestation bundle (DSSE), opaque here. */
  bundle: unknown;
}

/**
 * Fetch + parse a package's npm dist-attestations (provenance). Requires network
 * (npm registry). Returns the attestations or null if none / fetch fails. The
 * release workflow produces these via `npm publish --provenance` from GHA OIDC.
 */
export async function fetchNpmProvenance(pkg: string, version: string, registry = "https://registry.npmjs.org"): Promise<NpmAttestation[] | null> {
  try {
    const resp = await fetch(`${registry}/attestations/${pkg}@${version}`);
    if (!resp.ok) return null;
    const data = (await resp.json()) as { attestations?: Array<{ bundle: unknown; attestationType?: string }> };
    if (!data.attestations) return null;
    return data.attestations.map((a) => ({
      pkg,
      version,
      attestationType: a.attestationType ?? "https://slsa.dev/provenance/v1",
      bundle: a.bundle,
    }));
  } catch {
    return null;
  }
}

/** Does a package version have npm SLSA provenance? */
export async function hasNpmProvenance(pkg: string, version: string): Promise<boolean> {
  const atts = await fetchNpmProvenance(pkg, version);
  return (atts?.length ?? 0) > 0;
}
