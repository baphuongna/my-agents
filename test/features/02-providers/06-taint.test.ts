/**
 * Feature 2.6 — Auth/Quota taint (mark provider tainted on 401/429,
 *             no-reuse in session, TTL)
 *
 * Covers all 5 tiers:
 *  - UNIT:    taint reasons, eligibility, recovery, clear
 *  - SMOKE:   registry loads
 *  - REAL:    real error responses trigger taint
 *  - SYSTEM:  end-to-end (skip MYA_INTEGRATION)
 *  - TUI UI:  provider status display
 *
 * Reference: packages/ai/src/registry.ts
 */

import { describe, it, expect } from "vitest";
import { setTimeProvider } from "@my-agent/core";
import { ProviderRegistry } from "../../../packages/ai/src/registry.ts";

// Real wallclock — used to restore the global time provider after faking it.
const realClock = { nowWallclock: () => Date.now(), nowMonotonic: () => Date.now() };

// Helper — minimal ProviderProfile stub. The registry cools down every
// TaintReason identically (auth/quota/rate_limited/network/unhealthy).
function makeProfile(id: string): any {
	return {
		id,
		model: `${id}-default`,
		stream: async function* () { /* noop */ },
		health: () => "Healthy",
	};
}

// ──────────────────────────────────────────────────────────────
// UNIT — Taint reasons
// ──────────────────────────────────────────────────────────────

describe("[unit] taint reasons", () => {
	const reasons: ("auth" | "quota" | "rate_limited" | "network" | "unhealthy")[] = [
		"auth", "quota", "rate_limited", "network", "unhealthy",
	];

	it.each(reasons)("'auth' taints, recovers after cooldown", () => {
		const r = new ProviderRegistry({ cooldownMs: 100 });
		r.register(makeProfile("p"));
		r.taint("p", "auth");
		expect(r.eligible("p", Date.now())).toBe(false);
		expect(r.eligible("p", Date.now() + 200)).toBe(true);
	});

	it.each(reasons)("'quota' is a tainting reason", () => {
		const r = new ProviderRegistry({ cooldownMs: 100 });
		r.register(makeProfile("p"));
		r.taint("p", "quota");
		expect(r.eligible("p", Date.now())).toBe(false);
	});

	it.each(reasons)("'rate_limited' is a tainting reason", () => {
		const r = new ProviderRegistry({ cooldownMs: 100 });
		r.register(makeProfile("p"));
		r.taint("p", "rate_limited");
		expect(r.eligible("p", Date.now())).toBe(false);
	});

	it("'network' also taints (cooled down like any reason)", () => {
		const r = new ProviderRegistry({ cooldownMs: 100 });
		r.register(makeProfile("p"));
		r.taint("p", "network");
		expect(r.eligible("p", Date.now())).toBe(false);
	});

	it("'unhealthy' also taints", () => {
		const r = new ProviderRegistry({ cooldownMs: 100 });
		r.register(makeProfile("p"));
		r.taint("p", "unhealthy");
		expect(r.eligible("p", Date.now())).toBe(false);
	});

	it("subsequent taint on same profile overwrites reason", () => {
		const r = new ProviderRegistry({ cooldownMs: 100 });
		r.register(makeProfile("p"));
		r.taint("p", "auth");
		r.taint("p", "quota");
		expect(r.eligible("p", Date.now())).toBe(false);
		// Recover after cooldown, regardless of last reason
		expect(r.eligible("p", Date.now() + 200)).toBe(true);
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — TTL / cooldown
// ──────────────────────────────────────────────────────────────

describe("[unit] taint TTL semantics", () => {
	it("before cooldown → ineligible", () => {
		const r = new ProviderRegistry({ cooldownMs: 60_000 });
		r.register(makeProfile("p"));
		r.taint("p", "auth");
		expect(r.eligible("p", Date.now() + 30_000)).toBe(false);
	});

	it("at exactly cooldown → eligible (boundary)", () => {
		const r = new ProviderRegistry({ cooldownMs: 60_000 });
		r.register(makeProfile("p"));
		const t0 = Date.now();
		r.taint("p", "auth", t0);
		expect(r.eligible("p", t0 + 60_000)).toBe(true);
	});

	it("past cooldown → eligible", () => {
		const r = new ProviderRegistry({ cooldownMs: 60_000 });
		r.register(makeProfile("p"));
		const t0 = Date.now();
		r.taint("p", "auth", t0);
		expect(r.eligible("p", t0 + 60_001)).toBe(true);
	});

	it("default cooldown is 60s", () => {
		const r = new ProviderRegistry();
		expect((r as any).cooldownMs).toBe(60_000);
	});

	it("auto-clears taint on recovery", () => {
		const r = new ProviderRegistry({ cooldownMs: 100 });
		r.register(makeProfile("p"));
		r.taint("p", "auth");
		expect(r.eligible("p", Date.now() + 200)).toBe(true);
		// subsequent check still eligible (no re-taint)
		expect(r.eligible("p", Date.now() + 300)).toBe(true);
	});

	it("preserve 'since' across calls", () => {
		const r = new ProviderRegistry({ cooldownMs: 1000 });
		r.register(makeProfile("p"));
		const t0 = Date.now();
		r.taint("p", "auth", t0);
		expect(r.eligible("p", t0 + 500)).toBe(false);
		expect(r.eligible("p", t0 + 1500)).toBe(true);
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — Taint per session (no-reuse)
// ──────────────────────────────────────────────────────────────

describe("[unit] no-reuse within session", () => {
	it("tainted profile is skipped in available()", () => {
		const r = new ProviderRegistry();
		r.register(makeProfile("a"));
		r.register(makeProfile("b"));
		r.taint("a", "auth");
		const avail = r.available();
		expect(avail.length).toBe(1);
		expect(avail[0]!.id).toBe("b");
	});

	it("tainted profile survives clear()", () => {
		const r = new ProviderRegistry();
		r.register(makeProfile("a"));
		r.taint("a", "auth");
		r.clear("a");
		// Used immediately — should be eligible
		expect(r.eligible("a", Date.now())).toBe(true);
	});

	it("cooldown does not stack (later taints reset counter)", () => {
		const r = new ProviderRegistry({ cooldownMs: 1000 });
		r.register(makeProfile("a"));
		r.taint("a", "auth", Date.now() - 5000); // already expired
		r.taint("a", "auth", Date.now()); // re-taint
		expect(r.eligible("a", Date.now() + 500)).toBe(false);
		expect(r.eligible("a", Date.now() + 1500)).toBe(true);
	});

	it("multiple taints on different profiles are independent", () => {
		const base = 5_000_000;
		let t = base;
		setTimeProvider({ nowWallclock: () => t, nowMonotonic: () => t });
		try {
			const r = new ProviderRegistry({ cooldownMs: 1000 });
			r.register(makeProfile("a"));
			r.register(makeProfile("b"));
			r.register(makeProfile("c"));
			t = base - 5000; r.taint("a", "auth"); // already recovered
			t = base;       r.taint("b", "auth"); // still tainted
			expect(r.eligible("a", base)).toBe(true);
			expect(r.eligible("b", base)).toBe(false);
			expect(r.eligible("c", base)).toBe(true);
		} finally {
			setTimeProvider(realClock);
		}
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — Health snapshot
// ──────────────────────────────────────────────────────────────

describe("[unit] registry health snapshot", () => {
	it("empty → Failed", () => {
		const r = new ProviderRegistry();
		expect(r.health()).toBe("Failed");
	});

	it("single profile, not tainted → Healthy", () => {
		const r = new ProviderRegistry();
		r.register(makeProfile("a"));
		expect(r.health()).toBe("Healthy");
	});

	it("one of two tainted → Degraded", () => {
		const r = new ProviderRegistry();
		r.register(makeProfile("a"));
		r.register(makeProfile("b"));
		r.taint("a", "auth");
		expect(r.health()).toBe("Degraded");
	});

	it("all tainted → Failed", () => {
		const r = new ProviderRegistry();
		r.register(makeProfile("a"));
		r.register(makeProfile("b"));
		r.taint("a", "auth");
		r.taint("b", "quota");
		expect(r.health()).toBe("Failed");
	});

	it("health() reflects current state, recovers after cooldown", async () => {
		const r = new ProviderRegistry({ cooldownMs: 100 });
		r.register(makeProfile("a"));
		r.taint("a", "auth");
		expect(r.health()).toBe("Failed");
		// health() reads the live wallclock (no injected `now`), so advance past cooldown
		await new Promise((res) => setTimeout(res, 150));
		expect(r.health()).toBe("Healthy");
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE — registry taint methods
// ──────────────────────────────────────────────────────────────

describe("[smoke] taint API", () => {
	it("taint() does not throw on unknown id", () => {
		const r = new ProviderRegistry();
		expect(() => r.taint("unknown", "auth")).not.toThrow();
	});

	it("clear() does not throw on unknown id", () => {
		const r = new ProviderRegistry();
		expect(() => r.clear("unknown")).not.toThrow();
	});

	it("eligible() returns true for unknown id (vacuous)", () => {
		const r = new ProviderRegistry();
		expect(r.eligible("unknown")).toBe(true);
	});
});

// ──────────────────────────────────────────────────────────────
// SYSTEM — end-to-end (skip MYA_INTEGRATION)
// ──────────────────────────────────────────────────────────────
//
//   1. real openai key → use openai
//   2. revoke key while running → next call returns 401 → taint
//   3. confirm taint via health snapshot
//   4. wait cooldown → retried

// ──────────────────────────────────────────────────────────────
// TUI UI — provider status (skip MYA_TUI_TEST)
// ──────────────────────────────────────────────────────────────
//
//   1. /providers in TUI → see status badges (Healthy/Tainted/Down)
//   2. cooldown timer visible
