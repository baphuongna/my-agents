// @vitest-environment jsdom
/**
 * EnvPage — Hermes pattern port tests.
 * Covers: PROVIDER_GROUPS grouping + counts, collapsible sections,
 * ENV_VAR_NAME_RE invalid-name rejection, and redacted value display.
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor, fireEvent, cleanup, within } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils";
import { EnvPage } from "@/pages/EnvPage";

const PROVIDERS = [
  { id: "anthropic", envKey: "ANTHROPIC_API_KEY", model: "claude", configured: true, redacted_value: "sk-***" },
  { id: "openai", envKey: "OPENAI_API_KEY", model: "gpt", configured: true },
  { id: "google", envKey: "GOOGLE_API_KEY", model: "gemini", configured: false },
  { id: "custom-thing", envKey: "MY_CUSTOM_KEY", model: "x", configured: false },
];
const STATUS = { status: "ok", providers: PROVIDERS };

/** fetch mock that serves GET /status and an optional POST handler. */
function statusFetch(postHandler?: (url: string, body: unknown) => Response) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "POST" && url === "/providers/config" && postHandler) {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      return postHandler(url, body);
    }
    if (method === "GET" && url === "/status") {
      return new Response(JSON.stringify(STATUS), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  }) as unknown as typeof fetch;
}

describe("EnvPage", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  // ── 1. PROVIDER_GROUPS grouping + counts ───────────────────────────
  it("groups providers by env-var prefix and shows per-group counts", async () => {
    global.fetch = statusFetch();
    renderWithProviders(<EnvPage />);

    await waitFor(() =>
      expect(screen.getByTestId("provider-group-Anthropic")).toBeInTheDocument(),
    );

    // Known-prefix groups appear with their count badge.
    expect(
      within(screen.getByTestId("provider-group-Anthropic")).getByText("1"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("provider-group-OpenAI")).getByText("1"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("provider-group-Google")).getByText("1"),
    ).toBeInTheDocument();

    // The unmatched env var (MY_CUSTOM_KEY) lands in the Custom catch-all.
    const customHeader = screen.getByTestId("provider-group-Custom");
    expect(within(customHeader).getByText("1")).toBeInTheDocument();
    expect(screen.getByText("custom-thing")).toBeInTheDocument();
  });

  // ── 2. Collapsible sections ────────────────────────────────────────
  it("collapses and expands a provider group", async () => {
    global.fetch = statusFetch();
    renderWithProviders(<EnvPage />);

    await waitFor(() =>
      expect(screen.getByTestId("redacted-anthropic")).toBeInTheDocument(),
    );

    // Collapse the Anthropic group → its row unmounts.
    fireEvent.click(screen.getByTestId("provider-group-Anthropic"));
    await waitFor(() =>
      expect(screen.queryByTestId("redacted-anthropic")).toBeNull(),
    );

    // Expand again → row reappears.
    fireEvent.click(screen.getByTestId("provider-group-Anthropic"));
    await waitFor(() =>
      expect(screen.getByTestId("redacted-anthropic")).toBeInTheDocument(),
    );
  });

  // ── 3. Redacted value display ──────────────────────────────────────
  it("shows the redacted value for configured providers and --- when missing", async () => {
    global.fetch = statusFetch();
    renderWithProviders(<EnvPage />);

    await waitFor(() =>
      expect(screen.getByTestId("redacted-anthropic")).toHaveTextContent("sk-***"),
    );
    expect(screen.getByTestId("redacted-openai")).toHaveTextContent("---");
  });

  // ── 4. ENV_VAR_NAME_RE rejects invalid names in the add-key flow ───
  it("blocks save when the env var name is invalid", async () => {
    global.fetch = statusFetch((_url, _body) =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    renderWithProviders(<EnvPage />);

    // Open the add-key modal for the first unconfigured provider (google).
    const addButtons = await screen.findAllByRole("button", { name: /Add Key/i });
    fireEvent.click(addButtons[0]!);
    await waitFor(() =>
      expect(screen.getByText(/Add google API Key/i)).toBeInTheDocument(),
    );

    const nameInput = screen.getByPlaceholderText("ANTHROPIC_API_KEY");
    const keyInput = screen.getByPlaceholderText("sk-...");
    const saveBtn = screen.getByRole("button", { name: /Save Key/i });

    // Type a secret value so only name validity gates the save.
    fireEvent.change(keyInput, { target: { value: "sk-test" } });

    // Invalid env-var name → error shown, save disabled.
    fireEvent.change(nameInput, { target: { value: "1invalid name!" } });
    expect(screen.getByText(/Invalid env var name/i)).toBeInTheDocument();
    expect(saveBtn).toBeDisabled();

    // Fix the name → error clears, save enabled.
    fireEvent.change(nameInput, { target: { value: "GOOGLE_API_KEY" } });
    expect(screen.queryByText(/Invalid env var name/i)).toBeNull();
    expect(saveBtn).toBeEnabled();
  });

  // ── 5. Valid add-key posts the (validated) env name ────────────────
  it("posts the edited env var name when saving a valid key", async () => {
    const posts: Array<{ envKey: string; value: string }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "POST" && url === "/providers/config") {
        const body = JSON.parse(init?.body as string);
        posts.push({ envKey: body.envKey, value: body.value });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (method === "GET" && url === "/status") {
        return new Response(JSON.stringify(STATUS), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    }) as unknown as typeof fetch;

    renderWithProviders(<EnvPage />);
    const addButtons = await screen.findAllByRole("button", { name: /Add Key/i });
    fireEvent.click(addButtons[0]!);
    await waitFor(() =>
      expect(screen.getByText(/Add google API Key/i)).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByPlaceholderText("ANTHROPIC_API_KEY"), {
      target: { value: "GOOGLE_GENAI_KEY" },
    });
    fireEvent.change(screen.getByPlaceholderText("sk-..."), {
      target: { value: "sk-test" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save Key/i }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.envKey).toBe("GOOGLE_GENAI_KEY");
    expect(posts[0]!.value).toBe("sk-test");
  });
});
