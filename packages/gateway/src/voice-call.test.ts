/**
 * @my-agent/gateway/voice-call.test — Voice call channel tests (Phase E Gap 9).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { VoiceCallChannel } from "./voice-call.js";

describe("VoiceCallChannel", () => {
  it("isConfigured() returns false without credentials", () => {
    const ch = new VoiceCallChannel();
    expect(ch.isConfigured()).toBe(false);
  });

  it("isConfigured() returns true with all credentials", () => {
    const ch = new VoiceCallChannel({
      accountSid: "AC123",
      authToken: "secret",
      fromNumber: "+1234567890",
    });
    expect(ch.isConfigured()).toBe(true);
  });

  it("listActive() returns empty initially", () => {
    const ch = new VoiceCallChannel({ accountSid: "AC", authToken: "x", fromNumber: "+1" });
    expect(ch.listActive()).toHaveLength(0);
  });

  it("placeCall() throws when not configured", async () => {
    const ch = new VoiceCallChannel();
    await expect(ch.placeCall("+999")).rejects.toThrow("not configured");
  });

  it("hangup() removes the call from active list", async () => {
    const ch = new VoiceCallChannel({ accountSid: "AC", authToken: "x", fromNumber: "+1" });
    // Simulate an active call
    (ch as unknown as { calls: Map<string, unknown> }).calls.set("CA123", {
      callSid: "CA123", from: "+1", to: "+2", direction: "inbound", startedAt: 0,
    });
    await ch.hangup("CA123");
    expect(ch.listActive()).toHaveLength(0);
  });

  it("playAudio() is a no-op when call has no WebSocket", async () => {
    const ch = new VoiceCallChannel({ accountSid: "AC", authToken: "x", fromNumber: "+1" });
    await expect(ch.playAudio("CA999", Buffer.from("audio"))).resolves.toBeUndefined();
  });

  it("stop() closes all calls", async () => {
    const ch = new VoiceCallChannel({ accountSid: "AC", authToken: "x", fromNumber: "+1" });
    (ch as unknown as { calls: Map<string, unknown> }).calls.set("CA1", { callSid: "CA1", from: "", to: "", direction: "inbound", startedAt: 0 });
    await ch.stop();
    expect(ch.listActive()).toHaveLength(0);
  });
});
