/**
 * @my-agent/web — approval modal component.
 *
 * Shows an approval request with allow/deny buttons. The modal is shown
 * when a tool execution requires user approval.
 */

import { escapeHtml } from "./session-list.js";

export interface ApprovalModalOptions {
  /** Container element ID for the modal. */
  containerId?: string;
}

/** Returns HTML for the approval modal (initially hidden). */
export function approvalModalHtml(opts: ApprovalModalOptions = {}): string {
  const id = opts.containerId ?? "approval-modal";
  return `<div id="${id}" style="display:none"></div>`;
}

/** Client-side: show the approval modal with tool call details. */
export function showApprovalModal(
  e: { call?: Record<string, unknown> },
  container: HTMLElement
): void {
  container.style.display = "block";
  container.innerHTML =
    "<strong>approval</strong><br>" +
    escapeHtml(JSON.stringify(e.call ?? {})) +
    "<br><br>" +
    `<button onclick="this.parentNode.style.display='none'">allow</button> ` +
    `<button class="deny" onclick="this.parentNode.style.display='none'">deny</button>`;
}
