// @vitest-environment jsdom
/**
 * McpPage — list/add/test/remove MCP servers against mocked gateway endpoints.
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { renderWithProviders, mockFetch } from "@/test-utils";
import { McpPage } from "@/pages/McpPage";

const SERVERS = [
  { id: "filesystem", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"], phase: "Connected", health: "healthy", tools: ["read", "write"], lastError: undefined },
];

describe("McpPage", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the page title and loading state", () => {
    global.fetch = mockFetch({ "GET /mcp/servers": SERVERS });
    renderWithProviders(<McpPage />);
    expect(screen.getByText("MCP Servers")).toBeInTheDocument();
  });

  it("lists servers returned by GET /mcp/servers", async () => {
    global.fetch = mockFetch({ "GET /mcp/servers": SERVERS });
    renderWithProviders(<McpPage />);
    await waitFor(() => {
      expect(screen.getByText("filesystem")).toBeInTheDocument();
    });
    // 2 tools surfaced in the command line / tool count
    expect(screen.getByText(/2 tools/)).toBeInTheDocument();
  });

  it("shows empty state when no servers", async () => {
    global.fetch = mockFetch({ "GET /mcp/servers": [] });
    renderWithProviders(<McpPage />);
    await waitFor(() => {
      expect(screen.getByText("No MCP servers configured")).toBeInTheDocument();
    });
  });

  it("shows error when the endpoint fails", async () => {
    global.fetch = mockFetch({}); // 404 for everything
    renderWithProviders(<McpPage />);
    await waitFor(() => {
      // ErrorBox carries role="alert"
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });

  it("opens the add-server modal and submits a new server", async () => {
    let posted: { id?: string; command?: string } | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "POST" && url === "/mcp/servers") {
        posted = JSON.parse(String(init?.body ?? "{}"));
        return new Response(JSON.stringify({ ok: true, id: "new-srv" }), {
          status: 201, headers: { "content-type": "application/json" },
        });
      }
      if (method === "GET" && url === "/mcp/servers") {
        return new Response(JSON.stringify(SERVERS), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    }) as unknown as typeof fetch;
    global.fetch = fetchMock;

    renderWithProviders(<McpPage />);
    await waitFor(() => expect(screen.getByText("filesystem")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /add server/i }));
    const idInput = await screen.findByPlaceholderText("filesystem");
    fireEvent.change(idInput, { target: { value: "new-srv" } });
    fireEvent.change(screen.getByPlaceholderText("npx"), { target: { value: "node" } });

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => {
      expect(posted).not.toBeNull();
    });
    expect(posted?.id).toBe("new-srv");
    expect(posted?.command).toBe("node");
  });
});
