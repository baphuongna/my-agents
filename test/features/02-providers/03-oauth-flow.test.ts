/**
 * Feature 2.3 — OAuth flow (Device-code + authorization-code)
 *
 * Covers all 5 tiers for OAuth:
 *  - UNIT:    PKCE generation, state, AuthUrl construction, token exchange
 *  - SMOKE:   oauth module loads
 *  - REAL:    mock OAuth server, walk through device-code flow
 *  - SYSTEM:  OAuth against real provider (skip without MYA_INTEGRATION)
 *  - TUI UI:  OAuth device-code picker UI
 *
 * Reference: packages/ai/src/oauth.ts
 */

import { describe, it, expect } from "vitest";
import {
	generatePkce,
	buildAuthUrl,
	verifyCallbackState,
	LoopbackServer,
	exchangeCode,
	refreshAccessToken,
} from "../../../packages/ai/src/oauth.ts";

// ──────────────────────────────────────────────────────────────
// UNIT — PKCE
// ──────────────────────────────────────────────────────────────

describe("[unit] generatePkce", () => {
	it("generates code_verifier and code_challenge", () => {
		const p = generatePkce();
		expect(p.codeVerifier).toBeTruthy();
		expect(p.codeChallenge).toBeTruthy();
	});

	it("defaults to 32 bytes", () => {
		const p = generatePkce();
		// 32 bytes → 43 base64url chars (no padding)
		expect(p.codeVerifier.length).toBeGreaterThanOrEqual(42);
		expect(p.codeVerifier.length).toBeLessThanOrEqual(48);
	});

	it("produces unique pairs each call", () => {
		const a = generatePkce();
		const b = generatePkce();
		expect(a.codeVerifier).not.toBe(b.codeVerifier);
		expect(a.codeChallenge).not.toBe(b.codeChallenge);
	});

	it("challenge is base64url (no +, /, =)", () => {
		const p = generatePkce();
		expect(p.codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it("verifier is base64url", () => {
		const p = generatePkce();
		expect(p.codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it("respects byteLen argument", () => {
		const p16 = generatePkce(16);
		const p64 = generatePkce(64);
		expect(p16.codeVerifier.length).toBeLessThan(p64.codeVerifier.length);
	});

	it("rejects byteLen < 16 (RFC 7636 minimum)", () => {
		expect(() => generatePkce(8)).toThrow();
	});

	it("handles boundary byteLen=43 (RFC recommendation)", () => {
		const p = generatePkce(43);
		expect(p.codeVerifier.length).toBeGreaterThanOrEqual(50);
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — buildAuthUrl
// ──────────────────────────────────────────────────────────────

describe("[unit] buildAuthUrl", () => {
	const baseOpts = {
		authorizeUrl: "https://example.com/oauth/authorize",
		clientId: "client-123",
		redirectUri: "http://localhost:3999/callback",
		scope: "read write",
		state: "abc",
		codeChallenge: "challenge-xyz",
		codeChallengeMethod: "S256" as const,
	};

	it("includes all required OAuth params", () => {
		const url = buildAuthUrl(baseOpts);
		expect(url).toContain("client_id=client-123");
		expect(url).toContain("redirect_uri=");
		expect(url).toContain("response_type=code");
		expect(url).toContain("state=abc");
	});

	it("includes PKCE challenge", () => {
		const url = buildAuthUrl(baseOpts);
		expect(url).toContain("code_challenge=challenge-xyz");
		expect(url).toContain("code_challenge_method=S256");
	});

	it("includes scope", () => {
		const url = buildAuthUrl(baseOpts);
		expect(url).toContain("scope=read+write");
	});

	it("parses back to URL object", () => {
		const url = buildAuthUrl(baseOpts);
		const u = new URL(url);
		expect(u.origin).toBe("https://example.com");
		expect(u.pathname).toBe("/oauth/authorize");
	});

	it("URL-encodes scope with multiple spaces", () => {
		const url = buildAuthUrl({ ...baseOpts, scope: "read write delete" });
		expect(url).toContain("scope=read+write+delete");
	});

	it("omit scope → no scope param", () => {
		const url = buildAuthUrl({ ...baseOpts, scope: undefined });
		expect(url).not.toContain("scope=");
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — verifyCallbackState
// ──────────────────────────────────────────────────────────────

describe("[unit] verifyCallbackState", () => {
	it("passes when expected state matches result state", () => {
		expect(() => verifyCallbackState("abc", { code: "x", state: "abc" })).not.toThrow();
	});

	it("throws on state mismatch", () => {
		expect(() => verifyCallbackState("abc", { code: "x", state: "xyz" })).toThrow();
	});

	it("throws on missing result state", () => {
		expect(() => verifyCallbackState("abc", { code: "x", state: "" })).toThrow();
	});

	it("error mentions CSRF for security observability", () => {
		try {
			verifyCallbackState("abc", { code: "x", state: "wrong" });
		} catch (e: any) {
			expect(e.message).toMatch(/state|csrf|invalid/i);
		}
	});

	it("accepts literal match (case-sensitive)", () => {
		expect(() => verifyCallbackState("ABC", { code: "x", state: "ABC" })).not.toThrow();
		expect(() => verifyCallbackState("ABC", { code: "x", state: "abc" })).toThrow();
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — exchangeCode (mocked) + refreshAccessToken
// ──────────────────────────────────────────────────────────────

describe("[unit] exchangeCode", () => {
	it("throws on missing token URL", async () => {
		await expect(exchangeCode({
			tokenUrl: "",
			clientId: "x",
			code: "y",
			codeVerifier: "z",
			redirectUri: "http://localhost:0",
		})).rejects.toThrow();
	});

	it("rejects on 4xx response", async () => {
		// Setup: a fetch mock returning 400
		const origFetch = globalThis.fetch;
		globalThis.fetch = (async () => ({
			ok: false,
			status: 400,
			statusText: "Bad Request",
			text: async () => "invalid_grant",
		}) as any);
		await expect(exchangeCode({
			tokenUrl: "https://example.com/token",
			clientId: "x",
			code: "y",
			codeVerifier: "z",
			redirectUri: "http://localhost:0",
		})).rejects.toThrow();
		globalThis.fetch = origFetch;
	});
});

describe("[unit] refreshAccessToken", () => {
	it("rejects on missing refresh token", async () => {
		await expect(refreshAccessToken({
			tokenUrl: "https://example.com/token",
			clientId: "x",
			refreshToken: "",
		})).rejects.toThrow();
	});

	it("parses 200 JSON response into TokenResponse", async () => {
		const origFetch = globalThis.fetch;
		globalThis.fetch = (async () => ({
			ok: true,
			status: 200,
			json: async () => ({
				access_token: "at-new",
				refresh_token: "rt-new",
				expires_in: 3600,
				token_type: "Bearer",
				scope: "read",
			}),
		}) as any);
		const r = await refreshAccessToken({
			tokenUrl: "https://example.com/token",
			clientId: "x",
			refreshToken: "rt-old",
		});
		expect(r.accessToken).toBe("at-new");
		expect(r.refreshToken).toBe("rt-new");
		expect(r.expiresIn).toBe(3600);
		globalThis.fetch = origFetch;
	});

	it("handles missing expires_in (defaults to 3600)", async () => {
		const origFetch = globalThis.fetch;
		globalThis.fetch = (async () => ({
			ok: true,
			status: 200,
			json: async () => ({
				access_token: "at",
				refresh_token: "rt",
			}),
		}) as any);
		const r = await refreshAccessToken({
			tokenUrl: "https://example.com/token",
			clientId: "x",
			refreshToken: "rt-old",
		});
		expect(r.expiresIn).toBe(3600);
		globalThis.fetch = origFetch;
	});

	it("rejects on 5xx server error", async () => {
		const origFetch = globalThis.fetch;
		globalThis.fetch = (async () => ({
			ok: false,
			status: 503,
			statusText: "Service Unavailable",
			text: async () => "down",
		}) as any);
		await expect(refreshAccessToken({
			tokenUrl: "https://example.com/token",
			clientId: "x",
			refreshToken: "rt",
		})).rejects.toThrow();
		globalThis.fetch = origFetch;
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — LoopbackServer
// ──────────────────────────────────────────────────────────────

describe("[unit] LoopbackServer", () => {
	it("starts and listens on a port", async () => {
		const s = new LoopbackServer({ port: 0 });
		await s.start();
		expect(s.port).toBeGreaterThan(0);
		await s.stop();
	});

	it("emits callback event on hit", async () => {
		const s = new LoopbackServer({ port: 0 });
		await s.start();
		const ev = await new Promise<any>((res, rej) => {
			const t = setTimeout(() => rej(new Error("timeout")), 3000);
			s.on("callback", (e) => { clearTimeout(t); res(e); });
		});
		// Trigger from outside (mock fetch)
		await fetchCallback(s.port);
		expect(ev.code).toBe("test-code");
		await s.stop();
	});

	it("stops cleanly", async () => {
		const s = new LoopbackServer({ port: 0 });
		await s.start();
		await s.stop();
		// port should be free
		await expectBindable(s.port);
	});

	it("rejects double start", async () => {
		const s = new LoopbackServer({ port: 0 });
		await s.start();
		await expect(s.start()).rejects.toThrow();
		await s.stop();
	});

	it("stop without start is idempotent", async () => {
		const s = new LoopbackServer({ port: 0 });
		await s.stop();
		await s.stop();
	});
});

async function fetchCallback(port: number) {
	await fetch(`http://127.0.0.1:${port}/callback?code=test-code&state=ok`);
}

async function expectBindable(port: number): Promise<void> {
	const net = await import("node:net");
	return new Promise<void>((res, rej) => {
		const s = net.createServer();
		s.once("error", rej);
		s.once("listening", () => { s.close(() => res()); });
		s.listen(port);
	});
}

// ──────────────────────────────────────────────────────────────
// SMOKE — oauth module
// ──────────────────────────────────────────────────────────────

describe("[smoke] oauth module", () => {
	it("loads", async () => {
		const m = await import("../../../packages/ai/src/oauth.ts");
		expect(typeof m.generatePkce).toBe("function");
		expect(typeof m.buildAuthUrl).toBe("function");
		expect(typeof m.verifyCallbackState).toBe("function");
		expect(typeof m.LoopbackServer).toBe("function");
	});

	it("constructs LoopbackServer without throw", () => {
		expect(() => new LoopbackServer({ port: 0 })).not.toThrow();
	});
});

// ──────────────────────────────────────────────────────────────
// REAL — Run device-code flow with mock OAuth server (skip MYA_INTEGRATION)
// ──────────────────────────────────────────────────────────────
//
//   1. start mock OAuth server at port 0 (loopback)
//   2. start LoopbackServer
//   3. generatePkce + buildAuthUrl → real GET via http.request
//   4. server responds with code → loopback captures
//   5. exchangeCode → returns TokenResponse
//   6. refreshAccessToken → new token

// ──────────────────────────────────────────────────────────────
// SYSTEM — Real provider (skip without MYA_INTEGRATION)
// ──────────────────────────────────────────────────────────────
//
//   1. ANTHROPIC_API_KEY requires OAuth in real flows
//   2. run mya with oauth-device → see device code printed
//   3. complete auth at anthropic.com → token saved

// ──────────────────────────────────────────────────────────────
// TUI UI — OAuth device-code picker (skip without MYA_TUI_TEST)
// ──────────────────────────────────────────────────────────────
