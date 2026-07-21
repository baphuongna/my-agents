/**
 * @my-agent/web — PWA tests (service worker registration + push subscription).
 *
 * vitest runs in a node environment, so browser globals (navigator, window,
 * confirm, atob) must be mocked on globalThis and cleaned up after each test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerServiceWorker } from "./pwa-register.js";
import { subscribeToPush, getPushState } from "./push-subscription.js";

// ─── browser global mocks ──────────────────────────────────────────────────

/** References to the mocks, set by setupBrowserGlobals for assertion. */
let mockWindowAddEventListener: ReturnType<typeof vi.fn>;
let mockSWRegister: ReturnType<typeof vi.fn>;
let mockReadyReg: {
  pushManager: {
    subscribe: ReturnType<typeof vi.fn>;
    getSubscription: ReturnType<typeof vi.fn>;
  };
};

/**
 * Install browser globals on globalThis. Store mock refs for assertions.
 * Set `omitServiceWorker` to test the no-serviceWorker path.
 * Set `withPushManager` to add PushManager to the window object.
 */
function setupBrowserGlobals(opts: {
  omitServiceWorker?: boolean;
  withPushManager?: boolean;
  fetchImpl?: typeof globalThis.fetch;
}): void {
  mockWindowAddEventListener = vi.fn();
  mockSWRegister = vi.fn(async () => ({
    addEventListener: vi.fn(),
    installing: null,
  }));
  const mockGetSubscription = vi.fn(async () => null);
  const mockSubscribe = vi.fn(async () => ({ endpoint: "https://push.test/sub/123" }));
  mockReadyReg = {
    pushManager: { subscribe: mockSubscribe, getSubscription: mockGetSubscription },
  };

  const navigatorObj: Record<string, unknown> = {};
  if (!opts.omitServiceWorker) {
    navigatorObj["serviceWorker"] = {
      register: mockSWRegister,
      ready: Promise.resolve({
        pushManager: mockReadyReg.pushManager,
      }),
    };
  }

  const windowObj: Record<string, unknown> = {
    addEventListener: mockWindowAddEventListener,
    location: { reload: vi.fn() },
  };
  if (opts.withPushManager) {
    windowObj["PushManager"] = class FakePushManager {};
  }

  const g = globalThis as unknown as Record<string, unknown>;
  defineGlobal(g, "navigator", navigatorObj);
  defineGlobal(g, "window", windowObj);
  defineGlobal(g, "confirm", vi.fn(() => false));
  defineGlobal(g, "atob", (s: string) => Buffer.from(s, "base64").toString("binary"));
  if (opts.fetchImpl) defineGlobal(g, "fetch", opts.fetchImpl);
}

/** Set a global property, using defineProperty to override read-only getters
 *  (Node 20+ defines navigator as a non-writable getter). */
function defineGlobal(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    configurable: true,
  });
}

function teardownBrowserGlobals(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  // Restore by deleting our configurable properties.
  for (const key of ["navigator", "window", "confirm", "atob"]) {
    try { delete g[key]; } catch { /* some globals are non-configurable; leave as-is */ }
  }
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  teardownBrowserGlobals();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("registerServiceWorker", () => {
  it("calls navigator.serviceWorker.register('/sw.js') on window load", () => {
    setupBrowserGlobals({});

    registerServiceWorker();

    // The function registers a 'load' listener on window.
    expect(mockWindowAddEventListener).toHaveBeenCalledWith("load", expect.any(Function));

    // Invoke the captured callback to simulate the load event.
    const loadCb = mockWindowAddEventListener.mock.calls[0]![1] as () => void;
    loadCb();

    // Now register should have been called with "/sw.js".
    expect(mockSWRegister).toHaveBeenCalledWith("/sw.js");
  });

  it("no-ops when serviceWorker is not in navigator", () => {
    setupBrowserGlobals({ omitServiceWorker: true });

    // Should not throw.
    expect(() => registerServiceWorker()).not.toThrow();
    expect(mockWindowAddEventListener).not.toHaveBeenCalled();
  });
});

describe("subscribeToPush", () => {
  it("returns false when PushManager is unavailable", async () => {
    // navigator has serviceWorker but window has no PushManager.
    setupBrowserGlobals({ omitServiceWorker: false });
    const result = await subscribeToPush("https://gw.test");
    expect(result).toBe(false);
  });

  it("returns true on successful subscribe", async () => {
    // Full mock: PushManager present, VAPID key fetched, subscribe succeeds.
    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("/push/vapid-key")) {
        return new Response(JSON.stringify({ publicKey: "dGVzdA==" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // /push/subscribe
      return new Response("{}", { status: 200 });
    });
    setupBrowserGlobals({
      withPushManager: true,
      fetchImpl: mockFetch as unknown as typeof globalThis.fetch,
    });

    const result = await subscribeToPush("https://gw.test");
    expect(result).toBe(true);

    // Verify the VAPID key fetch + subscribe POST happened.
    const calls = mockFetch.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("/push/vapid-key"))).toBe(true);
    expect(calls.some((u) => u.includes("/push/subscribe"))).toBe(true);
  });
});

describe("getPushState", () => {
  it("returns { subscribed: false } when no subscription exists", async () => {
    setupBrowserGlobals({ withPushManager: true });
    const state = await getPushState("https://gw.test");
    expect(state).toEqual({ subscribed: false });
  });
});
