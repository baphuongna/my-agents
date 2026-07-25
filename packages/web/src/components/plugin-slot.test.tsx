// @vitest-environment jsdom
/**
 * PluginSlot component tests.
 *
 * Covers: renders fallback when no components are registered, renders nothing
 * with no fallback, renders registered components in priority order, multiple
 * components, and reactive re-render after late registration (useSyncExternalStore).
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { PluginSlot } from "./PluginSlot";
import {
  registerSlot,
  clearRegistry,
} from "@/lib/plugin-registry";

const SLOT = "dashboard:top" as const;

function Hello() {
  return <div data-testid="hello">Hello</div>;
}
function World() {
  return <div data-testid="world">World</div>;
}
function Second() {
  return <div data-testid="second">Second</div>;
}

beforeEach(() => {
  clearRegistry();
});
afterEach(() => {
  clearRegistry();
  cleanup();
});

describe("[unit] PluginSlot — empty slot", () => {
  it("renders the fallback when no components are registered", () => {
    render(
      <PluginSlot name={SLOT} fallback={<span data-testid="fb">default</span>} />,
    );
    expect(screen.getByTestId("fb")).toBeInTheDocument();
  });

  it("renders nothing when no fallback is provided", () => {
    const { container } = render(<PluginSlot name={SLOT} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("[unit] PluginSlot — registered components", () => {
  it("renders a single registered component", () => {
    registerSlot(SLOT, Hello);
    render(<PluginSlot name={SLOT} />);
    expect(screen.getByTestId("hello")).toBeInTheDocument();
  });

  it("renders multiple components in registration order", () => {
    registerSlot(SLOT, Hello);
    registerSlot(SLOT, World);
    render(<PluginSlot name={SLOT} />);
    const nodes = screen.getAllByTestId(/hello|world/);
    expect(nodes.map((n) => n.dataset.testid)).toEqual(["hello", "world"]);
  });

  it("renders components in priority order (lower first)", () => {
    registerSlot(SLOT, Hello, 50);
    registerSlot(SLOT, Second, 10);
    render(<PluginSlot name={SLOT} />);
    const nodes = screen.getAllByTestId(/hello|second/);
    expect(nodes.map((n) => n.dataset.testid)).toEqual(["second", "hello"]);
  });

  it("prefers registered components over the fallback", () => {
    registerSlot(SLOT, Hello);
    render(
      <PluginSlot name={SLOT} fallback={<span data-testid="fb">fallback</span>} />,
    );
    expect(screen.getByTestId("hello")).toBeInTheDocument();
    expect(screen.queryByTestId("fb")).not.toBeInTheDocument();
  });
});

describe("[unit] PluginSlot — reactive registration", () => {
  it("re-renders to show a component registered after mount", () => {
    render(<PluginSlot name={SLOT} />);
    expect(screen.queryByTestId("hello")).not.toBeInTheDocument();

    act(() => {
      registerSlot(SLOT, Hello);
    });
    expect(screen.getByTestId("hello")).toBeInTheDocument();
  });

  it("falls back to fallback again when all components are unregistered", () => {
    const unsub = registerSlot(SLOT, Hello);
    render(
      <PluginSlot name={SLOT} fallback={<span data-testid="fb">default</span>} />,
    );
    expect(screen.getByTestId("hello")).toBeInTheDocument();

    act(() => {
      unsub();
    });
    expect(screen.queryByTestId("hello")).not.toBeInTheDocument();
    expect(screen.getByTestId("fb")).toBeInTheDocument();
  });
});
