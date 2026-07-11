import { describe, it, expect } from "vitest";
import { SecretStore, makeSecretRedactor, resolveSecret } from "@my-agent/secrets";

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
