/**
 * @my-agent/web — dashboard SPA smoke tests.
 *
 * Covers: module loads without error, dashboardHtml() generates valid HTML
 * document structure, honours the title + wsPath options, and embeds the
 * WebSocket event-handling client code.
 */
import { describe, it, expect } from "vitest";
import { dashboardHtml } from "./index.js";

describe("dashboardHtml()", () => {
  it("module loads and exports a callable dashboardHtml function", () => {
    expect(typeof dashboardHtml).toBe("function");
  });

  it("generates valid HTML document structure", () => {
    const html = dashboardHtml();
    expect(typeof html).toBe("string");
    expect(html.toLowerCase()).toContain("<!doctype html>");
    expect(html).toContain("<html");
    expect(html).toContain("<head>");
    expect(html).toContain("</head>");
    expect(html).toContain("<body>");
    expect(html).toContain("</body>");
    expect(html).toContain("</html>");
  });

  it("uses the provided title", () => {
    const html = dashboardHtml({ title: "My Agent Dashboard" });
    expect(html).toContain("<title>My Agent Dashboard</title>");
  });

  it("uses a default title when none is provided", () => {
    const html = dashboardHtml();
    expect(html).toContain("<title>mya</title>");
  });

  it("embeds the WS path for event streaming", () => {
    const html = dashboardHtml({ wsPath: "/custom-events" });
    expect(html).toContain("/custom-events");
    // The inline client opens a WebSocket connection for the event bus.
    expect(html).toContain("WebSocket");
    // WS event handling: the client parses incoming envelopes + renders them.
    expect(html).toContain("onmessage");
  });
});
