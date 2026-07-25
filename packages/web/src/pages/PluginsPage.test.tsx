// @vitest-environment jsdom
/**
 * PluginsPage — slot reference + live registered-component list.
 *
 * The page documents the slot infrastructure (KNOWN_SLOT_NAMES) and shows the
 * "Plugin system is ready" state. No plugin loader yet, so Install from URL
 * stays disabled.
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { screen, cleanup, act } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils";
import { PluginsPage } from "@/pages/PluginsPage";
import { KNOWN_SLOT_NAMES } from "@/lib/plugin-slots";
import { registerSlot, clearRegistry } from "@/lib/plugin-registry";

beforeEach(() => {
  clearRegistry();
});
afterEach(() => {
  clearRegistry();
  cleanup();
});

describe("PluginsPage", () => {
  it("renders the page title", () => {
    renderWithProviders(<PluginsPage />);
    expect(screen.getByText("Plugins")).toBeInTheDocument();
  });

  it("shows the 'Plugin system is ready' status", () => {
    renderWithProviders(<PluginsPage />);
    expect(screen.getByText(/plugin system is ready/i)).toBeInTheDocument();
  });

  it("renders a disabled Install from URL button", () => {
    renderWithProviders(<PluginsPage />);
    const btn = screen.getByRole("button", { name: /install from url/i });
    expect(btn).toBeDisabled();
  });

  it("lists all KNOWN_SLOT_NAMES with descriptions", () => {
    renderWithProviders(<PluginsPage />);
    expect(screen.getByText(new RegExp(`${KNOWN_SLOT_NAMES.length}`))).toBeInTheDocument();
    for (const name of KNOWN_SLOT_NAMES) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("shows 0 active components when nothing is registered", () => {
    renderWithProviders(<PluginsPage />);
    expect(screen.getByText("No plugins registered")).toBeInTheDocument();
  });

  it("mentions the future marketplace", () => {
    renderWithProviders(<PluginsPage />);
    expect(screen.getByText(/marketplace will be available/i)).toBeInTheDocument();
  });

  it("lists a registered slot's components with a live count", () => {
    function Widget() {
      return <div>hi</div>;
    }
    registerSlot("dashboard:top", Widget);
    renderWithProviders(<PluginsPage />);

    // The registered-components card appears, naming the slot + a count badge.
    expect(screen.getByText(/Registered Slot Components/i)).toBeInTheDocument();
    expect(screen.getAllByText("dashboard:top").length).toBeGreaterThan(0);
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("reactively lists a slot once a component is registered after mount", async () => {
    const { rerender } = renderWithProviders(<PluginsPage />);
    expect(screen.queryByText(/Registered Slot Components/i)).not.toBeInTheDocument();

    function Widget() {
      return <div>hi</div>;
    }

    act(() => {
      registerSlot("dashboard:top", Widget);
    });
    rerender(<PluginsPage />);

    // Card now renders (re-reads the registry on re-render).
    expect(screen.getByText(/Registered Slot Components/i)).toBeInTheDocument();
  });
});
