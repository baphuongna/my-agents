/**
 * Browser automation (Gap 10): Chrome DevTools Protocol client for
 * navigating, clicking, typing, screenshots, and JS evaluation.
 *
 * Uses chrome-remote-interface (lightweight CDP client). System Chrome/Chromium
 * must be running with --remote-debugging-port=9222 (or specified port).
 * Each browser_* tool requires Prompt permission (network access = trust boundary).
 */
import type { Mode, ToolResult } from "@my-agent/core";
import { ok, err, isRecord, type ToolImpl } from "./registry.js";
import { nowWallclock } from "@my-agent/core";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BrowserSession {
  client: any; // chrome-remote-interface Client
  port: number;
}

// ─── BrowserAutomation class ────────────────────────────────────────────────

export class BrowserAutomation {
  private client: any = null;
  private port: number;

  constructor(port = 9222) {
    this.port = port;
  }

  /** Connect to an existing Chrome instance via CDP. */
  async launch(opts?: { port?: number }): Promise<void> {
    if (opts?.port) this.port = opts.port;
    const CDP = (await import("chrome-remote-interface")).default;
    this.client = await CDP({ port: this.port });
  }

  /** Navigate to a URL. Returns title and final URL. */
  async navigate(url: string): Promise<{ title: string; url: string }> {
    this.ensureConnected();
    const { Page } = this.client;
    await Page.enable();
    await Page.navigate({ url });
    await Page.loadEventFired();
    const { result } = await Page.getNavigationHistory();
    const entry = result.entries[result.currentIndex];
    return { title: entry.title, url: entry.url };
  }

  /** Click an element matched by CSS selector. */
  async click(selector: string): Promise<void> {
    this.ensureConnected();
    const { Runtime, Input } = this.client;
    // Get element center coordinates
    const { result } = await Runtime.evaluate({
      expression: `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error("element not found: " + ${JSON.stringify(selector)});
        const rect = el.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      })()`,
      returnByValue: true,
    });
    const { x, y } = result.value as { x: number; y: number };
    await Input.dispatchMouseEvent({ type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await Input.dispatchMouseEvent({ type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }

  /** Type text into an element matched by CSS selector. */
  async type(selector: string, text: string): Promise<void> {
    this.ensureConnected();
    const { Runtime, Input } = this.client;
    // Focus the element
    await Runtime.evaluate({
      expression: `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error("element not found: " + ${JSON.stringify(selector)});
        el.focus();
      })()`,
    });
    // Insert text character by character (simplified; Input.insertText is better)
    await Input.insertText({ text });
  }

  /** Capture a screenshot of the current page. Returns PNG buffer. */
  async screenshot(): Promise<Buffer> {
    this.ensureConnected();
    const { Page } = this.client;
    const { data } = await Page.captureScreenshot({ format: "png" });
    return Buffer.from(data, "base64");
  }

  /** Extract the full HTML content of the page. */
  async extractText(): Promise<string> {
    this.ensureConnected();
    const { DOM } = this.client;
    const { root } = await DOM.getDocument();
    const { outerHTML } = await DOM.getOuterHTML({ nodeId: root.nodeId });
    return outerHTML;
  }

  /** Evaluate JavaScript in the page context and return the result. */
  async evaluate(js: string): Promise<unknown> {
    this.ensureConnected();
    const { Runtime } = this.client;
    const { result, exceptionDetails } = await Runtime.evaluate({
      expression: js,
      returnByValue: true,
    });
    if (exceptionDetails) {
      throw new Error(`Evaluation error: ${exceptionDetails.text}`);
    }
    return result.value;
  }

  /** Wait for an element matching the selector to appear (polls). */
  async waitFor(selector: string, timeout = 5000): Promise<void> {
    this.ensureConnected();
    const { Runtime } = this.client;
    const start = nowWallclock();
    while (nowWallclock() - start < timeout) {
      const { result } = await Runtime.evaluate({
        expression: `!!document.querySelector(${JSON.stringify(selector)})`,
        returnByValue: true,
      });
      if (result.value === true) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Timeout waiting for selector: ${selector}`);
  }

  /** Disconnect from the browser. */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  private ensureConnected(): void {
    if (!this.client) throw new Error("Browser not launched. Call launch() first.");
  }
}

// ─── Shared singleton (per tool call) ──────────────────────────────────────

const sessions = new Map<string, BrowserAutomation>();

function getSession(id: string): BrowserAutomation {
  let session = sessions.get(id);
  if (!session) {
    session = new BrowserAutomation();
    sessions.set(id, session);
  }
  return session;
}

// ─── Tool implementations ───────────────────────────────────────────────────

export const browserNavigateTool: ToolImpl = {
  meta: {
    name: "browser_navigate",
    args: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to navigate to" },
        sessionId: { type: "string", description: "Browser session id (default: 'default')" },
      },
      required: ["url"],
    },
    requiredMode: "Prompt" as Mode,
  },
  async run(args, _ctx): Promise<ToolResult> {
    if (!isRecord(args) || typeof args.url !== "string")
      return err("browser_navigate", "url required");
    const sessionId = typeof args.sessionId === "string" ? args.sessionId : "default";
    const browser = getSession(sessionId);
    try {
      await browser.launch();
      const { title, url } = await browser.navigate(args.url);
      return ok("browser_navigate", { title, url, sessionId });
    } catch (e) {
      return err("browser_navigate", e instanceof Error ? e.message : String(e));
    }
  },
};

export const browserClickTool: ToolImpl = {
  meta: {
    name: "browser_click",
    args: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector of element to click" },
        sessionId: { type: "string" },
      },
      required: ["selector"],
    },
    requiredMode: "Prompt" as Mode,
  },
  async run(args, _ctx): Promise<ToolResult> {
    if (!isRecord(args) || typeof args.selector !== "string")
      return err("browser_click", "selector required");
    const sessionId = typeof args.sessionId === "string" ? args.sessionId : "default";
    const browser = getSession(sessionId);
    try {
      await browser.click(args.selector);
      return ok("browser_click", { selector: args.selector, sessionId });
    } catch (e) {
      return err("browser_click", e instanceof Error ? e.message : String(e));
    }
  },
};

export const browserTypeTool: ToolImpl = {
  meta: {
    name: "browser_type",
    args: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector of input element" },
        text: { type: "string", description: "Text to type" },
        sessionId: { type: "string" },
      },
      required: ["selector", "text"],
    },
    requiredMode: "Prompt" as Mode,
  },
  async run(args, _ctx): Promise<ToolResult> {
    if (!isRecord(args) || typeof args.selector !== "string" || typeof args.text !== "string")
      return err("browser_type", "selector + text required");
    const sessionId = typeof args.sessionId === "string" ? args.sessionId : "default";
    const browser = getSession(sessionId);
    try {
      await browser.type(args.selector, args.text);
      return ok("browser_type", { selector: args.selector, sessionId });
    } catch (e) {
      return err("browser_type", e instanceof Error ? e.message : String(e));
    }
  },
};

export const browserScreenshotTool: ToolImpl = {
  meta: {
    name: "browser_screenshot",
    args: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
      },
    },
    requiredMode: "Prompt" as Mode,
  },
  async run(args, _ctx): Promise<ToolResult> {
    const sessionId = isRecord(args) && typeof args.sessionId === "string" ? args.sessionId : "default";
    const browser = getSession(sessionId);
    try {
      const image = await browser.screenshot();
      return ok("browser_screenshot", {
        imageBase64: image.toString("base64"),
        sessionId,
      });
    } catch (e) {
      return err("browser_screenshot", e instanceof Error ? e.message : String(e));
    }
  },
};

export const browserExtractTool: ToolImpl = {
  meta: {
    name: "browser_extract",
    args: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
      },
    },
    requiredMode: "Prompt" as Mode,
  },
  async run(args, _ctx): Promise<ToolResult> {
    const sessionId = isRecord(args) && typeof args.sessionId === "string" ? args.sessionId : "default";
    const browser = getSession(sessionId);
    try {
      const html = await browser.extractText();
      return ok("browser_extract", { html, sessionId });
    } catch (e) {
      return err("browser_extract", e instanceof Error ? e.message : String(e));
    }
  },
};

export const browserEvalTool: ToolImpl = {
  meta: {
    name: "browser_eval",
    args: {
      type: "object",
      properties: {
        js: { type: "string", description: "JavaScript expression to evaluate" },
        sessionId: { type: "string" },
      },
      required: ["js"],
    },
    requiredMode: "Prompt" as Mode,
  },
  async run(args, _ctx): Promise<ToolResult> {
    if (!isRecord(args) || typeof args.js !== "string")
      return err("browser_eval", "js required");
    const sessionId = typeof args.sessionId === "string" ? args.sessionId : "default";
    const browser = getSession(sessionId);
    try {
      const result = await browser.evaluate(args.js);
      return ok("browser_eval", { result, sessionId });
    } catch (e) {
      return err("browser_eval", e instanceof Error ? e.message : String(e));
    }
  },
};

export const browserCloseTool: ToolImpl = {
  meta: {
    name: "browser_close",
    args: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
      },
    },
    requiredMode: "Prompt" as Mode,
  },
  async run(args, _ctx): Promise<ToolResult> {
    const sessionId = isRecord(args) && typeof args.sessionId === "string" ? args.sessionId : "default";
    const browser = getSession(sessionId);
    try {
      await browser.close();
      sessions.delete(sessionId);
      return ok("browser_close", { sessionId });
    } catch (e) {
      return err("browser_close", e instanceof Error ? e.message : String(e));
    }
  },
};