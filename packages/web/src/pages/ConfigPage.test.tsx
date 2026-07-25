// @vitest-environment jsdom
/**
 * ConfigPage — Hermes pattern port tests.
 * Covers: CATEGORY_ICONS rendering per key, search filter, and scoped
 * reset (only the visible/filtered keys) gated by a ConfirmDialog.
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils";
import { ConfigPage } from "@/pages/ConfigPage";

const CONFIG = {
  "agent.model": "claude",
  "memory.limit": 100,
  "cron.timezone": "UTC",
  "random.misc": "x",
};

describe("ConfigPage", () => {
  let originalFetch: typeof fetch;
  let resetBodies: Array<{ keys: string[] }>;

  beforeEach(() => {
    originalFetch = global.fetch;
    resetBodies = [];
  });
  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  function mockConfig() {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "POST" && url === "/config/reset") {
        resetBodies.push(JSON.parse(init?.body as string));
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (method === "GET" && url === "/config") {
        return new Response(JSON.stringify(CONFIG), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    }) as unknown as typeof fetch;
  }

  // ── 1. Category icons render per key ───────────────────────────────
  it("renders a category icon for each config key", async () => {
    mockConfig();
    renderWithProviders(<ConfigPage />);

    await waitFor(() =>
      expect(screen.getByTestId("config-icon-agent")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("config-icon-memory")).toBeInTheDocument();
    expect(screen.getByTestId("config-icon-cron")).toBeInTheDocument();
    // Unknown-prefix key falls back to the generic "settings" icon.
    expect(screen.getByTestId("config-icon-settings")).toBeInTheDocument();
  });

  // ── 2. Filter narrows the visible keys ─────────────────────────────
  it("filters config keys by the search input", async () => {
    mockConfig();
    renderWithProviders(<ConfigPage />);

    await waitFor(() =>
      expect(screen.getByTestId("config-icon-agent")).toBeInTheDocument(),
    );
    expect(screen.getByText("agent.model")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Filter config keys/i), {
      target: { value: "memory" },
    });

    // Only the memory key remains visible.
    await waitFor(() =>
      expect(screen.queryByText("agent.model")).toBeNull(),
    );
    expect(screen.getByText("memory.limit")).toBeInTheDocument();
  });

  // ── 3. Scoped reset is gated by a confirm dialog ───────────────────
  it("shows a confirm dialog before resetting only the filtered keys", async () => {
    mockConfig();
    renderWithProviders(<ConfigPage />);

    await waitFor(() =>
      expect(screen.getByTestId("config-icon-agent")).toBeInTheDocument(),
    );

    // Narrow to just the memory key, then request a scoped reset.
    fireEvent.change(screen.getByPlaceholderText(/Filter config keys/i), {
      target: { value: "memory" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Reset filtered/i }));

    // Confirm dialog appears with a count of the filtered keys.
    const confirmBtn = await screen.findByRole("button", { name: /^Reset$/ });
    expect(screen.getByText(/Reset 1 config key/)).toBeInTheDocument();

    fireEvent.click(confirmBtn);

    // Only the filtered key is sent to the reset endpoint.
    await waitFor(() => expect(resetBodies).toHaveLength(1));
    expect(resetBodies[0]!.keys).toEqual(["memory.limit"]);
  });

  // ── 4. Reset button disabled when nothing is filtered ──────────────
  it("disables the reset button when no keys are visible", async () => {
    mockConfig();
    renderWithProviders(<ConfigPage />);

    await waitFor(() =>
      expect(screen.getByTestId("config-icon-agent")).toBeInTheDocument(),
    );

    // Filter that matches nothing.
    fireEvent.change(screen.getByPlaceholderText(/Filter config keys/i), {
      target: { value: "zzz-nope" },
    });

    expect(screen.getByRole("button", { name: /Reset filtered/i })).toBeDisabled();
    expect(
      screen.getByText(/No config keys match the current filter/),
    ).toBeInTheDocument();
  });
});
