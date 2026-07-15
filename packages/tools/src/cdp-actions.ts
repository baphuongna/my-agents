/**
 * CDP Action Model — typed action model ported from pi-computer-use (PHASE 3-5),
 * adapted for the Chrome DevTools Protocol accessibility tree + Input domain.
 *
 * - UiAction: discriminated union of press|click|doubleClick|setText|typeText|
 *             keypress|scroll|drag|moveMouse|wait
 * - OutlineNode: simplified accessibility-tree node carrying an @eN ref
 * - prepareAction: resolves a UiAction ref → coordinates via an outline
 * - extractOutline: converts a CDP accessibility tree → OutlineNode[] (@eN refs)
 * - executeAction: dispatches a PreparedAction through the CDP Input domain
 *
 * The reference implementation (pi-computer-use) is a macOS AX model with a
 * ~30-field OutlineNode and wireRef/AXShowMenu fallbacks. This port simplifies
 * to rect-center coordinates only — CDP elements are always addressable by
 * pixel coordinates via Input.dispatchMouseEvent.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type MouseButtonName = "left" | "right" | "middle";

export interface OutlineRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OutlineNode {
  ref: string;
  role: string;
  title: string;
  actions: string[];
  rect?: OutlineRect;
  children: OutlineNode[];
}

export type UiAction =
  | { action: "press"; ref?: string; x?: number; y?: number; button?: MouseButtonName; clickCount?: number }
  | { action: "click"; ref?: string; x?: number; y?: number; button?: MouseButtonName; clickCount?: number }
  | { action: "doubleClick"; ref?: string; x?: number; y?: number; button?: MouseButtonName }
  | { action: "setText"; ref?: string; x?: number; y?: number; text?: string }
  | { action: "typeText"; ref?: string; x?: number; y?: number; text?: string }
  | { action: "keypress"; ref?: string; x?: number; y?: number; keys?: string[] }
  | { action: "scroll"; ref?: string; x?: number; y?: number; scrollX?: number; scrollY?: number }
  | { action: "drag"; path?: Array<{ x: number; y: number } | [number, number]> }
  | { action: "moveMouse"; ref?: string; x?: number; y?: number }
  | { action: "wait"; ms?: number };

export type PreparedAction =
  | { action: "press" | "click" | "doubleClick"; x: number; y: number; button: MouseButtonName; clickCount: number }
  | { action: "setText" | "typeText"; x: number; y: number; text: string }
  | { action: "keypress"; keys: string[]; x?: number; y?: number }
  | { action: "scroll"; x: number; y: number; scrollX: number; scrollY: number }
  | { action: "drag"; path: Array<{ x: number; y: number }> }
  | { action: "moveMouse"; x: number; y: number }
  | { action: "wait"; ms: number };

/** Subset of the CDP client surface this module touches. */
export interface CdpInputClient {
  Input: {
    dispatchMouseEvent(args: Record<string, unknown>): Promise<unknown>;
    dispatchKeyEvent(args: Record<string, unknown>): Promise<unknown>;
    insertText(args: { text: string }): Promise<unknown>;
  };
}

// ─── Coercion helpers (ported from pi-computer-use platform/coerce.ts) ───────

function toFiniteNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function mouseButton(value: unknown): MouseButtonName {
  return value === "right" || value === "middle" ? value : "left";
}

function clickCount(value: unknown, fallback = 1): number {
  return Math.max(1, Math.min(3, Math.round(toFiniteNumber(value, fallback))));
}

function scrollDelta(value: unknown): number {
  return Math.max(-10_000, Math.min(10_000, Math.round(toFiniteNumber(value, 0))));
}

function clampMs(value: unknown): number {
  return Math.max(0, Math.min(60_000, Math.round(toFiniteNumber(value, 1_000))));
}

function keysOf(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error("keypress.keys must contain at least one key.");
  return value.map((key) => String(key));
}

function pathOf(value: unknown): Array<{ x: number; y: number }> {
  if (!Array.isArray(value) || value.length < 2)
    throw new Error("drag.path must contain at least two points.");
  return value.map((point, index) => {
    const px = Array.isArray(point)
      ? toFiniteNumber(point[0], NaN)
      : isRecord(point)
        ? toFiniteNumber(point.x, NaN)
        : NaN;
    const py = Array.isArray(point)
      ? toFiniteNumber(point[1], NaN)
      : isRecord(point)
        ? toFiniteNumber(point.y, NaN)
        : NaN;
    if (!Number.isFinite(px) || !Number.isFinite(py))
      throw new Error(`drag.path point ${index + 1} is invalid.`);
    return { x: px, y: py };
  });
}

// ─── Outline helpers ────────────────────────────────────────────────────────

/** Resolve a ref → OutlineNode from the flat outline array. */
function nodeByRef(outline: OutlineNode[], ref: string): OutlineNode | undefined {
  return outline.find((n) => n.ref === ref);
}

/** Compute the center of a node's rect. Returns undefined when no rect. */
function centerOf(node: OutlineNode): { x: number; y: number } | undefined {
  if (!node.rect) return undefined;
  return { x: node.rect.x + node.rect.w / 2, y: node.rect.y + node.rect.h / 2 };
}

/** Heuristic CDP role → supported action verbs. */
function actionsForRole(role: string): string[] {
  const r = role.toLowerCase();
  if (
    r === "button" ||
    r === "link" ||
    r === "menuitem" ||
    r === "menuitemcheckbox" ||
    r === "menuitemradio" ||
    r === "tab"
  )
    return ["click", "press"];
  if (r === "textbox" || r === "searchbox" || r === "combobox" || r === "spinbutton")
    return ["focus", "setValue"];
  if (r === "checkbox" || r === "radio" || r === "switch" || r === "togglebutton")
    return ["press"];
  if (r === "slider") return ["increment", "decrement"];
  if (r === "scrollbar" || r === "scrollarea") return ["scroll"];
  return [];
}

// ─── extractOutline ─────────────────────────────────────────────────────────

interface RawAxNode {
  nodeId?: unknown;
  role?: unknown;
  name?: unknown;
  bounds?: unknown;
  ignored?: unknown;
  childIds?: unknown;
  children?: unknown;
}

function roleOf(raw: RawAxNode): string {
  const role = raw.role;
  if (isRecord(role) && typeof role.value === "string") return role.value;
  if (typeof role === "string") return role;
  return "";
}

function titleOf(raw: RawAxNode): string {
  const name = raw.name;
  if (isRecord(name) && typeof name.value === "string") return name.value;
  if (typeof name === "string") return name;
  return "";
}

function rectOf(raw: RawAxNode): OutlineRect | undefined {
  const b = raw.bounds;
  if (!isRecord(b)) return undefined;
  const x = toFiniteNumber(b.x, NaN);
  const y = toFiniteNumber(b.y, NaN);
  const w = toFiniteNumber(b.width, NaN);
  const h = toFiniteNumber(b.height, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h))
    return undefined;
  return { x, y, w: Math.max(0, w), h: Math.max(0, h) };
}

/** Recursively build a nested OutlineNode (ref = "") from a raw AX node. */
function buildNode(raw: RawAxNode): OutlineNode | null {
  if (raw.ignored === true) return null;
  const role = roleOf(raw);
  const children: OutlineNode[] = [];
  const kids = Array.isArray(raw.children) ? (raw.children as unknown[]) : [];
  for (const k of kids) {
    if (!isRecord(k)) continue;
    const child = buildNode(k as RawAxNode);
    if (child) children.push(child);
  }
  return {
    ref: "",
    role,
    title: titleOf(raw),
    actions: actionsForRole(role),
    rect: rectOf(raw),
    children,
  };
}

/** Convert a flat CDP tree (nodes with nodeId/childIds) to nested root nodes. */
function flatToRoots(rawNodes: unknown[]): RawAxNode[] {
  const byId = new Map<string, RawAxNode>();
  for (const r of rawNodes) {
    const n = r as RawAxNode;
    if (typeof n.nodeId === "string") byId.set(n.nodeId, { ...n });
  }
  const childSet = new Set<string>();
  for (const n of byId.values()) {
    if (Array.isArray(n.childIds))
      for (const id of n.childIds) if (typeof id === "string") childSet.add(id);
  }
  const roots: RawAxNode[] = [];
  for (const [id, n] of byId) {
    if (!childSet.has(id)) roots.push(n);
    const ids = Array.isArray(n.childIds) ? (n.childIds as unknown[]) : [];
    n.children = ids
      .map((id2) => (typeof id2 === "string" ? byId.get(id2) : undefined))
      .filter((x): x is RawAxNode => Boolean(x));
  }
  if (roots.length === 0 && byId.size > 0) {
    // Fallback: no obvious root (cycle or malformed) — use first node.
    const first = byId.values().next().value;
    if (first) roots.push(first);
  }
  return roots;
}

/** Normalize varied input shapes (nested root, {nodes:[...]} flat, array) into roots. */
function normalizeToRoots(tree: unknown): RawAxNode[] {
  if (Array.isArray(tree)) return tree.filter((n): n is RawAxNode => isRecord(n));
  if (!isRecord(tree)) return [];
  if (Array.isArray(tree.nodes)) {
    const rawNodes = tree.nodes as unknown[];
    const first = rawNodes[0] as RawAxNode | undefined;
    const isFlat = Boolean(
      first && (Array.isArray(first.childIds) || typeof first.nodeId === "string"),
    );
    if (isFlat) return flatToRoots(rawNodes);
    return rawNodes.filter((n): n is RawAxNode => isRecord(n));
  }
  return [tree as RawAxNode];
}

/**
 * Convert a CDP accessibility tree to an outline with @eN refs.
 *
 * Accepts either:
 *  - A nested tree: `{ role, name, bounds, children: [...] }` (single root), or
 *    `{ nodes: [{ ... children: [...] }] }`.
 *  - A flat tree: `{ nodes: [{ nodeId, childIds: [...] }] }` from
 *    Accessibility.getFullAXTree(). Flat nodes are linked via nodeId/childIds.
 *
 * Returns a flat OutlineNode[] in BFS order with `@e1`, `@e2`, … refs assigned.
 * Ignored nodes (CDP `ignored: true`) are skipped. Children links on each node
 * point to the same objects in the returned array, so tree structure is
 * preserved alongside the flat index.
 */
export function extractOutline(accessibilityTree: unknown): OutlineNode[] {
  const roots = normalizeToRoots(accessibilityTree);
  const builtRoots = roots
    .map((r) => buildNode(r))
    .filter((n): n is OutlineNode => n !== null);

  const flat: OutlineNode[] = [];
  const queue: OutlineNode[] = [...builtRoots];
  let i = 0;
  while (i < queue.length) {
    const node = queue[i]!;
    i += 1;
    node.ref = `@e${flat.length + 1}`;
    flat.push(node);
    for (const c of node.children) queue.push(c);
  }
  return flat;
}

// ─── prepareAction ──────────────────────────────────────────────────────────

/**
 * Resolve a UiAction into a PreparedAction with concrete coordinates.
 *
 * Refs are resolved to rect-center coordinates via the outline. For
 * coord-required actions (click, press, doubleClick, setText, typeText,
 * scroll, moveMouse) either a resolvable ref or explicit x/y is required.
 * keypress may omit coords entirely (types at current focus). drag uses its
 * path; wait uses its ms.
 *
 * @throws if a ref is unknown, a ref lacks a rect (for coord-required actions),
 *         or required coords/keys/path are missing.
 */
export function prepareAction(raw: UiAction, outline: OutlineNode[]): PreparedAction {
  if (raw.action === "wait") {
    return { action: "wait", ms: clampMs(raw.ms) };
  }
  if (raw.action === "drag") {
    return { action: "drag", path: pathOf(raw.path) };
  }

  // Resolve optional coords for all remaining variants.
  let x: number | undefined;
  let y: number | undefined;
  const ref = raw.ref;
  if (ref && ref.trim()) {
    const node = nodeByRef(outline, ref.trim());
    if (!node) throw new Error(`prepareAction: unknown ref "${ref}".`);
    const c = centerOf(node);
    if (c) {
      x = c.x;
      y = c.y;
    } else if (raw.action !== "keypress") {
      throw new Error(`prepareAction: ref "${ref}" has no rect.`);
    }
  } else {
    const rx = toFiniteNumber(raw.x, NaN);
    const ry = toFiniteNumber(raw.y, NaN);
    if (Number.isFinite(rx) && Number.isFinite(ry)) {
      x = rx;
      y = ry;
    }
  }

  switch (raw.action) {
    case "press":
    case "click":
      if (x === undefined || y === undefined)
        throw new Error(`${raw.action} requires ref or x+y.`);
      return {
        action: raw.action,
        x,
        y,
        button: mouseButton(raw.button),
        clickCount: clickCount(raw.clickCount),
      };
    case "doubleClick":
      if (x === undefined || y === undefined)
        throw new Error("doubleClick requires ref or x+y.");
      return { action: "doubleClick", x, y, button: mouseButton(raw.button), clickCount: 2 };
    case "setText":
    case "typeText":
      if (x === undefined || y === undefined)
        throw new Error(`${raw.action} requires ref or x+y.`);
      return { action: raw.action, x, y, text: toString(raw.text) };
    case "keypress":
      return { action: "keypress", keys: keysOf(raw.keys), x, y };
    case "scroll":
      if (x === undefined || y === undefined)
        throw new Error("scroll requires ref or x+y.");
      return {
        action: "scroll",
        x,
        y,
        scrollX: scrollDelta(raw.scrollX),
        scrollY: scrollDelta(raw.scrollY),
      };
    case "moveMouse":
      if (x === undefined || y === undefined)
        throw new Error("moveMouse requires ref or x+y.");
      return { action: "moveMouse", x, y };
  }
}

// ─── executeAction ──────────────────────────────────────────────────────────

/** Common named-key → CDP key descriptor mapping. */
const KEY_MAP: Record<string, { key: string; code: string; keyCode: number }> = {
  enter: { key: "Enter", code: "Enter", keyCode: 13 },
  return: { key: "Enter", code: "Enter", keyCode: 13 },
  tab: { key: "Tab", code: "Tab", keyCode: 9 },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  esc: { key: "Escape", code: "Escape", keyCode: 27 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  del: { key: "Delete", code: "Delete", keyCode: 46 },
  space: { key: " ", code: "Space", keyCode: 32 },
  arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  left: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
};

function lookupKey(name: string): { key: string; code: string; keyCode: number } {
  const lower = name.trim().toLowerCase();
  const found = KEY_MAP[lower];
  if (found) return found;
  if (name.length === 1) {
    return {
      key: name,
      code: `Key${name.toUpperCase()}`,
      keyCode: name.toUpperCase().charCodeAt(0),
    };
  }
  return { key: name, code: name, keyCode: 0 };
}

/**
 * Execute a PreparedAction through the CDP Input domain.
 *
 * - click/press/doubleClick → mouseMoved + mousePressed + mouseReleased
 * - setText/typeText → click to focus, optional select-all+delete (setText),
 *                      then Input.insertText
 * - keypress → optional mouseMoved (when coords present) + rawKeyDown/keyUp
 * - scroll → mouseWheel with deltaX/deltaY
 * - drag → mouseMoved + mousePressed + interpolated mouseMoved + mouseReleased
 * - moveMouse → mouseMoved
 * - wait → setTimeout-based delay (no CDP calls)
 */
export async function executeAction(
  prepared: PreparedAction,
  client: CdpInputClient,
): Promise<void> {
  const { Input } = client;
  switch (prepared.action) {
    case "click":
    case "press":
    case "doubleClick": {
      const { x, y, button, clickCount } = prepared;
      await Input.dispatchMouseEvent({ type: "mouseMoved", x, y });
      await Input.dispatchMouseEvent({ type: "mousePressed", x, y, button, clickCount });
      await Input.dispatchMouseEvent({ type: "mouseReleased", x, y, button, clickCount });
      return;
    }
    case "setText":
    case "typeText": {
      const { x, y, text } = prepared;
      await Input.dispatchMouseEvent({ type: "mouseMoved", x, y });
      await Input.dispatchMouseEvent({
        type: "mousePressed",
        x,
        y,
        button: "left",
        clickCount: 1,
      });
      await Input.dispatchMouseEvent({
        type: "mouseReleased",
        x,
        y,
        button: "left",
        clickCount: 1,
      });
      if (prepared.action === "setText") {
        // Select-all + delete to replace existing content.
        await Input.dispatchKeyEvent({
          type: "rawKeyDown",
          modifiers: 2,
          key: "a",
          code: "KeyA",
          windowsVirtualKeyCode: 65,
        });
        await Input.dispatchKeyEvent({
          type: "keyUp",
          modifiers: 2,
          key: "a",
          code: "KeyA",
          windowsVirtualKeyCode: 65,
        });
        await Input.dispatchKeyEvent({
          type: "rawKeyDown",
          key: "Backspace",
          code: "Backspace",
          windowsVirtualKeyCode: 8,
        });
        await Input.dispatchKeyEvent({
          type: "keyUp",
          key: "Backspace",
          code: "Backspace",
          windowsVirtualKeyCode: 8,
        });
      }
      await Input.insertText({ text });
      return;
    }
    case "keypress": {
      if (typeof prepared.x === "number" && typeof prepared.y === "number") {
        await Input.dispatchMouseEvent({ type: "mouseMoved", x: prepared.x, y: prepared.y });
      }
      for (const k of prepared.keys) {
        const info = lookupKey(k);
        await Input.dispatchKeyEvent({
          type: "rawKeyDown",
          key: info.key,
          code: info.code,
          windowsVirtualKeyCode: info.keyCode,
        });
        await Input.dispatchKeyEvent({
          type: "keyUp",
          key: info.key,
          code: info.code,
          windowsVirtualKeyCode: info.keyCode,
        });
      }
      return;
    }
    case "scroll": {
      const { x, y, scrollX, scrollY } = prepared;
      await Input.dispatchMouseEvent({
        type: "mouseWheel",
        x,
        y,
        deltaX: scrollX,
        deltaY: scrollY,
      });
      return;
    }
    case "drag": {
      const pts = prepared.path;
      if (pts.length === 0) return;
      const first = pts[0]!;
      await Input.dispatchMouseEvent({ type: "mouseMoved", x: first.x, y: first.y });
      await Input.dispatchMouseEvent({
        type: "mousePressed",
        x: first.x,
        y: first.y,
        button: "left",
        clickCount: 1,
      });
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i]!;
        await Input.dispatchMouseEvent({ type: "mouseMoved", x: p.x, y: p.y });
      }
      const last = pts[pts.length - 1]!;
      await Input.dispatchMouseEvent({
        type: "mouseReleased",
        x: last.x,
        y: last.y,
        button: "left",
        clickCount: 1,
      });
      return;
    }
    case "moveMouse": {
      await Input.dispatchMouseEvent({ type: "mouseMoved", x: prepared.x, y: prepared.y });
      return;
    }
    case "wait": {
      await new Promise<void>((resolve) => setTimeout(resolve, prepared.ms));
      return;
    }
  }
}
