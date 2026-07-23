/**
 * Tests for VoicePTTController (voice-ptt.ts) — push-to-talk state machine.
 *
 * The controller orchestrates recording → transcribing → thinking → speaking.
 * The STT/agent handlers are injected, so no external APIs are called.
 */
import { describe, it, expect } from "vitest";
import { VoicePTTController } from "./voice-ptt.js";

describe("VoicePTTController", () => {
  it("starts in the idle state", () => {
    const c = new VoicePTTController();
    expect(c.getState()).toBe("idle");
  });

  it("startRecording() transitions to 'listening'", () => {
    const c = new VoicePTTController();
    c.startRecording();
    expect(c.getState()).toBe("listening");
  });

  it("feedChunk() accumulates audio while listening", () => {
    const c = new VoicePTTController();
    c.startRecording();
    c.feedChunk(Buffer.from("chunk1"));
    c.feedChunk(Buffer.from("chunk2"));
    const { audio } = c.stopRecording();
    expect(audio.toString()).toBe("chunk1chunk2");
  });

  it("feedChunk() is ignored when not listening", () => {
    const c = new VoicePTTController();
    c.feedChunk(Buffer.from("ignored"));
    const { audio } = c.stopRecording();
    expect(audio.length).toBe(0);
  });

  it("stopRecording() transitions to 'transcribing' and returns duration", () => {
    const c = new VoicePTTController();
    c.startRecording();
    const { audio, durationMs } = c.stopRecording();
    expect(c.getState()).toBe("transcribing");
    expect(audio).toBeInstanceOf(Buffer);
    expect(durationMs).toBeTypeOf("number");
  });

  it("setThinking() transitions to 'thinking'", () => {
    const c = new VoicePTTController();
    c.setThinking();
    expect(c.getState()).toBe("thinking");
  });

  it("setSpeaking() transitions to 'speaking'", () => {
    const c = new VoicePTTController();
    c.setSpeaking();
    expect(c.getState()).toBe("speaking");
  });

  it("reset() returns to 'idle' and clears audio", () => {
    const c = new VoicePTTController();
    c.startRecording();
    c.feedChunk(Buffer.from("data"));
    c.reset();
    expect(c.getState()).toBe("idle");
    const { audio } = c.stopRecording();
    expect(audio.length).toBe(0);
  });

  it("runCycle() transcribes then runs the agent turn", async () => {
    const result = await VoicePTTController.runCycle(
      Buffer.from("audio-data"),
      {
        transcribe: async (audio) => `transcribed:${audio.length}`,
        agentTurn: async (text) => `response:${text}`,
      },
    );
    expect(result.transcript).toContain("transcribed:");
    expect(result.response).toContain("response:");
    expect(result.durationMs).toBeTypeOf("number");
  });

  it("runCycle() propagates transcribe errors", async () => {
    await expect(
      VoicePTTController.runCycle(
        Buffer.from(""),
        {
          transcribe: async () => { throw new Error("stt-failed"); },
          agentTurn: async () => "x",
        },
      ),
    ).rejects.toThrow("stt-failed");
  });
});
