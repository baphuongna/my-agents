/**
 * @my-agent/channels — lifecycle hooks.
 *
 * Provides hook functions for registering and wiring channel adapters into
 * the host application. These hooks are called by the host (e.g. the gateway
 * or desktop companion) at boot to set up messaging channels.
 *
 * The hook pattern is consistent with other frontier modules
 * (`registerMlxBackend` in tts, etc.): a module-level registry that the host
 * populates, with test-reset support.
 */
import {
  ChannelRegistry,
  ChannelRouter,
  type ChannelAdapter,
  type ChannelMessage,
  type ChannelType,
  type SendResult,
} from "./index.js";

let registry: ChannelRegistry | null = null;
let router: ChannelRouter | null = null;

/**
 * Initialize (or get) the global channel registry + router. Called once at
 * boot by the host. Subsequent calls return the existing instance.
 */
export function getChannelRegistry(): ChannelRegistry {
  if (!registry) {
    registry = new ChannelRegistry();
    router = new ChannelRouter(registry);
  }
  return registry;
}

/** Get the global channel router (initialized via {@link getChannelRegistry}). */
export function getChannelRouter(): ChannelRouter | null {
  if (!router) getChannelRegistry();
  return router;
}

/**
 * Register a channel adapter into the global registry. Convenience wrapper
 * around `getChannelRegistry().register(adapter)`.
 */
export function registerChannel(adapter: ChannelAdapter): void {
  getChannelRegistry().register(adapter);
}

/**
 * Boot hook: connect all registered channels. Called by the host after all
 * adapters are registered. Returns when all connections are established
 * (or failed).
 */
export async function connectChannels(): Promise<void> {
  await getChannelRegistry().connectAll();
}

/** Shutdown hook: disconnect all registered channels. */
export async function disconnectChannels(): Promise<void> {
  if (registry) await registry.disconnectAll();
}

/**
 * Convenience: send a message on a specific channel type to a specific chat.
 */
export async function sendChannelMessage(
  type: ChannelType,
  chatId: string,
  text: string,
): Promise<SendResult> {
  const r = getChannelRouter();
  if (!r) return { ok: false, error: "channels: not initialized" };
  return r.send(type, chatId, text);
}

/**
 * Convenience: register a global inbound message handler (receives from all
 * channels).
 */
export function onChannelMessage(
  handler: (msg: ChannelMessage) => Promise<void>,
): void {
  const r = getChannelRouter();
  if (!r) throw new Error("channels: not initialized — call getChannelRegistry() first");
  r.onAny(handler);
}

/**
 * Test hook: reset the global registry + router. Production code MUST NOT
 * call this.
 */
export function __resetChannelsForTests(): void {
  registry = null;
  router = null;
}
