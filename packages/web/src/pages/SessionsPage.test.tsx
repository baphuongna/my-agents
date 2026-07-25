// @vitest-environment jsdom
/**
 * SessionsPage — Hermes pattern port tests.
 * Covers: shift-click range select, bulk delete, source icon mapping,
 * and that existing single-row/detail behaviour stays intact.
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  screen,
  waitFor,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import { renderWithProviders } from "@/test-utils";
import { SessionsPage } from "@/pages/SessionsPage";
import type { SessionInfo } from "@/lib/api";

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: "s1",
    title: "Session One",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-02T00:00:00Z",
    messageCount: 5,
    model: "test-model",
    ...overrides,
  };
}

describe("SessionsPage", () => {
  let originalFetch: typeof fetch;
  let deletedIds: string[];

  beforeEach(() => {
    originalFetch = global.fetch;
    deletedIds = [];
  });
  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  /**
   * Build a fetch mock that serves a sessions list for GET /sessions,
   * records DELETE /sessions/:id calls, and returns an empty transcript
   * for GET /sessions/:id (the detail panel).
   */
  function mockSessionsFetch(sessions: SessionInfo[]) {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      const sessionMatch = url.match(/^\/sessions\/([^/?]+)$/);

      if (method === "DELETE" && sessionMatch) {
        deletedIds.push(sessionMatch[1]!);
        return new Response(
          JSON.stringify({ ok: true, killed: sessionMatch[1] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (method === "GET" && url === "/sessions") {
        return new Response(JSON.stringify(sessions), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (method === "GET" && sessionMatch) {
        return new Response(JSON.stringify({ messages: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
      });
    }) as unknown as typeof fetch;
  }

  // ── 1. Shift-click range select ────────────────────────────────────
  it("shift-click selects a range of sessions", async () => {
    const sessions = [
      makeSession({ id: "a", title: "A" }),
      makeSession({ id: "b", title: "B" }),
      makeSession({ id: "c", title: "C" }),
    ];
    mockSessionsFetch(sessions);
    renderWithProviders(<SessionsPage />);

    await waitFor(() =>
      expect(screen.getByTestId("session-checkbox-a")).toBeInTheDocument(),
    );

    // Plain click on the first row selects just it.
    fireEvent.click(screen.getByTestId("session-checkbox-a"));
    expect(screen.getByTestId("session-checkbox-a")).toBeChecked();
    expect(screen.getByTestId("session-checkbox-b")).not.toBeChecked();

    // Shift+click on the third row selects the whole range a..c.
    fireEvent.click(screen.getByTestId("session-checkbox-c"), {
      shiftKey: true,
    });

    expect(screen.getByTestId("session-checkbox-a")).toBeChecked();
    expect(screen.getByTestId("session-checkbox-b")).toBeChecked();
    expect(screen.getByTestId("session-checkbox-c")).toBeChecked();
  });

  // ── 2. Bulk delete button appears when selection > 0 ───────────────
  it("shows the 'Delete selected' button only when sessions are selected", async () => {
    const sessions = [makeSession({ id: "a", title: "A" })];
    mockSessionsFetch(sessions);
    renderWithProviders(<SessionsPage />);

    await waitFor(() =>
      expect(screen.getByTestId("session-checkbox-a")).toBeInTheDocument(),
    );

    expect(
      screen.queryByRole("button", { name: /Delete selected/ }),
    ).toBeNull();

    fireEvent.click(screen.getByTestId("session-checkbox-a"));

    expect(
      screen.getByRole("button", { name: /Delete selected/ }),
    ).toBeInTheDocument();
  });

  // ── 3. Bulk delete clears selection after success ──────────────────
  it("bulk-deletes selected sessions and clears the selection", async () => {
    const sessions = [
      makeSession({ id: "a", title: "A" }),
      makeSession({ id: "b", title: "B" }),
    ];
    mockSessionsFetch(sessions);
    renderWithProviders(<SessionsPage />);

    await waitFor(() =>
      expect(screen.getByTestId("session-checkbox-a")).toBeInTheDocument(),
    );

    // Select both rows.
    fireEvent.click(screen.getByTestId("session-checkbox-a"));
    fireEvent.click(screen.getByTestId("session-checkbox-b"));

    // Open the bulk-delete confirmation dialog.
    fireEvent.click(
      screen.getByRole("button", { name: /Delete selected/ }),
    );

    // The dialog's confirm button has the exact accessible name "Delete".
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/ }));

    await waitFor(() => expect(deletedIds).toHaveLength(2));

    // Rows are removed from the list (no checkboxes left).
    await waitFor(() => {
      expect(screen.queryByTestId("session-checkbox-a")).toBeNull();
      expect(screen.queryByTestId("session-checkbox-b")).toBeNull();
    });

    // The "Delete selected" button disappears once the selection clears.
    expect(
      screen.queryByRole("button", { name: /Delete selected/ }),
    ).toBeNull();
  });

  // ── 4. Source icon mapping: known vs unknown ───────────────────────
  it("renders a specific icon for known sources and a fallback for unknown/missing", async () => {
    const sessions = [
      makeSession({ id: "tg", source: "telegram", title: "TG" }),
      makeSession({ id: "cli", source: "cli", title: "CLI" }),
      makeSession({ id: "unk", source: "weird-source", title: "Weird" }),
      makeSession({ id: "none", title: "NoSource" }),
    ];
    mockSessionsFetch(sessions);
    renderWithProviders(<SessionsPage />);

    await waitFor(() =>
      expect(screen.getByTestId("session-checkbox-tg")).toBeInTheDocument(),
    );

    // Known sources resolve to their own icon id.
    expect(screen.getByTestId("source-icon-telegram")).toBeInTheDocument();
    expect(screen.getByTestId("source-icon-cli")).toBeInTheDocument();

    // Unknown and missing sources both fall back to the default icon id.
    expect(screen.getAllByTestId("source-icon-default")).toHaveLength(2);
  });

  // ── 5. Existing behaviour preserved: row click opens detail ────────
  it("clicking a row body opens the detail panel", async () => {
    const sessions = [
      makeSession({ id: "a", title: "My Session", model: "gpt-x" }),
    ];
    mockSessionsFetch(sessions);
    renderWithProviders(<SessionsPage />);

    await waitFor(() =>
      expect(screen.getByTestId("session-row-a")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("session-row-a"));

    // Detail-only labels appear once the panel mounts.
    await waitFor(() =>
      expect(screen.getByText("Session ID")).toBeInTheDocument(),
    );
    expect(screen.getByText("Transcript")).toBeInTheDocument();
  });

  // ── 6. Search clears the bulk selection ────────────────────────────
  it("clears the bulk selection when the search input changes", async () => {
    const sessions = [
      makeSession({ id: "a", title: "Alpha" }),
      makeSession({ id: "b", title: "Beta" }),
    ];
    mockSessionsFetch(sessions);
    renderWithProviders(<SessionsPage />);

    await waitFor(() =>
      expect(screen.getByTestId("session-checkbox-a")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("session-checkbox-a"));
    expect(screen.getByTestId("session-checkbox-a")).toBeChecked();

    // Typing into search clears selection (footgun guard).
    fireEvent.change(screen.getByPlaceholderText("Search…"), {
      target: { value: "Alpha" },
    });

    await waitFor(() =>
      expect(screen.getByTestId("session-checkbox-a")).not.toBeChecked(),
    );
  });
});
