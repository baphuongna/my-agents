// [unit] usePlugins hook — fetch manifests, inject scripts, loading state.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePlugins } from "@/lib/usePlugins";

describe("[unit] usePlugins", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.querySelectorAll("script[data-mya-plugin]").forEach((s) => s.remove());
  });

  it("starts loading, then resolves with manifests", async () => {
    const manifests = [
      { name: "test-plugin", version: "1.0.0", tab: { path: "/test", label: "Test" } },
    ];
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: () => Promise.resolve(manifests),
    });

    const { result } = renderHook(() => usePlugins());

    expect(result.current.loading).toBe(true);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.manifests).toEqual(manifests);
  });

  it("returns empty manifests on fetch error (no crash)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("network error"),
    );

    const { result } = renderHook(() => usePlugins());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.manifests).toEqual([]);
  });

  it("injects script tag for plugins with entry field", async () => {
    const manifests = [
      { name: "with-entry", entry: "index.js", tab: { path: "/we", label: "WE" } },
    ];
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: () => Promise.resolve(manifests),
    });

    renderHook(() => usePlugins());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const script = document.querySelector('script[data-mya-plugin="with-entry"]');
    expect(script).not.toBeNull();
    expect(script?.getAttribute("src")).toContain("/api/dashboard-plugins/with-entry/index.js");
  });

  it("does NOT inject script for plugins without entry field", async () => {
    const manifests = [{ name: "no-entry", tab: { path: "/ne", label: "NE" } }];
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: () => Promise.resolve(manifests),
    });

    renderHook(() => usePlugins());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(document.querySelectorAll("script[data-mya-plugin]")).toHaveLength(0);
  });

  it("handles non-array response gracefully", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: () => Promise.resolve(null),
    });

    const { result } = renderHook(() => usePlugins());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.manifests).toEqual([]);
  });
});
