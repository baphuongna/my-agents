/**
 * Feature 2.3 — OAuth flow (Device-code + authorization-code)
 *
 * FIXED to match actual API: packages/ai/src/oauth.ts
 * - generatePkce(byteLen) → { verifier, challenge, method }
 * - buildAuthUrl({authEndpoint, clientId, redirectUri, scopes[], pkce, state?}) → AuthRequest
 * - exchangeCode({tokenEndpoint, clientId, code, redirectUri, verifier})
 * - refreshAccessToken({tokenEndpoint, clientId, refreshToken})
 * - TokenResponse uses snake_case: access_token, refresh_token, expires_in
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	generatePkce,
	buildAuthUrl,
	verifyCallbackState,
	exchangeCode,
	refreshAccessToken,
} from "../../../packages/ai/src/oauth.ts";

// ──────────────────────────────────────────────────────────────
// UNIT — PKCE
// ──────────────────────────────────────────────────────────────

describe("[unit] generatePkce", () => {
	it("generates verifier and challenge", () => {
		const p = generatePkce();
		expect(p.verifier).toBeTruthy();
		expect(p.challenge).toBeTruthy();
		expect(p.method).toBe("S256");
	});

	it("defaults to 32 bytes (43 chars)", () => {
		const p = generatePkce();
		// 32 bytes → base64url → 43 chars (no padding)
		expect(p.verifier.length).toBeGreaterThanOrEqual(43);
	});

	it("produces unique pairs each call", () => {
		const a = generatePkce();
		const b = generatePkce();
		expect(a.verifier).not.toBe(b.verifier);
		expect(a.challenge).not.toBe(b.challenge);
	});

	it("verifier is base64url", () => {
		const p = generatePkce();
		expect(p.verifier).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it("challenge is base64url", () => {
		const p = generatePkce();
		expect(p.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it("challenge !== verifier (SHA256)", () => {
		const p = generatePkce();
		expect(p.challenge).not.toBe(p.verifier);
	});

	it("respects byteLen argument", () => {
		const p16 = generatePkce(16);
		const p64 = generatePkce(64);
		expect(p16.verifier.length).toBeLessThan(p64.verifier.length);
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — buildAuthUrl
// ──────────────────────────────────────────────────────────────

describe("[unit] buildAuthUrl", () => {
	const pkce = generatePkce();
	const baseOpts = {
		authEndpoint: "https://example.com/oauth/authorize",
		clientId: "client-123",
		redirectUri: "http://localhost:3999/callback",
		scopes: ["read", "write"],
		pkce,
	};

	it("returns AuthRequest with url + state", () => {
		const r = buildAuthUrl(baseOpts);
		expect(r.url).toBeTruthy();
		expect(r.state).toBeTruthy();
		expect(r.pkce).toBe(pkce);
	});

	it("url includes client_id", () => {
		const r = buildAuthUrl(baseOpts);
		expect(r.url).toContain("client_id=client-123");
	});

	it("url includes response_type=code", () => {
		const r = buildAuthUrl(baseOpts);
		expect(r.url).toContain("response_type=code");
	});

	it("url includes PKCE challenge", () => {
		const r = buildAuthUrl(baseOpts);
		expect(r.url).toContain("code_challenge=");
		expect(r.url).toContain("code_challenge_method=S256");
	});

	it("url includes scopes (space-joined)", () => {
		const r = buildAuthUrl(baseOpts);
		expect(r.url).toContain("scope=read+write");
	});

	it("url includes redirect_uri", () => {
		const r = buildAuthUrl(baseOpts);
		expect(r.url).toContain("redirect_uri=");
	});

	it("url includes state (CSRF token)", () => {
		const r = buildAuthUrl(baseOpts);
		expect(r.url).toContain("state=");
	});

	it("generates random state when not provided", () => {
		const r1 = buildAuthUrl(baseOpts);
		const r2 = buildAuthUrl(baseOpts);
		expect(r1.state).not.toBe(r2.state);
	});

	it("accepts explicit state", () => {
		const r = buildAuthUrl({ ...baseOpts, state: "my-state" });
		expect(r.state).toBe("my-state");
		expect(r.url).toContain("state=my-state");
	});

	it("url parses to valid URL object", () => {
		const r = buildAuthUrl(baseOpts);
		const u = new URL(r.url);
		expect(u.origin).toBe("https://example.com");
		expect(u.pathname).toBe("/oauth/authorize");
	});

	it("empty scopes array → empty scope param", () => {
		const r = buildAuthUrl({ ...baseOpts, scopes: [] });
		// scope= (empty) or omitted
		expect(r.url).toMatch(/scope=(?:&|$)/);
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — verifyCallbackState
// ──────────────────────────────────────────────────────────────

describe("[unit] verifyCallbackState", () => {
	it("passes when states match", () => {
		expect(() => verifyCallbackState("abc", { state: "abc" } as any)).not.toThrow();
	});

	it("throws on state mismatch", () => {
		expect(() => verifyCallbackState("abc", { state: "xyz" } as any)).toThrow();
	});

	it("throws on empty result state", () => {
		expect(() => verifyCallbackState("abc", { state: "" } as any)).toThrow();
	});

	it("error mentions CSRF/security", () => {
		try {
			verifyCallbackState("abc", { state: "wrong" } as any);
			expect.unreachable("should throw");
		} catch (e: any) {
			expect(e.message).toMatch(/state|csrf/i);
		}
	});

	it("case-sensitive comparison", () => {
		expect(() => verifyCallbackState("ABC", { state: "ABC" } as any)).not.toThrow();
		expect(() => verifyCallbackState("ABC", { state: "abc" } as any)).toThrow();
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — exchangeCode (mocked fetch)
// ──────────────────────────────────────────────────────────────

describe("[unit] exchangeCode", () => {
	const origFetch = globalThis.fetch;
	afterEach(() => { globalThis.fetch = origFetch; });

	it("rejects on 4xx response", async () => {
		globalThis.fetch = (async () => ({
			ok: false,
			status: 400,
			statusText: "Bad Request",
			text: async () => "invalid_grant",
		}) as any);
		await expect(exchangeCode({
			tokenEndpoint: "https://example.com/token",
			clientId: "x",
			code: "y",
			redirectUri: "http://localhost:0",
			verifier: "z",
		})).rejects.toThrow();
	});

	it("parses 200 JSON response", async () => {
		globalThis.fetch = (async () => ({
			ok: true,
			status: 200,
			json: async () => ({
				access_token: "at",
				refresh_token: "rt",
				expires_in: 3600,
				token_type: "Bearer",
				scope: "read",
			}),
		}) as any);
		const r = await exchangeCode({
			tokenEndpoint: "https://example.com/token",
			clientId: "x",
			code: "y",
			redirectUri: "http://localhost:0",
			verifier: "z",
		});
		expect(r.access_token).toBe("at");
		expect(r.refresh_token).toBe("rt");
		expect(r.expires_in).toBe(3600);
	});

	it("rejects on 5xx", async () => {
		globalThis.fetch = (async () => ({
			ok: false,
			status: 503,
			text: async () => "down",
		}) as any);
		await expect(exchangeCode({
			tokenEndpoint: "https://example.com/token",
			clientId: "x",
			code: "y",
			redirectUri: "http://localhost:0",
			verifier: "z",
		})).rejects.toThrow();
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — refreshAccessToken (mocked fetch)
// ──────────────────────────────────────────────────────────────

describe("[unit] refreshAccessToken", () => {
	const origFetch = globalThis.fetch;
	afterEach(() => { globalThis.fetch = origFetch; });

	it("rejects on missing refresh token", async () => {
		await expect(refreshAccessToken({
			tokenEndpoint: "https://example.com/token",
			clientId: "x",
			refreshToken: "",
		})).rejects.toThrow();
	});

	it("parses 200 response into TokenResponse (snake_case)", async () => {
		globalThis.fetch = (async () => ({
			ok: true,
			status: 200,
			json: async () => ({
				access_token: "at-new",
				refresh_token: "rt-new",
				expires_in: 3600,
				token_type: "Bearer",
			}),
		}) as any);
		const r = await refreshAccessToken({
			tokenEndpoint: "https://example.com/token",
			clientId: "x",
			refreshToken: "rt-old",
		});
		expect(r.access_token).toBe("at-new");
		expect(r.refresh_token).toBe("rt-new");
		expect(r.expires_in).toBe(3600);
	});

	it("rejects on 5xx", async () => {
		globalThis.fetch = (async () => ({
			ok: false,
			status: 503,
			text: async () => "down",
		}) as any);
		await expect(refreshAccessToken({
			tokenEndpoint: "https://example.com/token",
			clientId: "x",
			refreshToken: "rt",
		})).rejects.toThrow();
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE
// ──────────────────────────────────────────────────────────────

describe("[smoke] oauth module", () => {
	it("loads", async () => {
		const m = await import("../../../packages/ai/src/oauth.ts");
		expect(typeof m.generatePkce).toBe("function");
		expect(typeof m.buildAuthUrl).toBe("function");
		expect(typeof m.verifyCallbackState).toBe("function");
		expect(typeof m.exchangeCode).toBe("function");
		expect(typeof m.refreshAccessToken).toBe("function");
	});

	it("generatePkce callable", () => {
		expect(() => generatePkce()).not.toThrow();
	});
});
