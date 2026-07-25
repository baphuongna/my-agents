// @vitest-environment jsdom
/**
 * usePageHeader — toolbar-injection contract.
 *
 * Covers: setTitle updates the header, setAfterTitle/setEnd inject content,
 * slots clear on pathname change, and the hook throws without a provider.
 *
 * The provider renders its header bar into the DOM, so `screen` queries can
 * assert on the shown title + injected slots.
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, afterEach } from "vitest";
import {
  render,
  renderHook,
  screen,
  fireEvent,
  act,
  cleanup,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { I18nProvider } from "@/lib/i18n";
import { PageHeaderProvider } from "@/components/PageHeaderProvider";
import { usePageHeader } from "@/hooks/usePageHeader";

afterEach(cleanup);

/** renderHook wrapper: the providers PageHeaderProvider depends on. */
function wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={["/cron"]}>
      <I18nProvider>
        <PageHeaderProvider>{children}</PageHeaderProvider>
      </I18nProvider>
    </MemoryRouter>
  );
}

describe("[unit] usePageHeader — missing provider", () => {
  it("throws when used outside a PageHeaderProvider", () => {
    expect(() => renderHook(() => usePageHeader())).toThrow(/PageHeaderProvider/);
  });
});

describe("[unit] usePageHeader — header title", () => {
  it("derives the default title from the route", () => {
    renderHook(() => usePageHeader(), { wrapper });
    // resolvePageTitle("/cron") → localized "Cron"
    expect(screen.getByRole("heading")).toHaveTextContent("Cron");
  });

  it("setTitle overrides the header title, and null reverts to default", () => {
    const { result } = renderHook(() => usePageHeader(), { wrapper });
    expect(screen.getByRole("heading")).toHaveTextContent("Cron");
    act(() => result.current.setTitle("My Custom Title"));
    expect(screen.getByRole("heading")).toHaveTextContent("My Custom Title");
    act(() => result.current.setTitle(null));
    expect(screen.getByRole("heading")).toHaveTextContent("Cron");
  });

  it("exposes the displayed title on the hook return", () => {
    const { result } = renderHook(() => usePageHeader(), { wrapper });
    expect(result.current.title).toBe("Cron");
    act(() => result.current.setTitle("Override"));
    expect(result.current.title).toBe("Override");
  });
});

describe("[unit] usePageHeader — slot injection", () => {
  it("setAfterTitle injects content next to the title", () => {
    const { result } = renderHook(() => usePageHeader(), { wrapper });
    act(() =>
      result.current.setAfterTitle(<span data-testid="after">12 items</span>),
    );
    expect(screen.getByTestId("after")).toHaveTextContent("12 items");
  });

  it("setEnd injects trailing toolbar content", () => {
    const { result } = renderHook(() => usePageHeader(), { wrapper });
    act(() =>
      result.current.setEnd(<button data-testid="end-btn">New Job</button>),
    );
    expect(screen.getByTestId("end-btn")).toHaveTextContent("New Job");
  });
});

describe("[unit] usePageHeader — slot lifecycle", () => {
  it("clears all slots when the pathname changes", () => {
    function Probe() {
      usePageHeader();
      return null;
    }
    function GoTo({ to }: { to: string }) {
      const nav = useNavigate();
      return <button onClick={() => nav(to)}>navigate</button>;
    }

    const { result } = renderHook(() => usePageHeader(), {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={["/cron"]}>
          <I18nProvider>
            <PageHeaderProvider>
              {children}
              <Probe />
              <GoTo to="/models" />
            </PageHeaderProvider>
          </I18nProvider>
        </MemoryRouter>
      ),
    });

    // Populate all three slots.
    act(() => {
      result.current.setTitle("Override");
      result.current.setAfterTitle(<span data-testid="after">x</span>);
      result.current.setEnd(<span data-testid="end">y</span>);
    });
    expect(screen.getByRole("heading")).toHaveTextContent("Override");
    expect(screen.getByTestId("after")).toBeInTheDocument();
    expect(screen.getByTestId("end")).toBeInTheDocument();

    // Navigate to a new route → provider clears every slot (no flash).
    fireEvent.click(screen.getByText("navigate"));
    expect(screen.getByRole("heading")).toHaveTextContent("Models");
    expect(screen.queryByTestId("after")).not.toBeInTheDocument();
    expect(screen.queryByTestId("end")).not.toBeInTheDocument();
  });
});
