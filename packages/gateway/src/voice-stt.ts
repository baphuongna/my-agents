/**
 * @my-agent/gateway/voice-stt — Real-time Speech-to-Text (M-5).
 *
 * Dual-backend STT: local Whisper.cpp (via CLI) or cloud Deepgram (WebSocket).
 * Accepts mulaw 8kHz audio (Twilio Media Streams format) and yields text.
 *
 * Config: STT_BACKEND=whisper|deepgram, DEEPGRAM_API_KEY, WHISPER_MODEL_PATH
 */
import { execFile } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { WebSocket } from "ws";
import { nowWallclock } from "@my-agent/core";

const execFileAsync = promisify(execFile);

export interface SttResult {
  text: string;
  isFinal: boolean;
  confidence: number;
}

/** Injectable whisper runner — defaults to whisper-cli subprocess. */
export type WhisperRunner = (wav: Buffer) => Promise<string>;

/** Minimal WebSocket-like interface for Deepgram streaming. */
export interface SttWebSocket {
  readonly readyState: number;
  on(event: "open", listener: () => void): unknown;
  on(event: "message", listener: (data: Buffer) => void): unknown;
  on(event: "close", listener: () => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
  once(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
  send(data: Buffer | string): void;
  close(): void;
}

/** Injectable WebSocket factory for Deepgram. */
export type SttSocketFactory = (url: string, headers: Record<string, string>) => SttWebSocket;

export interface VoiceSttOpts {
  backend: "whisper" | "deepgram";
  deepgramKey?: string;
  /** Override whisper runner (for testing). */
  runWhisper?: WhisperRunner;
  /** Override WebSocket factory (for testing). */
  createSocket?: SttSocketFactory;
}

// ---------------------------------------------------------------------------
// μ-law decode table (ITU-T G.711)
// ---------------------------------------------------------------------------

/** Build 256-entry μ-law → 16-bit PCM lookup table. */
function buildMulawTable(): Int16Array {
  const table = new Int16Array(256);
  for (let i = 0; i < 256; i++) {
    const b = ~i & 0xff; // complement bits (telephony convention)
    const sign = b & 0x80;
    const exponent = (b >> 4) & 0x07;
    const mantissa = b & 0x0f;
    let sample = ((mantissa << 3) + 0x84) << exponent;
    sample -= 0x84;
    if (sign !== 0) sample = -sample;
    table[i] = sample;
  }
  return table;
}

const MULAW_TABLE = buildMulawTable();

/** Resample Int16 PCM via linear interpolation. */
function resampleLinear(pcm: Int16Array, inRate: number, outRate: number): Int16Array {
  if (inRate === outRate) return pcm;
  const ratio = outRate / inRate;
  const outLen = Math.floor(pcm.length * ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i / ratio;
    const idx0 = Math.floor(srcIdx);
    const idx1 = Math.min(idx0 + 1, pcm.length - 1);
    const frac = srcIdx - idx0;
    const s0 = pcm[idx0] ?? 0;
    const s1 = pcm[idx1] ?? 0;
    out[i] = Math.round(s0 + (s1 - s0) * frac);
  }
  return out;
}

/** Write a standard 44-byte WAV header + PCM data. */
function writeWavHeader(pcm: Buffer, sampleRate: number, numChannels: number, bitsPerSample: number): Buffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // audio format = PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Convert mulaw 8kHz audio → WAV at target rate (16kHz PCM for Whisper). */
export function mulawToWav(mulaw: Buffer, inRate: number, outRate: number): Buffer {
  const pcm = new Int16Array(mulaw.length);
  for (let i = 0; i < mulaw.length; i++) {
    pcm[i] = MULAW_TABLE[mulaw[i]!] ?? 0;
  }
  const resampled = resampleLinear(pcm, inRate, outRate);
  // Int16Array buffer is already little-endian on Node.js platforms.
  const pcmBuffer = Buffer.from(resampled.buffer, resampled.byteOffset, resampled.byteLength);
  return writeWavHeader(pcmBuffer, outRate, 1, 16);
}

// ---------------------------------------------------------------------------
// Default socket factory (wraps ws.WebSocket)
// ---------------------------------------------------------------------------

const defaultSocketFactory: SttSocketFactory = (url, headers): SttWebSocket => {
  return new WebSocket(url, { headers }) as unknown as SttWebSocket;
};

// ---------------------------------------------------------------------------
// VoiceStt
// ---------------------------------------------------------------------------

export class VoiceStt {
  constructor(private readonly opts: VoiceSttOpts) {}

  /** Transcribe an audio stream, yielding results as they become available. */
  async *transcribe(audioStream: AsyncIterable<Buffer>): AsyncGenerator<SttResult> {
    if (this.opts.backend === "whisper") {
      yield* this.whisperTranscribe(audioStream);
    } else {
      yield* this.deepgramTranscribe(audioStream);
    }
  }

  /** Whisper path: accumulate mulaw → WAV → whisper-cli → text. */
  private async *whisperTranscribe(stream: AsyncIterable<Buffer>): AsyncGenerator<SttResult> {
    let buffer: Buffer[] = [];
    let lastFlush = nowWallclock();
    for await (const chunk of stream) {
      buffer.push(chunk);
      // Flush every 2 seconds (low-latency chunking)
      if (nowWallclock() - lastFlush > 2000) {
        const wav = mulawToWav(Buffer.concat(buffer), 8000, 16000);
        const text = await this.runWhisper(wav);
        if (text) yield { text, isFinal: false, confidence: 0.9 };
        buffer = [];
        lastFlush = nowWallclock();
      }
    }
    // Flush remaining audio on stream end
    if (buffer.length > 0) {
      const wav = mulawToWav(Buffer.concat(buffer), 8000, 16000);
      const text = await this.runWhisper(wav);
      if (text) yield { text, isFinal: true, confidence: 0.9 };
    }
  }

  /** Run whisper-cli on a WAV buffer, returning trimmed text. */
  private async runWhisper(wav: Buffer): Promise<string> {
    if (this.opts.runWhisper) return this.opts.runWhisper(wav);
    const modelPath =
      process.env.WHISPER_MODEL_PATH ??
      join(homedir(), ".mya", "models", "whisper", "ggml-base.en.bin");
    const tmp = join(tmpdir(), `mya-stt-${randomBytes(4).toString("hex")}.wav`);
    await writeFile(tmp, wav);
    try {
      const { stdout } = await execFileAsync(
        "whisper-cli",
        ["-m", modelPath, "-f", tmp, "--no-timestamps", "--output-txt", "--output-to-stdout"],
        { timeout: 5000 },
      );
      return stdout.trim();
    } finally {
      await unlink(tmp).catch(() => {});
    }
  }

  /** Deepgram path: stream audio via WebSocket, yield transcripts. */
  private async *deepgramTranscribe(stream: AsyncIterable<Buffer>): AsyncGenerator<SttResult> {
    const factory = this.opts.createSocket ?? defaultSocketFactory;
    const ws = factory(
      "wss://api.deepgram.com/v1/listen?encoding=mulaw&sample_rate=8000",
      { Authorization: `Token ${this.opts.deepgramKey ?? ""}` },
    );

    const queue: SttResult[] = [];
    let done = false;
    const consumers: Array<() => void> = [];

    const notify = (): void => {
      while (consumers.length > 0) {
        const c = consumers.shift();
        if (c) c();
      }
    };

    ws.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as {
          is_final?: boolean;
          channel?: { alternatives?: Array<{ transcript?: string; confidence?: number }> };
        };
        const alt = msg.channel?.alternatives?.[0];
        if (alt?.transcript) {
          queue.push({
            text: alt.transcript,
            isFinal: msg.is_final === true,
            confidence: alt.confidence ?? 0.9,
          });
          notify();
        }
      } catch {
        // Ignore malformed messages
      }
    });
    ws.on("close", () => {
      done = true;
      notify();
    });
    ws.on("error", () => {
      done = true;
      notify();
    });

    // Wait for connection to open (or fail)
    if (ws.readyState !== 1 /* WebSocket.OPEN */) {
      await new Promise<void>((resolve) => {
        ws.once("open", () => resolve());
        ws.once("close", () => resolve());
      });
    }

    // Feed audio to Deepgram concurrently
    void (async () => {
      for await (const chunk of stream) {
        if (ws.readyState !== 1) break; // WebSocket.OPEN
        ws.send(chunk);
      }
      if (ws.readyState === 1) ws.close();
    })();

    // Yield results until the stream closes and queue is drained
    while (!done || queue.length > 0) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => consumers.push(resolve));
      }
      while (queue.length > 0) {
        const r = queue.shift();
        if (r) yield r;
      }
    }
  }
}
