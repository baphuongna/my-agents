// @vitest-environment jsdom
/**
 * ChannelsPage — list/toggle/test channels from GET /status.
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { renderWithProviders, mockFetch } from "@/test-utils";
import { ChannelsPage } from "@/pages/ChannelsPage";

const STATUS = {
  status: "ok",
  channels: [
    { id: "telegram", type: "telegram", alias: "main-bot", label: "Telegram", enabled: true, configured: true, health: "healthy" },
    { id: "discord", type: "discord", label: "Discord", enabled: false, configured: false, health: "disconnected" },
  ],
};

describe("ChannelsPage", () => {
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
    global.fetch = mockFetch({ "GET /status": STATUS });
    renderWithProviders(<ChannelsPage />);
    expect(screen.getByText("Channels")).toBeInTheDocument();
  });

  it("lists channels from GET /status", async () => {
    global.fetch = mockFetch({ "GET /status": STATUS });
    renderWithProviders(<ChannelsPage />);
    await waitFor(() => {
      expect(screen.getByText("Telegram")).toBeInTheDocument();
      expect(screen.getByText("Discord")).toBeInTheDocument();
    });
  });

  it("shows channel type badges", async () => {
    global.fetch = mockFetch({ "GET /status": STATUS });
    renderWithProviders(<ChannelsPage />);
    await waitFor(() => {
      // type appears as a badge; id also echoes the same string for these
      expect(screen.getAllByText("telegram").length).toBeGreaterThan(0);
      expect(screen.getAllByText("discord").length).toBeGreaterThan(0);
    });
  });

  it("shows empty state when no channels", async () => {
    global.fetch = mockFetch({ "GET /status": { status: "ok", channels: [] } });
    renderWithProviders(<ChannelsPage />);
    await waitFor(() => {
      expect(screen.getByText("No channels registered")).toBeInTheDocument();
    });
  });

  it("toggles a channel via POST /channels/:id/config", async () => {
    let toggled: { enabled?: boolean } | null = null;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "POST" && url === "/channels/telegram/config") {
        toggled = JSON.parse(String(init?.body ?? "{}"));
        return new Response(JSON.stringify({ ok: true, id: "telegram", config: {} }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      if (method === "GET" && url === "/status") {
        return new Response(JSON.stringify(STATUS), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    }) as unknown as typeof fetch;

    renderWithProviders(<ChannelsPage />);
    await waitFor(() => expect(screen.getByText("Telegram")).toBeInTheDocument());

    // Telegram is enabled → its toggle button says "Disable"
    const disableBtn = screen.getByRole("button", { name: "Disable" });
    fireEvent.click(disableBtn);

    await waitFor(() => {
      expect(toggled).toEqual({ enabled: false });
    });
  });
});
