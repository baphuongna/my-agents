/**
 * @my-agent/web — session list component.
 *
 * Renders the event stream for a session. Each event is a card with metadata
 * and a body that summarizes the event content.
 */

export interface SessionListOptions {
  /** Container element ID for the stream. */
  containerId?: string;
}

/** Returns HTML for the session list container. */
export function sessionListHtml(opts: SessionListOptions = {}): string {
  const id = opts.containerId ?? "stream";
  return `<div id="${id}"></div>`;
}

/** Client-side: render an event into the stream container. */
export function renderEventToStream(
  env: { seq: number; event?: Record<string, unknown> },
  container: HTMLElement
): void {
  const e = env.event ?? {};
  const div = document.createElement("div");
  div.className = "ev " + (e.kind ?? "");
  
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = "#" + env.seq + " " + (e.kind ?? "");
  div.appendChild(meta);
  
  const body = document.createElement("div");
  body.textContent = summarizeEvent(e);
  div.appendChild(body);
  
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

/** Summarize a RuntimeEvent for display. */
export function summarizeEvent(e: Record<string, unknown>): string {
  const kind = e.kind as string | undefined;
  const inner = e.e as Record<string, unknown> | undefined;
  
  if (kind === "turn" && inner) {
    if (inner.state === "Streaming" && inner.chunk) {
      const chunk = inner.chunk as Record<string, unknown>;
      return (chunk.text as string) ?? "";
    }
    if (inner.state === "ToolExec") return "[tool results]";
    if (inner.state === "Completed") {
      const usage = inner.usage as Record<string, unknown> | undefined;
      return "[completed · in " + ((usage?.input as number) ?? 0) + "/" + ((usage?.output as number) ?? 0) + "]";
    }
    return "[" + inner.state + "]";
  }
  if (kind === "budget") return "budget: $" + ((e.spentUsd as number) ?? 0).toFixed(4);
  return JSON.stringify(e).slice(0, 200);
}

/** Escape HTML special characters. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!
  );
}
