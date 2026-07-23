import { describe, it, expect } from "vitest";
import {
  SecretStore,
  makeSecretRedactor,
  resolveSecret,
  fingerprint,
  SecretError,
} from "@my-agent/secrets";
import type { SecretRef } from "@my-agent/secrets";

describe("Secrets — fail-closed resolution (§14.2)", () => {
  it("resolveSecret throws on MISSING env (fail-closed, never empty fallback)", () => {
    delete process.env.MISSING_TEST_KEY;
    expect(() => resolveSecret({ from: "env", ref: "MISSING_TEST_KEY" })).toThrow();
  });

  it("resolveSecret throws on EMPTY env value", () => {
    process.env.EMPTY_TEST_KEY = "";
    expect(() => resolveSecret({ from: "env", ref: "EMPTY_TEST_KEY" })).toThrow();
  });

  it("SecretStore.resolve returns the live value when present", () => {
    process.env.LIVE_TEST_KEY = "sk-live-123";
    const store = new SecretStore();
    expect(store.resolve({ from: "env", ref: "LIVE_TEST_KEY" })).toBe("sk-live-123");
  });
});

describe("Secrets — structural redactor (H2: by field-name + by value)", () => {
  it("redacts by VALUE: a known secret string anywhere in payload", () => {
    process.env.KNOWN = "sk-secret-xyz";
    const store = new SecretStore();
    store.resolve({ from: "env", ref: "KNOWN" });
    const red = makeSecretRedactor(store);
    const out = red({ cmd: "echo sk-secret-xyz", other: "safe" });
    expect(JSON.stringify(out)).not.toContain("sk-secret-xyz");
    expect(JSON.stringify(out)).toContain("<secret:");
  });

  it("H2: redacts by FIELD-NAME even when value is split / non-string / unregistered", () => {
    const store = new SecretStore();
    const red = makeSecretRedactor(store);
    const out = red({
      config: { api_key: "sk-AB", token: "part2", password: 12345, credential: true },
    }) as { config: Record<string, string> };
    expect(out.config.api_key).toContain("<redacted");
    expect(out.config.token).toContain("<redacted");
    expect(String(out.config.password)).toContain("<redacted");
    expect(String(out.config.credential)).toContain("<redacted");
  });

  it("leaves non-secret fields untouched", () => {
    const store = new SecretStore();
    const red = makeSecretRedactor(store);
    const out = red({ path: "/tmp/x", count: 5, name: "agent" });
    expect(out).toEqual({ path: "/tmp/x", count: 5, name: "agent" });
  });
});

// ─── fingerprint (short audit fingerprint, never the value) ───────────────

describe("fingerprint — audit-safe short hash (§14.1)", () => {
  it("returns a 12-char lowercase hex string", () => {
    const fp = fingerprint("super-secret-value");
    expect(fp).toMatch(/^[0-9a-f]{12}$/);
  });

  it("is deterministic: identical input → identical fingerprint", () => {
    expect(fingerprint("sk-abc-123")).toBe(fingerprint("sk-abc-123"));
  });

  it("is a SHA-256 prefix (first 12 hex of the known vector)", () => {
    // sha256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    expect(fingerprint("hello")).toBe("2cf24dba5fb0");
  });

  it("differs for distinct secret values", () => {
    expect(fingerprint("alpha")).not.toBe(fingerprint("beta"));
  });

  it("does not leak the secret value itself", () => {
    const fp = fingerprint("never-echo-this-plaintext");
    expect(fp).not.toContain("never");
    expect(fp).not.toContain("plaintext");
  });
});

// ─── SecretError (fail-closed error type) ─────────────────────────────────

describe("SecretError — fail-closed secret error (§14.2)", () => {
  const ref: SecretRef = { from: "env", ref: "MY_MISSING_KEY" };

  it("is an Error subclass", () => {
    const e = new SecretError(ref, "env var not set");
    expect(e).toBeInstanceOf(Error);
  });

  it("sets name to 'SecretError'", () => {
    const e = new SecretError(ref, "missing");
    expect(e.name).toBe("SecretError");
  });

  it("exposes the ref (from + ref) + descriptive message", () => {
    const e = new SecretError(ref, "env var not set");
    expect(e.ref).toEqual(ref);
    expect(e.message).toContain("env:MY_MISSING_KEY");
    expect(e.message).toContain("env var not set");
  });

  it("is thrown by resolveSecret on a missing env var", () => {
    delete process.env.SECRET_ERROR_TEST_KEY;
    try {
      resolveSecret({ from: "env", ref: "SECRET_ERROR_TEST_KEY" });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SecretError);
      expect((e as SecretError).ref.from).toBe("env");
    }
  });

  it("formats the from/ref prefix for each backend in the message", () => {
    const cases: Array<[SecretRef, string]> = [
      [{ from: "env", ref: "X" }, "env:X"],
      [{ from: "file", ref: "/p/secret" }, "file:/p/secret"],
      [{ from: "exec", ref: "vault://k" }, "exec:vault://k"],
      [{ from: "keyring", ref: "svc/acct" }, "keyring:svc/acct"],
    ];
    for (const [r, prefix] of cases) {
      const e = new SecretError(r, "boom");
      expect(e.message).toContain(prefix);
    }
  });
});
