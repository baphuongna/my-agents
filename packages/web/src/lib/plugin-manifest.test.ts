// [smoke] plugin-manifest types — module loads, types compile, structures valid.
import { describe, it, expect } from "vitest";
import type { PluginManifest, PluginTab, PluginNavItem } from "@/lib/plugin-manifest";

describe("[smoke] plugin-manifest types", () => {
  it("PluginManifest compiles with required name field", () => {
    const manifest: PluginManifest = { name: "test" };
    expect(manifest.name).toBe("test");
  });

  it("PluginManifest accepts optional tab with path/label/override/hidden", () => {
    const manifest: PluginManifest = {
      name: "feature-x",
      version: "2.0.0",
      tab: {
        path: "/x",
        label: "Feature X",
        override: "/chat",
        hidden: false,
        icon: "Sparkles",
        group: "main",
      },
    };
    expect(manifest.tab?.path).toBe("/x");
    expect(manifest.tab?.override).toBe("/chat");
  });

  it("PluginManifest allows arbitrary extra fields (index signature)", () => {
    const manifest: PluginManifest = {
      name: "extensible",
      customField: "value",
      integrity: "sha384-abc",
    };
    expect(manifest["customField"]).toBe("value");
  });

  it("PluginNavItem has required fields for sidebar rendering", () => {
    const navItem: PluginNavItem = {
      path: "/billing",
      label: "Billing",
      pluginName: "billing-plugin",
    };
    expect(navItem.pluginName).toBe("billing-plugin");
  });
});
