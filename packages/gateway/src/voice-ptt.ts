/**
 * @my-agent/gateway — Voice push-to-talk controller.
 * G1a: records audio → transcribes → agent turn → TTS response.
 * Uses existing voice-stt.ts (Whisper/Deepgram) + tts package.
 * Source: §21 Voice, PLAN-FEATURES G1a.
 */
import { nowWallclock } from "@my-agent/core";

export interface VoicePTTResult {
  transcript: string;
  response: string;
  durationMs: number;
}

export interface VoicePTTOptions {
  sttBackend?: "whisper" | "deepgram" | "browser";
  language?: string;
}

/** State machine for push-to-talk. */
export type VoicePTTState = "idle" | "listening" | "transcribing" | "thinking" | "speaking";

/**
 * VoicePTTController — manages the push-to-talk lifecycle.
 * The actual audio capture is platform-specific (CLI: node-record-lpcm16,
 * web: MediaRecorder API). This controller orchestrates the flow.
 */
export class VoicePTTController {
  private state: VoicePTTState = "idle";
  private startTime = 0;
  private audioChunks: Buffer[] = [];

  getState(): VoicePTTState { return this.state; }

  /** Start recording audio. */
  startRecording(): void {
    this.state = "listening";
    this.startTime = nowWallclock();
    this.audioChunks = [];
  }

  /** Feed an audio chunk (from mic capture). */
  feedChunk(chunk: Buffer): void {
    if (this.state === "listening") this.audioChunks.push(chunk);
  }

  /** Stop recording and get the audio buffer. */
  stopRecording(): { audio: Buffer; durationMs: number } {
    const durationMs = nowWallclock() - this.startTime;
    const audio = Buffer.concat(this.audioChunks);
    this.state = "transcribing";
    return { audio, durationMs };
  }

  /** Transition to thinking state. */
  setThinking(): void { this.state = "thinking"; }

  /** Transition to speaking state. */
  setSpeaking(): void { this.state = "speaking"; }

  /** Reset to idle. */
  reset(): void {
    this.state = "idle";
    this.audioChunks = [];
  }

  /**
   * Full push-to-talk cycle. Takes an audio buffer, transcribes it,
   * runs an agent turn (via provided handler), and returns the result.
   *
   * NOTE: the transcription + agent handler are injected — this controller
   * does NOT import the STT/agent packages directly (layering).
   */
  static async runCycle(
    audio: Buffer,
    handlers: {
      transcribe: (audio: Buffer) => Promise<string>;
      agentTurn: (text: string) => Promise<string>;
    },
  ): Promise<VoicePTTResult> {
    const start = nowWallclock();
    const transcript = await handlers.transcribe(audio);
    const response = await handlers.agentTurn(transcript);
    return {
      transcript,
      response,
      durationMs: nowWallclock() - start,
    };
  }
}

/** Typed voice events for the gateway WS broadcast. */
export type VoiceEvent =
  | { kind: "voice"; phase: "listening"; ts: number }
  | { kind: "voice"; phase: "transcribing"; ts: number }
  | { kind: "voice"; phase: "thinking"; ts: number }
  | { kind: "voice"; phase: "speaking"; text: string; ts: number };
