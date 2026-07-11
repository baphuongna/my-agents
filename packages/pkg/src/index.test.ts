import { describe, it, expect } from "vitest";
import { PackageHost } from "@my-agent/pkg";

describe("PackageHost — apiVersion intersect (F8) + verify (§17)", () => {
  it("F8: rejects a malformed apiVersion major (1abc)", async () => {
    const host = new PackageHost({ supportedApiVersions: ["1.x"] });
    await expect(
      host.register({ name: "bad", version: "1.0.0", kind: ["extensions"], apiVersion: "1abc" }, async () => ({})),
    ).rejects.toThrow(/api-version/i);
  });

  it("accepts a clean matching apiVersion", async () => {
    const host = new PackageHost({ supportedApiVersions: ["1.x"] });
    const r = await host.register({ name: "ok", version: "1.0.0", kind: ["extensions"], apiVersion: "1.2.0" }, async () => ({}));
    expect(r.manifest.name).toBe("ok");
  });

  it("rejects an unsupported major", async () => {
    const host = new PackageHost({ supportedApiVersions: ["1.x"] });
    await expect(
      host.register({ name: "v2", version: "2.0.0", kind: ["extensions"], apiVersion: "2.0.0" }, async () => ({})),
    ).rejects.toThrow(/api-version/i);
  });

  it("activate/deactivate lifecycle", async () => {
    const host = new PackageHost({ supportedApiVersions: ["1.x"] });
    const r = await host.register({ name: "p", version: "1.0.0", kind: ["extensions"], apiVersion: "1.0.0" }, async () => ({ hi: () => 1 }));
    expect(r.activated).toBe(false); // register does not auto-activate
    host.activate("p");
    expect(host.list().find((x) => x.manifest.name === "p")?.activated).toBe(true);
    host.deactivate("p");
    expect(host.list().find((x) => x.manifest.name === "p")?.activated).toBe(false);
  });
});
