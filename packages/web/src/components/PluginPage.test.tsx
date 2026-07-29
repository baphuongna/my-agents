// [unit] PluginPage component — smoke tests for registry-aware rendering.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PluginPage } from "@/components/PluginPage";
import {
  registerPluginPage,
  clearPluginPages,
  clearRegistry,
} from "@/lib/plugin-registry";

const StubComponent = () => <div data-testid="stub-page">Stub page content</div>;

describe("[unit] PluginPage", () => {
  beforeEach(() => {
    clearPluginPages();
    clearRegistry();
  });

  afterEach(() => {
    clearPluginPages();
    clearRegistry();
  });

  it("renders a loading fallback when plugin is not registered", () => {
    render(<PluginPage name="not-registered-yet" />);
    expect(screen.getByTestId("plugin-page-loading:not-registered-yet"))
      .toBeInTheDocument();
    expect(screen.getByText(/not yet registered/i)).toBeInTheDocument();
  });

  it("renders the registered component after registration", () => {
    registerPluginPage("my-plugin", StubComponent);
    render(<PluginPage name="my-plugin" />);
    expect(screen.getByTestId("stub-page")).toBeInTheDocument();
    expect(screen.getByText("Stub page content")).toBeInTheDocument();
  });

  it("unregisters cleanup function removes the page", () => {
    const unregister = registerPluginPage("transient", StubComponent);
    const { rerender } = render(<PluginPage name="transient" />);
    expect(screen.getByTestId("stub-page")).toBeInTheDocument();
    unregister();
    rerender(<PluginPage name="transient" />);
    expect(screen.getByTestId("plugin-page-loading:transient"))
      .toBeInTheDocument();
  });
});
