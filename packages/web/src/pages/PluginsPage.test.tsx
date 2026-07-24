// @vitest-environment jsdom
/**
 * PluginsPage — stub page renders empty state + disabled install affordance.
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils";
import { PluginsPage } from "@/pages/PluginsPage";

afterEach(cleanup);

describe("PluginsPage", () => {
  it("renders the page title", () => {
    renderWithProviders(<PluginsPage />);
    expect(screen.getByText("Plugins")).toBeInTheDocument();
  });

  it("shows the empty-state message", () => {
    renderWithProviders(<PluginsPage />);
    expect(screen.getByText("No plugins installed")).toBeInTheDocument();
  });

  it("renders a disabled Install from URL button", () => {
    renderWithProviders(<PluginsPage />);
    const btn = screen.getByRole("button", { name: /install from url/i });
    expect(btn).toBeDisabled();
  });

  it("mentions the future marketplace", () => {
    renderWithProviders(<PluginsPage />);
    expect(screen.getByText(/marketplace will be available/i)).toBeInTheDocument();
  });
});
