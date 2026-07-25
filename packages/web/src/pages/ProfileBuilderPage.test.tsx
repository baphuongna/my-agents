// @vitest-environment jsdom
/**
 * ProfileBuilderPage — Hermes pattern port tests.
 * Covers: PROFILE_NAME_RE validation, inline error message, and submit
 * gating when the profile name is invalid/empty.
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils";
import { ProfileBuilderPage } from "@/pages/ProfileBuilderPage";

describe("ProfileBuilderPage", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  /** Serve the three builder option endpoints. */
  function mockOptions() {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/models") {
        return new Response(JSON.stringify({ models: [{ id: "m1", name: "Model 1" }] }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      if (url === "/skills") {
        return new Response(JSON.stringify({ skills: ["s1"] }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      if (url === "/mcp/servers") {
        return new Response(JSON.stringify({ servers: [] }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    }) as unknown as typeof fetch;
  }

  // ── 1. Invalid name shows an inline error and disables Next ────────
  it("shows an inline error and disables Next for an invalid profile name", async () => {
    mockOptions();
    renderWithProviders(<ProfileBuilderPage />);

    await waitFor(() =>
      expect(screen.getByPlaceholderText("my-profile")).toBeInTheDocument(),
    );

    const nameInput = screen.getByPlaceholderText("my-profile");
    fireEvent.change(nameInput, { target: { value: "Bad Name!" } });

    expect(screen.getByTestId("profile-name-error")).toBeInTheDocument();
    expect(screen.getByTestId("profile-next")).toBeDisabled();
  });

  // ── 2. Valid name clears the error and enables Next ────────────────
  it("accepts a valid lowercase name and enables Next", async () => {
    mockOptions();
    renderWithProviders(<ProfileBuilderPage />);

    await waitFor(() =>
      expect(screen.getByPlaceholderText("my-profile")).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByPlaceholderText("my-profile"), {
      target: { value: "my-profile_2" },
    });

    expect(screen.queryByTestId("profile-name-error")).toBeNull();
    expect(screen.getByTestId("profile-next")).toBeEnabled();
  });

  // ── 3. Empty name keeps Next disabled ──────────────────────────────
  it("disables Next when the name is empty", async () => {
    mockOptions();
    renderWithProviders(<ProfileBuilderPage />);

    await waitFor(() =>
      expect(screen.getByPlaceholderText("my-profile")).toBeInTheDocument(),
    );

    expect(screen.getByTestId("profile-next")).toBeDisabled();
    expect(screen.queryByTestId("profile-name-error")).toBeNull();
  });

  // ── 4. Uppercase-only name is rejected ─────────────────────────────
  it("rejects a name containing uppercase letters", async () => {
    mockOptions();
    renderWithProviders(<ProfileBuilderPage />);

    await waitFor(() =>
      expect(screen.getByPlaceholderText("my-profile")).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByPlaceholderText("my-profile"), {
      target: { value: "MyProfile" },
    });

    expect(screen.getByTestId("profile-name-error")).toBeInTheDocument();
    expect(screen.getByTestId("profile-next")).toBeDisabled();
  });
});
