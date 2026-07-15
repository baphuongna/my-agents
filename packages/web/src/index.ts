/**
 * @my-agent/web — minimal web dashboard SPA (§25.2).
 *
 * The gateway (§25.2) serves a session-cookie + CSRF SPA that subscribes to the
 * RuntimeEvent bus over WS with replay-from-cursor. This ships the SPA HTML +
 * the minimal client JS (no build step — vanilla, ~the §25.6 wire contract).
 * A full React/Vite SPA layers on top as a UI package.
 *
 * Source: §25.2 Web dashboard; §25.6 UI↔Runtime event contract.
 */

// Re-export dashboard function from the new module
export { dashboardHtml } from "./dashboard.js";
export type { DashboardOptions } from "./dashboard.js";

// Re-export components for direct usage
export { sessionListHtml, renderEventToStream, summarizeEvent, escapeHtml } from "./components/session-list.js";
export type { SessionListOptions } from "./components/session-list.js";

export { approvalModalHtml, showApprovalModal } from "./components/approval-modal.js";
export type { ApprovalModalOptions } from "./components/approval-modal.js";

export { createPromptBar } from "./components/prompt-bar.js";
export type { PromptBarOptions } from "./components/prompt-bar.js";

// H-5 fix: PWA modules (Phase C / Gap 7)
export { registerServiceWorker } from "./pwa-register.js";
export { subscribeToPush, unsubscribeFromPush, getPushState, getVapidKey } from "./push-subscription.js";
export type { PushSubscriptionState } from "./push-subscription.js";
export { renderMobileNav, initMobileNav, isMobile } from "./mobile-nav.js";
export type { MobileNavOptions } from "./mobile-nav.js";
export * from "./transport.js";
