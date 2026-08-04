// [unit] Terminal component — smoke tests for xterm.js integration.
// (Distilled from hermes HermesConsoleModal.)
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { Terminal } from "@/components/Terminal";

// Global polyfill — xterm's RenderDebouncer calls window.requestAnimationFrame
// asynchronously via a WriteBuffer setTimeout.  If the jsdom window is torn
// down before that timer fires, we get an uncaught exception.  Setting this
// as a non-mock global ensures it survives vi.restoreAllMocks().
const raf = (cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 16) as unknown as number;
const caf = (id: number) =>
  clearTimeout(id as unknown as ReturnType<typeof setTimeout>);

describe("[unit] Terminal — smoke", () => {
  beforeEach(() => {
    // Install permanent polyfills (not vi.fn — survive restoreAllMocks).
    (globalThis as any).requestAnimationFrame = raf;
    (globalThis as any).cancelAnimationFrame = caf;
    (window as any).requestAnimationFrame = raf;
    (window as any).cancelAnimationFrame = caf;

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
    // Plain function (not vi.fn) — survives vi.restoreAllMocks() so late
    // xterm render timers don't hit the real jsdom impl.
    HTMLCanvasElement.prototype.getContext = (() => null) as never;
    // jsdom lacks ResizeObserver; xterm uses it for fit-on-resize.
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
  });

  afterEach(async () => {
    // Flush any pending xterm WriteBuffer timers so they don't fire after
    // the jsdom environment is torn down (causing uncaught exceptions).
    await new Promise((r) => setTimeout(r, 50));
    // Re-assert polyfills after mock restore.
    (globalThis as any).requestAnimationFrame = raf;
    (globalThis as any).cancelAnimationFrame = caf;
    (window as any).requestAnimationFrame = raf;
    (window as any).cancelAnimationFrame = caf;
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

  it("unmounts cleanly (no console errors)", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(<Terminal wsUrl="ws://localhost:9999" />);
    // Let xterm's async WriteBuffer settle before unmount.
    await new Promise((r) => setTimeout(r, 50));
    unmount();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
