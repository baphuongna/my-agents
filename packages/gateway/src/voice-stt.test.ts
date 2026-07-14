/**
 * @my-agent/gateway/voice-stt.test — Voice STT tests (M-5).
 */
import { describe, it, expect } from "vitest";
import { mulawToWav, VoiceStt, type SttWebSocket } from "./voice-stt.js";

/** Create a mock SttWebSocket that delivers a Deepgram-style response after open. */
function mockDeepgramSocket(responseText: string): SttWebSocket {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  const state = { readyState: 0, scheduled: false };

  const fire = (event: string, ...args: unknown[]): void => {
    for (const fn of handlers[event] ?? []) fn(...args);
  };

  const scheduleEvents = (): void => {
    if (state.scheduled) return;
    state.scheduled = true;
    setTimeout(() => {
      state.readyState = 1; // OPEN
      fire("open");
      const payload = Buffer.from(
        JSON.stringify({
          is_final: true,
          channel: { alternatives: [{ transcript: responseText, confidence: 0.95 }] },
        }),
      );
      fire("message", payload);
      state.readyState = 3; // CLOSED
      fire("close");
    }, 0);
  };

  const attach = (event: string, listener: (...args: unknown[]) => void): void => {
    (handlers[event] ??= []).push(listener);
    if (event === "open" && state.readyState === 0) scheduleEvents();
  };

  const mockWs: SttWebSocket = {
    get readyState(): number {
      return state.readyState;
    },
    on(event, listener) {
      attach(event, listener as (...args: unknown[]) => void);
      return mockWs;
    },
    once(event, listener) {
      attach(event, listener as (...args: unknown[]) => void);
      return mockWs;
    },
    off() {
      return mockWs;
    },
    send() {},
    close() {
      state.readyState = 3;
    },
  };
  return mockWs;
}

describe("mulawToWav (M-5)", () => {
  it("produces a valid WAV header with correct fields", () => {
    // 100 bytes of silence (μ-law 0xFF)
    const mulaw = Buffer.alloc(100, 0xff);
    const wav = mulawToWav(mulaw, 8000, 16000);

    // RIFF header
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    // fmt chunk
    expect(wav.toString("ascii", 12, 16)).toBe("fmt ");
    expect(wav.readUInt16LE(20)).toBe(1); // PCM
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    // Sample rate = 16000 (output rate)
    expect(wav.readUInt32LE(24)).toBe(16000);
    // Bits per sample = 16
    expect(wav.readUInt16LE(34)).toBe(16);
    // data chunk
    expect(wav.toString("ascii", 36, 40)).toBe("data");
    // 100 mulaw samples resampled 2x = 200 samples × 2 bytes = 400 bytes
    expect(wav.readUInt32LE(40)).toBe(400);
  });
});

describe("VoiceStt — Whisper backend (M-5)", () => {
  it("yields transcription from injected whisper runner", async () => {
    const stt = new VoiceStt({
      backend: "whisper",
      runWhisper: async () => "hello world",
    });

    // Feed a small audio chunk
    const audioStream = (async function* () {
      yield Buffer.alloc(50, 0xff);
    })();

    const results: { text: string; isFinal: boolean; confidence: number }[] = [];
    for await (const r of stt.transcribe(audioStream)) {
      results.push(r);
    }

    expect(results).toHaveLength(1);
    expect(results[0]!.text).toBe("hello world");
    expect(results[0]!.isFinal).toBe(true); // flushed on stream end
    expect(results[0]!.confidence).toBe(0.9);
  });

  it("yields nothing for an empty audio stream", async () => {
    const stt = new VoiceStt({
      backend: "whisper",
      runWhisper: async () => "should-not-be-called",
    });

    const results: { text: string }[] = [];
    for await (const r of stt.transcribe((async function* () {
      /* empty */
    })())) {
      results.push(r);
    }

    expect(results).toHaveLength(0);
  });
});

describe("VoiceStt — Deepgram backend (M-5)", () => {
  it("yields transcription from mocked WebSocket", async () => {
    const stt = new VoiceStt({
      backend: "deepgram",
      deepgramKey: "test-key",
      createSocket: () => mockDeepgramSocket("transcribed text from deepgram"),
    });

    const audioStream = (async function* () {
      yield Buffer.alloc(50, 0xff);
    })();

    const results: { text: string; isFinal: boolean }[] = [];
    for await (const r of stt.transcribe(audioStream)) {
      results.push(r);
    }

    expect(results).toHaveLength(1);
    expect(results[0]!.text).toBe("transcribed text from deepgram");
    expect(results[0]!.isFinal).toBe(true);
  });
});
