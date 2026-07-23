import { describe, it, expect, vi, afterEach } from "vitest";
import {
  verifyTarball,
  fileSha256,
  digestSha256,
  fetchNpmProvenance,
  hasNpmProvenance,
  signTarball,
} from "@my-agent/signing";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Signing — verifyTarball is FAIL-CLOSED (C2)", () => {
  const dir = mkdtempSync(join(tmpdir(), "sign-"));
  const tarball = join(dir, "pkg.tgz");
  writeFileSync(tarball, "hello-world");

  it("rejects when tarball is missing", async () => {
    const r = await verifyTarball({ tarballSha256: "x", sigstoreBundle: "y" } as never, "/nonexistent/missing.tgz");
    expect(r.ok).toBe(false);
  });

  it("rejects on digest mismatch", async () => {
    const r = await verifyTarball({ tarballSha256: "deadbeef", sigstoreBundle: "y" } as never, tarball);
    expect(r.ok).toBe(false);
  });

  it("C2 fix: fail-closed when sigstore module is absent (correct digest, but unverifiable signature)", async () => {
    // Correct digest, a bundle present — but the `sigstore` npm module is not
    // installed in this repo, so verification cannot SUCCEED. It must reject.
    const realDigest = fileSha256(tarball);
    const r = await verifyTarball({ tarballSha256: realDigest, sigstoreBundle: "fake-bundle" } as never, tarball);
    expect(r.ok).toBe(false);
  });

  it("digestSha256 is stable + hex", () => {
    const d = digestSha256("abc");
    expect(d).toMatch(/^[0-9a-f]{64}$/);
    expect(d).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("fileSha256 reads a file + returns hex", () => {
    expect(fileSha256(tarball)).toMatch(/^[0-9a-f]{64}$/);
  });
});

afterEach(() => vi.unstubAllGlobals());

// ─── npm provenance (SLSA) consumer-side fetch ────────────────────────────

describe("fetchNpmProvenance — npm dist-attestation lookup", () => {
  it("returns parsed attestations on a valid 200 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            attestations: [
              { bundle: { b: 1 }, attestationType: "https://slsa.dev/provenance/v1" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )),
    );
    const atts = await fetchNpmProvenance("@scope/pkg", "1.2.3");
    expect(atts).not.toBeNull();
    expect(atts).toHaveLength(1);
    expect(atts![0]!.pkg).toBe("@scope/pkg");
    expect(atts![0]!.version).toBe("1.2.3");
    expect(atts![0]!.attestationType).toBe("https://slsa.dev/provenance/v1");
  });

  it("defaults attestationType to the SLSA v1 URL when omitted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ attestations: [{ bundle: "x" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        )),
    );
    const atts = await fetchNpmProvenance("pkg", "0.0.1");
    expect(atts![0]!.attestationType).toBe("https://slsa.dev/provenance/v1");
  });

  it("returns null on a non-OK response (e.g. 404 not found)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 })),
    );
    expect(await fetchNpmProvenance("missing", "9.9.9")).toBeNull();
  });

  it("returns null when the response has no attestations field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        })),
    );
    expect(await fetchNpmProvenance("pkg", "1.0.0")).toBeNull();
  });

  it("returns null on a network error (fail-soft, no throw)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ETIMEDOUT"); }));
    expect(await fetchNpmProvenance("pkg", "1.0.0")).toBeNull();
  });

  it("targets the provided custom registry URL", async () => {
    const spy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", spy);
    await fetchNpmProvenance("pkg", "1.0.0", "https://mirror.local");
    expect(spy).toHaveBeenCalledWith("https://mirror.local/attestations/pkg@1.0.0");
  });
});

describe("hasNpmProvenance — boolean provenance predicate", () => {
  it("returns true when attestations are present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ attestations: [{ bundle: "x" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        )),
    );
    expect(await hasNpmProvenance("pkg", "1.0.0")).toBe(true);
  });

  it("returns false when there are no attestations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 })),
    );
    expect(await hasNpmProvenance("pkg", "1.0.0")).toBe(false);
  });
});

// ─── signTarball (sigstore — fail-closed when dep absent) ──────────────────

describe("signTarball — sigstore signing", () => {
  const dir = mkdtempSync(join(tmpdir(), "sign-tb-"));
  const tarball = join(dir, "pkg.tgz");
  writeFileSync(tarball, "tarball-bytes");

  it("throws fail-closed outside a signing environment (no OIDC token)", async () => {
    // Outside CI/OIDC the sigstore keyless flow cannot retrieve an identity
    // token. signTarball must reject rather than silently produce an unsigned
    // bundle — the fail-closed behavior is what matters here.
    await expect(
      signTarball({ packageName: "pkg", version: "1.0.0", tarballPath: tarball }),
    ).rejects.toThrow();
  });
});
