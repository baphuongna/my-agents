// @vitest-environment jsdom
/**
 * StatusPage — pool sessions (Fix 2 toolStatus consumer) tests.
 * Covers: pool session rows render, toolStatus badge shown, empty state,
 * and non-fatal poolSessions fetch failure.
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor, cleanup } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils";
import { StatusPage } from "@/pages/StatusPage";
import type { PoolSessionEntry } from "@/lib/api";

function makePoolSession(overrides: Partial<PoolSessionEntry> = {}): PoolSessionEntry {
  return {
    sessionId: "s-pool-1",
    messages: 3,
    lastActivity: 1700000000000,
    busy: true,
    toolStatus: "tool:bash,read",
    model: "MiniMax-M3",
    ...overrides,
  };
}

describe("StatusPage pool sessions", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
  });

  function mockFetch(statusJson: unknown, poolJson?: unknown, poolError = false) {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/pool/sessions")) {
        if (poolError) throw new Error("pool unavailable");
        return new Response(JSON.stringify(poolJson ?? []), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/status")) {
        return new Response(JSON.stringify(statusJson), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;
  }

  it("renders pool session rows with toolStatus badge", async () => {
    mockFetch(
      { status: "ok", sessions: 1, providers: [], roles: [], uptime: 3600, version: "test" },
      [makePoolSession()]
    );
    renderWithProviders(<StatusPage />);

    await waitFor(() => {
      expect(screen.getByText("s-pool-1")).toBeInTheDocument();
    });
    expect(screen.getByText("tool:bash,read")).toBeInTheDocument();
    expect(screen.getByText(/Pool Sessions \(1\)/)).toBeInTheDocument();
  });

  it("shows empty state when no pool sessions", async () => {
    mockFetch({ status: "ok", sessions: 0, providers: [], roles: [], uptime: 0, version: "test" });
    renderWithProviders(<StatusPage />);

    await waitFor(() => {
      expect(screen.getByText(/Pool Sessions \(0\)/)).toBeInTheDocument();
    });
    expect(screen.getByText(/No active pool sessions/)).toBeInTheDocument();
  });

  it("does not crash when /pool/sessions fetch fails (non-fatal)", async () => {
    mockFetch({ status: "ok", sessions: 0, providers: [], roles: [], uptime: 0, version: "test" }, undefined, true);
    renderWithProviders(<StatusPage />);

    await waitFor(() => {
      expect(screen.getByText(/Pool Sessions \(0\)/)).toBeInTheDocument();
    });
  });

  it("renders idle session without toolStatus badge", async () => {
    mockFetch(
      { status: "ok", sessions: 1, providers: [], roles: [], uptime: 3600, version: "test" },
      [makePoolSession({ busy: false, toolStatus: undefined })]
    );
    renderWithProviders(<StatusPage />);

    await waitFor(() => {
      expect(screen.getByText("s-pool-1")).toBeInTheDocument();
    });
    expect(screen.queryByText(/tool:/)).not.toBeInTheDocument();
  });
});
