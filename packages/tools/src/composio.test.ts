/**
 * @my-agent/tools — composio integration tests (Gap 11).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  ComposioClient,
  registerComposioTools,
  createComposioClient,
  type ComposioTool,
} from "./composio.js";
import { ToolRegistry } from "./registry.js";

/** Build a mock fetch that maps URL → { status, json }. */
function mockFetch(routes: Record<string, { status?: number; json: unknown }>): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string | URL) => {
    const u = typeof url === "string" ? url : url.toString();
    for (const [pattern, resp] of Object.entries(routes)) {
      if (u.includes(pattern)) {
        return new Response(JSON.stringify(resp.json), {
          status: resp.status ?? 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return new Response("{}", { status: 404 });
  }) as ReturnType<typeof vi.fn>;
}

const sampleTools: ComposioTool[] = [
  { name: "NOTION_CREATE_PAGE", slug: "notion_create_page", description: "Create a Notion page", parameters: { type: "object" }, toolkit: "notion" },
  { name: "LINEAR_CREATE_ISSUE", slug: "linear_create_issue", description: "Create a Linear issue", parameters: { type: "object" }, toolkit: "linear" },
];

describe("ComposioClient (Gap 11)", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    delete process.env.COMPOSIO_API_KEY;
    delete process.env.COMPOSIO_ENABLED_TOOLKITS;
  });

  it("constructs with an API key string", () => {
    const client = new ComposioClient("test-key");
    expect(client).toBeInstanceOf(ComposioClient);
  });

  it("listTools returns tools from the API", async () => {
    globalThis.fetch = mockFetch({
      "/tools": { json: { items: sampleTools } },
    });
    const client = new ComposioClient({ apiKey: "k" });
    const tools = await client.listTools();
    expect(tools).toHaveLength(2);
    expect(tools[0]!.slug).toBe("notion_create_page");
  });

  it("executeTool sends correct POST body and returns result", async () => {
    const spy = mockFetch({
      "/execute": { json: { success: true, data: "result-123" } },
    });
    globalThis.fetch = spy;
    const client = new ComposioClient({ apiKey: "k" });
    const result = await client.executeTool("NOTION_CREATE_PAGE", { title: "hi" }, "acct-1");
    expect(result).toEqual({ success: true, data: "result-123" });
    // Verify POST body
    const callArgs = spy.mock.calls[0]!;
    expect(callArgs[1]).toMatchObject({
      method: "POST",
      headers: { "x-api-key": "k", "Content-Type": "application/json" },
    });
    const body = JSON.parse((callArgs[1] as RequestInit).body as string);
    expect(body).toEqual({ arguments: { title: "hi" }, connected_account_id: "acct-1" });
  });

  it("initAuth returns an OAuth URL", async () => {
    globalThis.fetch = mockFetch({
      "/auth/initiate": { json: { authUrl: "https://oauth.example/authorize?state=abc" } },
    });
    const client = new ComposioClient({ apiKey: "k" });
    const result = await client.initAuth("user-1", "notion");
    expect(result.authUrl).toContain("oauth.example");
  });

  it("registerComposioTools registers tools with composio_ prefix", async () => {
    globalThis.fetch = mockFetch({
      "/tools": { json: { items: sampleTools } },
    });
    const registry = new ToolRegistry();
    const client = new ComposioClient({ apiKey: "k" });
    const count = await registerComposioTools(registry, client, "acct-1");
    expect(count).toBe(2);
    const list = registry.list();
    expect(list.map((t) => t.name)).toContain("composio_notion_create_page");
    expect(list.map((t) => t.name)).toContain("composio_linear_create_issue");
    // External API → Prompt mode
    expect(list.every((t) => t.requiredMode === "Prompt")).toBe(true);
  });

  it("createComposioClient returns null when COMPOSIO_API_KEY is unset", () => {
    delete process.env.COMPOSIO_API_KEY;
    expect(createComposioClient()).toBeNull();
  });
});
