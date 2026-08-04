import { describe, it, expect } from "vitest";
import { generatePkce, buildAuthUrl, verifyCallbackState, verifyPkce } from "./oauth.js";

describe("[unit] ai oauth PKCE", () => {
  it("generatePkce produces valid pair", () => {
    const pkce = generatePkce();
    expect(pkce.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pkce.challenge).toBeTypeOf("string");
    expect(pkce.method).toBe("S256");
  });

  it("generatePkce is non-deterministic", () => {
    expect(generatePkce().verifier).not.toBe(generatePkce().verifier);
  });

  it("verifyPkce: valid pair → true", () => {
    const pkce = generatePkce();
    expect(verifyPkce(pkce.verifier, pkce.challenge)).toBe(true);
  });

  it("verifyPkce: wrong verifier → false", () => {
    const pkce = generatePkce();
    expect(verifyPkce("wrong-verifier", pkce.challenge)).toBe(false);
  });

  it("buildAuthUrl produces URL with PKCE params", () => {
    const pkce = generatePkce();
    const req = buildAuthUrl({
      authEndpoint: "https://provider.com/auth",
      clientId: "my-client",
      redirectUri: "http://127.0.0.1:1234/callback",
      scopes: ["read", "write"],
      pkce,
    });
    expect(req.url).toContain("provider.com/auth");
    expect(req.url).toContain("code_challenge=");
    expect(req.url).toContain("code_challenge_method=S256");
    expect(req.url).toContain("client_id=my-client");
    expect(req.url).toContain("response_type=code");
    expect(req.state).toBeTypeOf("string");
  });

  it("buildAuthUrl with custom state", () => {
    const pkce = generatePkce();
    const req = buildAuthUrl({
      authEndpoint: "https://x", clientId: "c", redirectUri: "r", scopes: [], pkce, state: "mystate",
    });
    expect(req.state).toBe("mystate");
    expect(req.url).toContain("state=mystate");
  });

  it("verifyCallbackState: matching → no throw", () => {
    expect(() => verifyCallbackState("abc", { code: "x", state: "abc" })).not.toThrow();
  });

  it("verifyCallbackState: mismatch → throws", () => {
    expect(() => verifyCallbackState("abc", { code: "x", state: "xyz" })).toThrow(/state/);
  });
});
