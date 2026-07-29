// [unit] App routing table — safety net for the data-driven routing refactor
// (distilled from hermes-agent/web). Asserts the builtin route set is exactly
// the pages we ship and every entry maps to a component, so a refactor cannot
// silently drop or misname a page. Pure data (no router/DOM rendering needed).
import { describe, it, expect } from "vitest";
import { PAGE_ROUTES, ROOT_REDIRECT, FALLBACK_PATH } from "@/App";

const EXPECTED_PATHS = [
  "/dashboard",
  "/chat",
  "/sessions",
  "/events",
  "/cron",
  "/models",
  "/tools",
  "/files",
  "/analytics",
  "/logs",
  "/skills",
  "/keys",
  "/push",
  "/collab",
  "/sync",
  "/config",
  "/status",
  "/channels",
  "/mcp",
  "/docs",
  "/system",
  "/plugins",
  "/profiles",
  "/profiles/new",
  "/webhooks",
  "/pairing",
  "/pets",
  "/achievements",
] as const;

describe("[unit] App builtin routes", () => {
  it("exposes exactly the expected page paths (no route dropped or added)", () => {
    expect(Object.keys(PAGE_ROUTES).sort()).toEqual([...EXPECTED_PATHS].sort());
  });

  it("every route maps to a renderable component", () => {
    for (const [path, Page] of Object.entries(PAGE_ROUTES)) {
      expect(typeof Page, `${path} must map to a component`).toBe("function");
    }
  });

  it("every path is a non-empty absolute route", () => {
    for (const path of Object.keys(PAGE_ROUTES)) {
      expect(path.startsWith("/"), `${path} must be absolute`).toBe(true);
      expect(path.length > 1, `${path} must not be bare "/"`).toBe(true);
    }
  });
});

describe("[unit] App redirect targets", () => {
  it("ROOT_REDIRECT points to /dashboard (cold-load landing)", () => {
    expect(ROOT_REDIRECT).toBe("/dashboard");
  });

  it("FALLBACK_PATH points to /chat (unknown-route catch-all)", () => {
    expect(FALLBACK_PATH).toBe("/chat");
  });

  it("/profiles/new is registered as a page route (sibling to /profiles)", () => {
    // Boundary: /profiles/new is a real page entry, NOT just a sub-path of /profiles.
    // RR7 ranks static over dynamic, so both coexist; dropping /profiles/new from
    // PAGE_ROUTES would 404 it.
    expect(PAGE_ROUTES["/profiles/new"]).toBeDefined();
    expect(PAGE_ROUTES["/profiles"]).toBeDefined();
  });
});
