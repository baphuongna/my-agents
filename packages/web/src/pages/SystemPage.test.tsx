// @vitest-environment jsdom
/**
 * SystemPage — gateway status + memory stats + dream trigger.
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { renderWithProviders, mockFetch } from "@/test-utils";
import { SystemPage } from "@/pages/SystemPage";

const STATUS = {
  status: "ok",
  model: "claude-sonnet",
  uptime: 3600,
  pid: 12345,
  version: "0.1.0",
  channels: [{ id: "tg" }],
  providers: [{ id: "anthropic", envKey: "ANTHROPIC_API_KEY", model: "claude", configured: true }],
  roles: [{ name: "default", description: "Default role" }],
  subagents: { active: 1, total: 3 },
};

const MEMORY = { factCount: 42, pendingCount: 5, embeddedCount: 37 };

describe("SystemPage", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the page title", () => {
    global.fetch = mockFetch({
      "GET /status": STATUS,
      "GET /memory/stats": MEMORY,
    });
    renderWithProviders(<SystemPage />);
    expect(screen.getByText("System")).toBeInTheDocument();
  });

  it("shows gateway status fields from GET /status", async () => {
    global.fetch = mockFetch({
      "GET /status": STATUS,
      "GET /memory/stats": MEMORY,
    });
    renderWithProviders(<SystemPage />);
    await waitFor(() => {
      expect(screen.getByText("claude-sonnet")).toBeInTheDocument();
      expect(screen.getByText("12345")).toBeInTheDocument();
      expect(screen.getByText("0.1.0")).toBeInTheDocument();
    });
  });

  it("shows memory stats from GET /memory/stats", async () => {
    global.fetch = mockFetch({
      "GET /status": STATUS,
      "GET /memory/stats": MEMORY,
    });
    renderWithProviders(<SystemPage />);
    await waitFor(() => {
      expect(screen.getByText("factCount")).toBeInTheDocument();
      expect(screen.getByText("42")).toBeInTheDocument();
    });
  });

  it("triggers a dream cycle via POST /memory/dream", async () => {
    let dreamed = false;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "POST" && url === "/memory/dream") {
        dreamed = true;
        return new Response(JSON.stringify({ ok: true, embedded: 5 }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      if (method === "GET" && url === "/status") {
        return new Response(JSON.stringify(STATUS), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      if (method === "GET" && url === "/memory/stats") {
        return new Response(JSON.stringify(MEMORY), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    }) as unknown as typeof fetch;

    renderWithProviders(<SystemPage />);
    const dreamBtn = await screen.findByRole("button", { name: /trigger dream cycle/i });
    fireEvent.click(dreamBtn);
    await waitFor(() => {
      expect(dreamed).toBe(true);
    });
  });
});
