// @vitest-environment jsdom
/**
 * plugin-sdk — window exposure tests (F5).
 *
 * Covers: exposePluginSDK() sets __MYA_PLUGINS__ (register + registerSlot) +
 * __MYA_PLUGIN_SDK__ (sdkVersion, React, hooks, components, utils); idempotent;
 * registerSlot via window renders into <PluginSlot>; unknown slots warn + no-op.
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PluginSlot } from "@/components/PluginSlot";
import { clearRegistry } from "@/lib/plugin-registry";
import { exposePluginSDK, SDK_CONTRACT_VERSION } from "@/lib/plugin-sdk";

function Hello() {
  return <div data-testid="hello">Hello</div>;
}

beforeEach(() => {
  clearRegistry();
  // Reset window globals so each test starts from a clean exposure.
  delete (window as unknown as Record<string, unknown>)["__MYA_PLUGINS__"];
  delete (window as unknown as Record<string, unknown>)["__MYA_PLUGIN_SDK__"];
  delete (window as unknown as Record<string, unknown>)["React"];
});

afterEach(() => {
  clearRegistry();
  vi.restoreAllMocks();
  cleanup();
});

describe("[unit] exposePluginSDK — window surface", () => {
  it("sets __MYA_PLUGINS__ with register + registerSlot functions", () => {
    exposePluginSDK();
    const reg = window.__MYA_PLUGINS__;
    expect(reg).toBeDefined();
    expect(typeof reg!.register).toBe("function");
    expect(typeof reg!.registerSlot).toBe("function");
  });

  it("sets __MYA_PLUGIN_SDK__ with sdkVersion + React + hooks + components + utils", () => {
    exposePluginSDK();
    const sdk = window.__MYA_PLUGIN_SDK__;
    expect(sdk).toBeDefined();
    expect(sdk!.sdkVersion).toBe(SDK_CONTRACT_VERSION);
    expect(sdk!.React).toBeDefined();
    for (const h of ["useState", "useEffect", "useCallback", "useMemo", "useRef", "useContext", "createContext"]) {
      expect(typeof (sdk!.hooks as Record<string, unknown>)[h]).toBe("function");
    }
    expect(sdk!.components.Badge).toBeDefined();
    expect(sdk!.components.Button).toBeDefined();
    expect(sdk!.components.Card).toBeDefined();
    expect(sdk!.components.Tooltip).toBeDefined();
    expect(sdk!.utils.cn).toBeDefined();
    // Backward-compat: pre-F5 plugin bundles read window.React directly.
    expect((window as unknown as { React?: unknown }).React).toBeDefined();
  });

  it("is idempotent — a second call does not replace the existing surface", () => {
    exposePluginSDK();
    const firstReg = window.__MYA_PLUGINS__;
    const firstSdk = window.__MYA_PLUGIN_SDK__;
    exposePluginSDK();
    expect(window.__MYA_PLUGINS__).toBe(firstReg); // same reference (not overwritten)
    expect(window.__MYA_PLUGIN_SDK__).toBe(firstSdk);
  });
});

describe("[unit] registerSlot via window → renders into <PluginSlot>", () => {
  it("a component registered via window.__MYA_PLUGINS__.registerSlot renders", () => {
    exposePluginSDK();
    window.__MYA_PLUGINS__!.registerSlot("dashboard:top", Hello);
    render(<PluginSlot name="dashboard:top" />);
    expect(screen.getByTestId("hello")).toBeInTheDocument();
  });

  it("unknown slot warns + no-ops (does not throw, returns unsubscribe fn)", () => {
    exposePluginSDK();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unsub = window.__MYA_PLUGINS__!.registerSlot("bogus:slot" as string, Hello);
    expect(typeof unsub).toBe("function");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("unknown slot");
  });
});
