/**
 * index.test.ts — tests for web_search + web_extract ToolImpl + registerSearchTools.
 *
 * Mocks the backend resolver and webFetch to test the tool logic in isolation.
 * Tests:
 *   - web_search: query validation, backend resolution, result formatting
 *   - web_extract: URL validation, guard blocks, backend extract, web_fetch fallback,
 *     truncation, per-URL errors as data
 *   - registerSearchTools: adapter registration, execute→{content} mapping
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { webSearchTool, webExtractTool, searchTools, registerSearchTools } from "./index.js";
import type { ToolImpl } from "../../registry.js";

// ── Mock setup ───────────────────────────────────────────────────────────────

// Mock the backend-resolver module.
vi.mock("./backend-resolver.js", () => ({
  resolveSearchBackend: vi.fn(),
  resolveExtractBackend: vi.fn(),
}));

// Mock webFetch from ../fetch.js
vi.mock("../fetch.js", () => ({
  webFetch: vi.fn(),
}));

// Mock security-guard (checkUrl)
vi.mock("../security-guard.js", () => ({
  checkUrl: vi.fn(),
}));

// Import mocked functions.
import { resolveSearchBackend, resolveExtractBackend } from "./backend-resolver.js";
import { webFetch } from "../fetch.js";
import { checkUrl } from "../security-guard.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Run a ToolImpl and return the output (unwraps ok). */
async function runTool(
  tool: ToolImpl,
  args: unknown,
): Promise<{ ok: boolean; output: unknown; error?: string }> {
  const result = await tool.run(args, undefined as never);
  if (result.ok) {
    return { ok: true, output: result.output };
  }
  return { ok: false, output: null, error: result.error };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("web_search tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkUrl).mockReturnValue({ ok: true });
  });

  it("has correct meta: name, requiredMode, args schema", () => {
    expect(webSearchTool.meta.name).toBe("web_search");
    expect(webSearchTool.meta.requiredMode).toBe("Prompt");
    expect(webSearchTool.meta.args).toBeDefined();
  });

  it("returns error when query is missing", async () => {
    const result = await runTool(webSearchTool, {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain("query required");
  });

  it("returns error when query is not a string", async () => {
    const result = await runTool(webSearchTool, { query: 123 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("query required");
  });

  it("returns empty results for empty/whitespace query", async () => {
    const result = await runTool(webSearchTool, { query: "   " });
    expect(result.ok).toBe(true);
    const output = result.output as { results: unknown[] };
    expect(output.results).toEqual([]);
  });

  it("resolves backend and returns search results", async () => {
    const mockBackend = {
      name: "ddgs",
      isAvailable: () => true,
      supportsSearch: true,
      supportsExtract: false,
      search: vi.fn().mockResolvedValue([
        { title: "Test", url: "https://example.com", description: "Desc" },
      ]),
      extract: vi.fn().mockResolvedValue({ markdown: "", title: "", url: "" }),
    };
    vi.mocked(resolveSearchBackend).mockReturnValue({ ok: true, backend: mockBackend as never });

    const result = await runTool(webSearchTool, { query: "test" });
    expect(result.ok).toBe(true);
    const output = result.output as { results: unknown[]; backend: string };
    expect(output.results).toHaveLength(1);
    expect(output.backend).toBe("ddgs");
    expect(mockBackend.search).toHaveBeenCalledWith("test", { maxResults: undefined });
  });

  it("passes max_results to search options", async () => {
    const mockBackend = {
      name: "tavily",
      isAvailable: () => true,
      supportsSearch: true,
      supportsExtract: true,
      search: vi.fn().mockResolvedValue([]),
      extract: vi.fn().mockResolvedValue({ markdown: "", title: "", url: "" }),
    };
    vi.mocked(resolveSearchBackend).mockReturnValue({ ok: true, backend: mockBackend as never });

    await runTool(webSearchTool, { query: "test", max_results: 5 });
    expect(mockBackend.search).toHaveBeenCalledWith("test", { maxResults: 5 });
  });

  it("returns error when no search backend is available", async () => {
    vi.mocked(resolveSearchBackend).mockReturnValue({
      ok: false,
      reason: "no available search backend",
    });

    const result = await runTool(webSearchTool, { query: "test" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("no available search backend");
  });

  it("handles backend search() throwing (defensive guard)", async () => {
    const mockBackend = {
      name: "ddgs",
      isAvailable: () => true,
      supportsSearch: true,
      supportsExtract: false,
      search: vi.fn().mockRejectedValue(new Error("network error")),
      extract: vi.fn().mockResolvedValue({ markdown: "", title: "", url: "" }),
    };
    vi.mocked(resolveSearchBackend).mockReturnValue({ ok: true, backend: mockBackend as never });

    const result = await runTool(webSearchTool, { query: "test" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("network error");
  });
});

// ── web_extract tests ──────────────────────────────────────────────────────

describe("web_extract tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkUrl).mockReturnValue({ ok: true });
  });

  it("has correct meta: name, requiredMode, args schema", () => {
    expect(webExtractTool.meta.name).toBe("web_extract");
    expect(webExtractTool.meta.requiredMode).toBe("Prompt");
    expect(webExtractTool.meta.args).toBeDefined();
  });

  it("returns error when url is missing", async () => {
    const result = await runTool(webExtractTool, {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain("url required");
  });

  it("returns guard block as data when checkUrl blocks the URL", async () => {
    vi.mocked(checkUrl).mockReturnValue({
      ok: false,
      reason: "private IP address",
      category: "ssrf-private",
    });

    const result = await runTool(webExtractTool, { url: "http://10.0.0.1" });
    expect(result.ok).toBe(true);
    const output = result.output as { guardBlock: { reason: string; category: string }; backend: string };
    expect(output.backend).toBe("guard");
    expect(output.guardBlock.reason).toBe("private IP address");
    expect(output.guardBlock.category).toBe("ssrf-private");
  });

  it("calls backend.extract() when an extract backend is available", async () => {
    const mockBackend = {
      name: "tavily",
      isAvailable: () => true,
      supportsSearch: true,
      supportsExtract: true,
      search: vi.fn().mockResolvedValue([]),
      extract: vi.fn().mockResolvedValue({
        markdown: "# Page content",
        title: "Test Page",
        url: "https://example.com",
      }),
    };
    vi.mocked(resolveExtractBackend).mockReturnValue({ ok: true, backend: mockBackend as never });

    const result = await runTool(webExtractTool, { url: "https://example.com" });
    expect(result.ok).toBe(true);
    const output = result.output as { markdown: string; title: string; backend: string };
    expect(output.backend).toBe("tavily");
    expect(output.markdown).toBe("# Page content");
    expect(output.title).toBe("Test Page");
    expect(mockBackend.extract).toHaveBeenCalled();
  });

  it("passes guardBlock from backend extract as data (not throws)", async () => {
    const mockBackend = {
      name: "tavily",
      isAvailable: () => true,
      supportsSearch: true,
      supportsExtract: true,
      search: vi.fn().mockResolvedValue([]),
      extract: vi.fn().mockResolvedValue({
        markdown: "",
        title: "",
        url: "https://example.com",
        guardBlock: { reason: "blocked", category: "ssrf-metadata" },
      }),
    };
    vi.mocked(resolveExtractBackend).mockReturnValue({ ok: true, backend: mockBackend as never });

    const result = await runTool(webExtractTool, { url: "https://example.com" });
    expect(result.ok).toBe(true);
    const output = result.output as { guardBlock: { reason: string; category: string }; markdown: string };
    expect(output.markdown).toBe("");
    expect(output.guardBlock.category).toBe("ssrf-metadata");
  });

  it("passes error from backend extract as data (not throws)", async () => {
    const mockBackend = {
      name: "tavily",
      isAvailable: () => true,
      supportsSearch: true,
      supportsExtract: true,
      search: vi.fn().mockResolvedValue([]),
      extract: vi.fn().mockResolvedValue({
        markdown: "",
        title: "",
        url: "https://example.com",
        error: "extract failed",
      }),
    };
    vi.mocked(resolveExtractBackend).mockReturnValue({ ok: true, backend: mockBackend as never });

    const result = await runTool(webExtractTool, { url: "https://example.com" });
    expect(result.ok).toBe(true);
    const output = result.output as { error: string };
    expect(output.error).toBe("extract failed");
  });

  it("falls back to webFetch when no extract backend is available", async () => {
    vi.mocked(resolveExtractBackend).mockReturnValue({
      ok: false,
      reason: "no extract backend",
      fallbackToWebFetch: true,
    });
    vi.mocked(webFetch).mockResolvedValue({
      ok: true,
      markdown: "# Fetched content",
      finalUrl: "https://example.com",
      title: "Example",
      contentType: "text/html",
    });

    const result = await runTool(webExtractTool, { url: "https://example.com" });
    expect(result.ok).toBe(true);
    const output = result.output as { markdown: string; backend: string };
    expect(output.backend).toBe("web_fetch");
    expect(output.markdown).toBe("# Fetched content");
    expect(webFetch).toHaveBeenCalled();
  });

  it("falls back to webFetch when extract backend throws", async () => {
    const mockBackend = {
      name: "tavily",
      isAvailable: () => true,
      supportsSearch: true,
      supportsExtract: true,
      search: vi.fn().mockResolvedValue([]),
      extract: vi.fn().mockRejectedValue(new Error("unexpected")),
    };
    vi.mocked(resolveExtractBackend).mockReturnValue({ ok: true, backend: mockBackend as never });
    vi.mocked(webFetch).mockResolvedValue({
      ok: true,
      markdown: "# Fallback",
      finalUrl: "https://example.com",
      title: "Fallback",
      contentType: "text/html",
    });

    const result = await runTool(webExtractTool, { url: "https://example.com" });
    expect(result.ok).toBe(true);
    const output = result.output as { backend: string };
    expect(output.backend).toBe("web_fetch");
  });

  it("returns webFetch errors as data (not throws)", async () => {
    vi.mocked(resolveExtractBackend).mockReturnValue({
      ok: false,
      reason: "no extract backend",
      fallbackToWebFetch: true,
    });
    vi.mocked(webFetch).mockResolvedValue({
      ok: false,
      markdown: "",
      finalUrl: "https://example.com",
      title: "",
      contentType: "",
      error: "request timed out",
    });

    const result = await runTool(webExtractTool, { url: "https://example.com" });
    expect(result.ok).toBe(true);
    const output = result.output as { error: string; backend: string };
    expect(output.backend).toBe("web_fetch");
    expect(output.error).toBe("request timed out");
  });

  it("returns webFetch guardBlock as data", async () => {
    vi.mocked(resolveExtractBackend).mockReturnValue({
      ok: false,
      reason: "no extract backend",
      fallbackToWebFetch: true,
    });
    vi.mocked(webFetch).mockResolvedValue({
      ok: false,
      markdown: "",
      finalUrl: "https://evil.com",
      title: "",
      contentType: "",
      guardBlock: { reason: "blocked", category: "ssrf-private" },
    });

    const result = await runTool(webExtractTool, { url: "https://evil.com" });
    expect(result.ok).toBe(true);
    const output = result.output as { guardBlock: { reason: string }; backend: string };
    expect(output.backend).toBe("web_fetch");
    expect(output.guardBlock.reason).toBe("blocked");
  });

  it("truncates long content to 15000 chars with head+tail", async () => {
    const longText = "A".repeat(20_000);
    const mockBackend = {
      name: "firecrawl",
      isAvailable: () => true,
      supportsSearch: true,
      supportsExtract: true,
      search: vi.fn().mockResolvedValue([]),
      extract: vi.fn().mockResolvedValue({
        markdown: longText,
        title: "Long",
        url: "https://example.com",
      }),
    };
    vi.mocked(resolveExtractBackend).mockReturnValue({ ok: true, backend: mockBackend as never });

    const result = await runTool(webExtractTool, { url: "https://example.com" });
    expect(result.ok).toBe(true);
    const output = result.output as { markdown: string };
    expect(output.markdown.length).toBeLessThan(longText.length);
    expect(output.markdown).toContain("truncated");
  });

  it("does not truncate content under 15000 chars", async () => {
    const shortText = "Short content";
    const mockBackend = {
      name: "firecrawl",
      isAvailable: () => true,
      supportsSearch: true,
      supportsExtract: true,
      search: vi.fn().mockResolvedValue([]),
      extract: vi.fn().mockResolvedValue({
        markdown: shortText,
        title: "Short",
        url: "https://example.com",
      }),
    };
    vi.mocked(resolveExtractBackend).mockReturnValue({ ok: true, backend: mockBackend as never });

    const result = await runTool(webExtractTool, { url: "https://example.com" });
    expect(result.ok).toBe(true);
    const output = result.output as { markdown: string };
    expect(output.markdown).toBe(shortText);
  });
});

// ── searchTools array ──────────────────────────────────────────────────────

describe("searchTools array", () => {
  it("contains webSearchTool and webExtractTool", () => {
    expect(searchTools).toHaveLength(2);
    expect(searchTools.map((t) => t.meta.name)).toEqual(["web_search", "web_extract"]);
  });
});

// ── registerSearchTools adapter ─────────────────────────────────────────────

describe("registerSearchTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkUrl).mockReturnValue({ ok: true });
  });

  it("registers both web_search and web_extract tools", () => {
    const registered: { name: string; description: string; parameters: unknown; execute: unknown }[] = [];
    const mockPi = {
      registerTool(t: unknown) {
        registered.push(t as { name: string; description: string; parameters: unknown; execute: unknown });
      },
    };

    registerSearchTools(mockPi);
    expect(registered).toHaveLength(2);
    expect(registered.map((t) => t.name)).toEqual(["web_search", "web_extract"]);
  });

  it("registers each tool with name, description, parameters, and execute", () => {
    const registered: { name: string; description: string; parameters: unknown; execute: (id: string, params: unknown) => Promise<unknown> }[] = [];
    const mockPi = {
      registerTool(t: unknown) {
        registered.push(t as { name: string; description: string; parameters: unknown; execute: (id: string, params: unknown) => Promise<unknown> });
      },
    };

    registerSearchTools(mockPi);
    for (const tool of registered) {
      expect(typeof tool.name).toBe("string");
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("execute returns {content: [{type:'text', text}]} on success", async () => {
    const registered: { name: string; execute: (id: string, params: unknown) => Promise<unknown> }[] = [];
    const mockPi = {
      registerTool(t: unknown) {
        registered.push(t as { name: string; execute: (id: string, params: unknown) => Promise<unknown> });
      },
    };

    registerSearchTools(mockPi);

    // Find web_search tool
    const searchTool = registered.find((t) => t.name === "web_search");
    expect(searchTool).toBeDefined();

    // Mock backend for search
    const mockBackend = {
      name: "ddgs",
      isAvailable: () => true,
      supportsSearch: true,
      supportsExtract: false,
      search: vi.fn().mockResolvedValue([
        { title: "Result", url: "https://example.com", description: "Desc" },
      ]),
      extract: vi.fn().mockResolvedValue({ markdown: "", title: "", url: "" }),
    };
    vi.mocked(resolveSearchBackend).mockReturnValue({ ok: true, backend: mockBackend as never });

    const result = await searchTool!.execute("call-1", { query: "test" });
    expect(result).toHaveProperty("content");
    const content = (result as { content: { type: string; text: string }[] }).content;
    expect(content).toHaveLength(1);
    expect(content[0]?.type).toBe("text");
    expect(content[0]?.text).toContain("Result");
  });

  it("execute returns error text when tool fails", async () => {
    const registered: { name: string; execute: (id: string, params: unknown) => Promise<unknown> }[] = [];
    const mockPi = {
      registerTool(t: unknown) {
        registered.push(t as { name: string; execute: (id: string, params: unknown) => Promise<unknown> });
      },
    };

    registerSearchTools(mockPi);

    const searchTool = registered.find((t) => t.name === "web_search");
    // No query → error
    const result = await searchTool!.execute("call-1", {});
    const content = (result as { content: { type: string; text: string }[] }).content;
    expect(content[0]?.text).toContain("Error:");
  });

  it("execute catches thrown exceptions and returns error text", async () => {
    const registered: { name: string; execute: (id: string, params: unknown) => Promise<unknown> }[] = [];
    const mockPi = {
      registerTool(t: unknown) {
        registered.push(t as { name: string; execute: (id: string, params: unknown) => Promise<unknown> });
      },
    };

    registerSearchTools(mockPi);

    // Mock resolveSearchBackend to throw
    vi.mocked(resolveSearchBackend).mockImplementation(() => {
      throw new Error("unexpected crash");
    });

    const searchTool = registered.find((t) => t.name === "web_search");
    const result = await searchTool!.execute("call-1", { query: "test" });
    const content = (result as { content: { type: string; text: string }[] }).content;
    expect(content[0]?.text).toContain("Error: unexpected crash");
  });

  it("descriptions are meaningful for both tools", () => {
    const registered: { name: string; description: string }[] = [];
    const mockPi = {
      registerTool(t: unknown) {
        registered.push(t as { name: string; description: string });
      },
    };

    registerSearchTools(mockPi);

    const searchDesc = registered.find((t) => t.name === "web_search")?.description;
    const extractDesc = registered.find((t) => t.name === "web_extract")?.description;

    expect(searchDesc).toBeDefined();
    expect(searchDesc!.length).toBeGreaterThan(20);
    expect(extractDesc).toBeDefined();
    expect(extractDesc!.length).toBeGreaterThan(20);
  });
});