// [unit] Terminal component — smoke tests for xterm.js integration.
// (Distilled from hermes HermesConsoleModal.)
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { Terminal } from "@/components/Terminal";

describe("[unit] Terminal — smoke", () => {
  beforeEach(() => {
    // jsdom layout stubs — xterm.fit() needs non-zero dimensions.
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 320,
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 200,
    });
    // jsdom lacks matchMedia; xterm's color contrast check requires it.
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    // jsdom's HTMLCanvasElement.getContext throws "not implemented".
    // xterm's color module calls it during init; stub it to return null.
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null) as never;
    // jsdom lacks ResizeObserver; xterm uses it for fit-on-resize.
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
    // jsdom lacks requestAnimationFrame polyfill needed by xterm's fit.
    if (!globalThis.requestAnimationFrame) {
      globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
        setTimeout(() => cb(performance.now()), 16) as unknown as number) as typeof requestAnimationFrame;
      globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>)) as typeof cancelAnimationFrame;
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mounts and renders the host element without crashing (no wsUrl)", () => {
    const { container } = render(<Terminal />);
    const host = container.querySelector('[data-testid="terminal-host"]');
    expect(host).not.toBeNull();
    expect(host?.className).toContain("bg-black");
  });

  it("mounts without throwing when wsUrl is provided", () => {
    const { container } = render(<Terminal wsUrl="ws://localhost:9999/api/console" />);
    expect(container.querySelector('[data-testid="terminal-host"]')).not.toBeNull();
  });

  it("applies extra className to host", () => {
    const { container } = render(<Terminal className="custom-host" />);
    const host = container.querySelector(".custom-host");
    expect(host).not.toBeNull();
    expect(host?.getAttribute("data-testid")).toBe("terminal-host");
  });

  it("unmounts cleanly (no console errors)", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(<Terminal wsUrl="ws://localhost:9999" />);
    unmount();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
