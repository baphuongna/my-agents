// packages/intercom/src/index.ts

/**
 * @my-agent/intercom — pi-intercom extension factory for the mya platform.
 *
 * Default export: an ExtensionFactory function `(pi: ExtensionAPI) => void`
 * that registers the intercom tool, UI overlays, broker client, and skills.
 *
 * Registered as the SECOND extension alongside mya-bridge in PiInProcessRuntime.
 *
 * IC3 decision: No MYA_BROKER_SOCKET. The broker self-manages via
 * PI_CODING_AGENT_DIR (set to ~/.mya/agent by mya). Runtime files live at
 * $PI_CODING_AGENT_DIR/intercom/ (broker.sock, broker.pid, config.json, etc.).
 */

// The actual extension entry point
export { default } from "./intercom.js";

// Re-export public types for consumers (Phase 4, Phase 11)
export type {
  SessionInfo,
  Message,
  Attachment,
  MessageReceiptStatus,
  MessageReceipt,
  MessageControl,
  ExtensionCapability,
  SessionRegistration,
  ClientMessage,
  BrokerMessage,
} from "./types.js";

export type { IntercomConfig, InboundTriggerPolicy } from "./config.js";
export type { IntercomExtensionChannel, IntercomExtensionRegistration } from "./extension-api.js";

// Re-export the IntercomClient class for Phase 11 (inter-agent messaging)
export { IntercomClient } from "./broker/client.js";
