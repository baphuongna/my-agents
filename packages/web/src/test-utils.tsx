/**
 * Test utilities for React component tests.
 * Wraps pages in required providers (ToastProvider) and configures jsdom.
 */
import { vi } from "vitest";
import { type ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { ToastProvider } from "@/lib/toast";
import { SystemActionsProvider } from "@/contexts/SystemActionsProvider";

/** Wrap children in the providers mya pages expect. */
export function AllProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <SystemActionsProvider>{children}</SystemActionsProvider>
    </ToastProvider>
  );
}

/** Render a component with all app providers applied. */
export function renderWithProviders(
  ui: ReactNode,
  options?: Omit<RenderOptions, "wrapper">,
) {
  return render(ui, { wrapper: AllProviders, ...options });
}

/**
 * Build a fetch mock that maps URL/method to a JSON response.
 * Returns the spy so tests can assert calls.
 */
export function mockFetch(
  routes: Record<string, unknown>,
): typeof fetch {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${url}`;
    const body = routes[key];
    if (body === undefined) {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return fetchMock;
}
