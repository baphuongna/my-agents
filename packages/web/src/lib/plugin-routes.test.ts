// [unit] Plugin route merging — pure data test for buildRoutes() / buildNavItems()
// (distilled from hermes-agent/web App.tsx commit a61183b5).
import { describe, it, expect } from "vitest";
import {
  buildRoutes,
  buildNavItems,
  resolveRouteElement,
  type BuiltinRoute,
} from "@/lib/plugin-routes";
import type { PluginManifest } from "@/lib/plugin-manifest";

// Placeholder component type for tests (no React rendering needed).
const Stub: React.ComponentType = () => null;

const BUILTINS: BuiltinRoute[] = [
  { path: "/dashboard", component: Stub },
  { path: "/chat", component: Stub },
  { path: "/sessions", component: Stub },
  { path: "/plugins", component: Stub }, // reserved
];

describe("[unit] buildRoutes — pure data", () => {
  it("returns only builtins when manifests is empty", () => {
    const routes = buildRoutes(BUILTINS, []);
    expect(routes.map((r) => r.path)).toEqual([
      "/dashboard", "/chat", "/sessions", "/plugins",
    ]);
    expect(routes.every((r) => r.key.startsWith("builtin:"))).toBe(true);
    expect(routes.every((r) => r.element.kind === "builtin")).toBe(true);
  });

  it("preserves builtin order even with addon manifests", () => {
    const routes = buildRoutes(BUILTINS, [
      { name: "billing", tab: { path: "/billing", label: "Billing" } },
    ]);
    expect(routes.map((r) => r.path)).toEqual([
      "/dashboard", "/chat", "/sessions", "/plugins", "/billing",
    ]);
  });

  it("override replaces builtin at that path (descriptor kind flips to plugin)", () => {
    const routes = buildRoutes(BUILTINS, [
      { name: "custom-chat", tab: { override: "/chat", label: "Custom Chat" } },
    ]);
    const chatRoute = routes.find((r) => r.path === "/chat")!;
    expect(chatRoute.key).toBe("override:custom-chat");
    expect(chatRoute.element.kind).toBe("plugin");
    if (chatRoute.element.kind === "plugin") {
      expect(chatRoute.element.pluginName).toBe("custom-chat");
    }
    expect(routes.filter((r) => r.path === "/chat").length).toBe(1);
  });

  it("skips addon whose path collides with a builtin (without override)", () => {
    const routes = buildRoutes(BUILTINS, [
      { name: "dup", tab: { path: "/dashboard" } },
    ]);
    // builtin /dashboard still wins, no duplicate
    expect(routes.filter((r) => r.path === "/dashboard").length).toBe(1);
    expect(routes.find((r) => r.path === "/dashboard")?.key).toBe(
      "builtin:/dashboard",
    );
  });

  it("skips reserved /plugins path from addon manifests", () => {
    const routes = buildRoutes(BUILTINS, [
      { name: "bad", tab: { path: "/plugins" } },
    ]);
    expect(routes.filter((r) => r.key.startsWith("plugin:bad")).length).toBe(0);
    expect(routes.find((r) => r.path === "/plugins")?.key).toBe(
      "builtin:/plugins",
    );
  });

  it("hidden plugin still gets a route (URL-reachable, hidden key prefix)", () => {
    const routes = buildRoutes(BUILTINS, [
      { name: "secret", tab: { path: "/secret", hidden: true } },
    ]);
    const secret = routes.find((r) => r.path === "/secret");
    expect(secret).toBeDefined();
    expect(secret?.key).toBe("plugin:hidden:secret");
    expect(secret?.element.kind).toBe("plugin");
  });

  it("hidden plugin without tab.path is dropped", () => {
    const routes = buildRoutes(BUILTINS, [
      { name: "hidden-no-path", tab: { hidden: true } },
    ]);
    expect(routes.length).toBe(BUILTINS.length);
  });

  it("manifest without tab is ignored", () => {
    const routes = buildRoutes(BUILTINS, [
      { name: "no-tab" }, // no tab field
      { name: "with-tab", tab: { path: "/billing" } },
    ]);
    expect(routes.filter((r) => r.key.startsWith("plugin:no-tab")).length).toBe(0);
    expect(routes.find((r) => r.path === "/billing")).toBeDefined();
  });

  it("multiple addons get stable unique keys", () => {
    const routes = buildRoutes(BUILTINS, [
      { name: "a", tab: { path: "/a" } },
      { name: "b", tab: { path: "/b" } },
      { name: "c", tab: { path: "/c" } },
    ]);
    const keys = routes.map((r) => r.key);
    const uniq = new Set(keys);
    expect(uniq.size).toBe(keys.length);
  });
});

describe("[unit] buildNavItems — pure data", () => {
  const builtinNav = [
    { path: "/dashboard", label: "Dashboard", group: "main" as const },
    { path: "/chat", label: "Chat", group: "main" as const },
    { path: "/config", label: "Config", group: "config" as const },
  ];

  it("returns only builtins when no manifests", () => {
    const nav = buildNavItems(builtinNav, []);
    expect(nav.length).toBe(3);
    expect(nav.every((n) => n.pluginName === "__builtin__")).toBe(true);
  });

  it("appends addon plugin entries (non-hidden)", () => {
    const nav = buildNavItems(builtinNav, [
      { name: "billing", tab: { path: "/billing", label: "Billing" } },
    ]);
    expect(nav.find((n) => n.path === "/billing")?.pluginName).toBe("billing");
  });

  it("does NOT append hidden plugin entries", () => {
    const nav = buildNavItems(builtinNav, [
      { name: "secret", tab: { path: "/secret", hidden: true, label: "Secret" } },
    ]);
    expect(nav.find((n) => n.path === "/secret")).toBeUndefined();
  });

  it("override replaces the matching builtin nav entry", () => {
    const nav = buildNavItems(builtinNav, [
      { name: "custom-chat", tab: { override: "/chat", label: "Custom Chat" } },
    ]);
    expect(nav.filter((n) => n.path === "/chat").length).toBe(1);
    expect(nav.find((n) => n.path === "/chat")?.pluginName).toBe("custom-chat");
    expect(nav.find((n) => n.path === "/chat")?.label).toBe("Custom Chat");
  });
});

describe("[unit] resolveRouteElement", () => {
  it("resolves builtin Component to <C />", () => {
    const routes = buildRoutes(BUILTINS, []);
    const rendered = resolveRouteElement(routes[0]!.element, () => undefined);
    // The exact element shape isn't important; just check it renders without
    // throwing and returns a non-null React node.
    expect(rendered).not.toBeNull();
  });

  it("returns null when plugin page is not registered", () => {
    const routes = buildRoutes(BUILTINS, [
      { name: "x", tab: { path: "/x" } },
    ]);
    const pluginRoute = routes.find((r) => r.path === "/x")!;
    const rendered = resolveRouteElement(pluginRoute.element, () => undefined);
    expect(rendered).toBeNull();
  });

  it("resolves plugin page when registered", () => {
    const routes = buildRoutes(BUILTINS, [
      { name: "y", tab: { path: "/y" } },
    ]);
    const pluginRoute = routes.find((r) => r.path === "/y")!;
    const rendered = resolveRouteElement(pluginRoute.element, () => Stub);
    expect(rendered).not.toBeNull();
  });
});
