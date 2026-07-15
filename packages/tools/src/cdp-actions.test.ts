/**
 * CDP Action Model tests (PHASE 3-5).
 *
 * Pure-function tests for extractOutline/prepareAction (no browser) and
 * mock-client tests for executeAction (no real CDP connection).
 */
import { describe, it, expect, vi } from "vitest";
import {
  extractOutline,
  prepareAction,
  executeAction,
  type OutlineNode,
  type CdpInputClient,
} from "./cdp-actions.js";

function makeMockClient(): CdpInputClient {
  return {
    Input: {
      dispatchMouseEvent: vi.fn().mockResolvedValue(undefined),
      dispatchKeyEvent: vi.fn().mockResolvedValue(undefined),
      insertText: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe("cdp-actions — extractOutline", () => {
  it("assigns @eN refs in BFS order for a nested tree", () => {
    const tree = {
      role: "RootWebArea",
      name: "Home",
      children: [
        { role: "button", name: "Save", bounds: { x: 10, y: 20, width: 80, height: 30 } },
        {
          role: "textbox",
          name: "Email",
          bounds: { x: 10, y: 60, width: 200, height: 30 },
          children: [{ role: "text", name: "placeholder" }],
        },
      ],
    };
    const outline = extractOutline(tree);
    expect(outline).toHaveLength(4);
    expect(outline.map((n) => n.ref)).toEqual(["@e1", "@e2", "@e3", "@e4"]);
    expect(outline[0]!.role).toBe("RootWebArea");
    expect(outline[1]!.role).toBe("button");
    expect(outline[1]!.actions).toContain("click");
    expect(outline[1]!.rect).toEqual({ x: 10, y: 20, w: 80, h: 30 });
    // Children links are preserved alongside the flat index.
    expect(outline[0]!.children.map((c) => c.ref)).toEqual(["@e2", "@e3"]);
    expect(outline[2]!.children.map((c) => c.ref)).toEqual(["@e4"]);
  });

  it("handles flat CDP tree with nodeId/childIds", () => {
    const tree = {
      nodes: [
        {
          nodeId: "1",
          childIds: ["2", "3"],
          role: { type: "role", value: "RootWebArea" },
          name: { value: "P" },
        },
        {
          nodeId: "2",
          role: { value: "button" },
          name: { value: "OK" },
          bounds: { x: 0, y: 0, width: 10, height: 10 },
        },
        { nodeId: "3", role: { value: "link" }, name: { value: "Home" } },
      ],
    };
    const outline = extractOutline(tree);
    expect(outline).toHaveLength(3);
    expect(outline[0]!.ref).toBe("@e1");
    expect(outline[0]!.role).toBe("RootWebArea");
    expect(outline[0]!.children.map((c) => c.ref)).toEqual(["@e2", "@e3"]);
    expect(outline[1]!.role).toBe("button");
    expect(outline[2]!.title).toBe("Home");
  });

  it("skips ignored nodes", () => {
    const tree = {
      role: "root",
      children: [
        { role: "button", name: "A" },
        { role: "text", name: "ignored-text", ignored: true },
        { role: "link", name: "B" },
      ],
    };
    const outline = extractOutline(tree);
    expect(outline).toHaveLength(3);
    expect(outline.map((n) => n.title)).not.toContain("ignored-text");
  });
});

describe("cdp-actions — prepareAction", () => {
  const outline: OutlineNode[] = [
    {
      ref: "@e1",
      role: "button",
      title: "Save",
      actions: ["click"],
      rect: { x: 100, y: 50, w: 40, h: 20 },
      children: [],
    },
    {
      ref: "@e2",
      role: "textbox",
      title: "Email",
      actions: ["focus"],
      rect: { x: 10, y: 10, w: 200, h: 30 },
      children: [],
    },
  ];

  it("resolves ref to rect-center coordinates", () => {
    const prepared = prepareAction({ action: "click", ref: "@e1" }, outline);
    expect(prepared).toEqual({
      action: "click",
      x: 120,
      y: 60,
      button: "left",
      clickCount: 1,
    });
  });

  it("uses raw x/y when no ref is provided", () => {
    const prepared = prepareAction({ action: "moveMouse", x: 5, y: 7 }, outline);
    expect(prepared).toEqual({ action: "moveMouse", x: 5, y: 7 });
  });

  it("throws on an unknown ref", () => {
    expect(() => prepareAction({ action: "click", ref: "@e99" }, outline)).toThrow(
      /unknown ref/,
    );
  });

  it("clamps and rounds scroll and wait values", () => {
    const w = prepareAction({ action: "wait", ms: 999_999 }, outline);
    expect(w).toEqual({ action: "wait", ms: 60_000 });
    const s = prepareAction(
      { action: "scroll", ref: "@e1", scrollX: 999_999, scrollY: -999_999 },
      outline,
    );
    expect(s).toMatchObject({ scrollX: 10_000, scrollY: -10_000 });
  });

  it("resolves doubleClick to clickCount 2", () => {
    const prepared = prepareAction({ action: "doubleClick", ref: "@e1" }, outline);
    expect(prepared).toMatchObject({ action: "doubleClick", clickCount: 2 });
  });

  it("coerces string-path drag points to {x,y}", () => {
    const prepared = prepareAction(
      { action: "drag", path: [[0, 0], { x: 10, y: 10 }] as unknown as Array<{ x: number; y: number }> },
      outline,
    );
    expect(prepared.action).toBe("drag");
    if (prepared.action === "drag") {
      expect(prepared.path).toEqual([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]);
    }
  });
});

describe("cdp-actions — executeAction", () => {
  it("dispatches mouseMoved + press + release for click", async () => {
    const client = makeMockClient();
    await executeAction(
      { action: "click", x: 50, y: 60, button: "left", clickCount: 1 },
      client,
    );
    const calls = client.Input.dispatchMouseEvent.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls[0]![0]).toMatchObject({ type: "mouseMoved", x: 50, y: 60 });
    expect(calls[1]![0]).toMatchObject({ type: "mousePressed", x: 50, y: 60, button: "left" });
    expect(calls[2]![0]).toMatchObject({ type: "mouseReleased", x: 50, y: 60, button: "left" });
  });

  it("dispatches mouseWheel for scroll", async () => {
    const client = makeMockClient();
    await executeAction(
      { action: "scroll", x: 10, y: 10, scrollX: 0, scrollY: 100 },
      client,
    );
    expect(client.Input.dispatchMouseEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "mouseWheel", deltaX: 0, deltaY: 100 }),
    );
  });

  it("dispatches rawKeyDown + keyUp per key for keypress", async () => {
    const client = makeMockClient();
    await executeAction({ action: "keypress", keys: ["Enter", "a"] }, client);
    const keyCalls = client.Input.dispatchKeyEvent.mock.calls;
    expect(keyCalls).toHaveLength(4);
    expect(keyCalls[0]![0]).toMatchObject({ type: "rawKeyDown", key: "Enter", windowsVirtualKeyCode: 13 });
    expect(keyCalls[2]![0]).toMatchObject({ type: "rawKeyDown", key: "a" });
  });

  it("inserts text for typeText after focusing via click", async () => {
    const client = makeMockClient();
    await executeAction({ action: "typeText", x: 5, y: 5, text: "hi" }, client);
    expect(client.Input.insertText).toHaveBeenCalledWith({ text: "hi" });
    // typeText should NOT do select-all+delete
    const keyCalls = client.Input.dispatchKeyEvent.mock.calls;
    expect(keyCalls).toHaveLength(0);
  });

  it("waits via setTimeout and makes no CDP calls", async () => {
    const client = makeMockClient();
    await executeAction({ action: "wait", ms: 5 }, client);
    expect(client.Input.dispatchMouseEvent).not.toHaveBeenCalled();
    expect(client.Input.dispatchKeyEvent).not.toHaveBeenCalled();
    expect(client.Input.insertText).not.toHaveBeenCalled();
  });
});
