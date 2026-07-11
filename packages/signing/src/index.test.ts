import { describe, it, expect } from "vitest";
import { verifyTarball, fileSha256, digestSha256 } from "@my-agent/signing";
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
