# Hướng NU: Meeting Presence Agents — agent tham dự Meet/Zoom/Teams, transcript + action items

> **Nguồn gốc:** Meeting bots (Otter.ai, Fireflies, tl;dv); real-time transcription (ASR/STT); "action item extraction"; calendar-driven agent; openhuman; conversational agent in-meeting
> **Coupling:** 🟡 — thêm meeting connector + transcript pipeline
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (tts + memory sẵn — chưa có meeting connector + realtime STT)
> **Effort:** 4-6 tuần

## Nguồn gốc

**Meeting bot** (Otter.ai, Fireflies, tl;dv, Noty.ai): bot tham dự meeting (qua meeting SDK / headless browser), **record + transcript** real-time, extract **action items** + decisions, gửi summary sau meeting. **Real-time transcription** (ASR/STT — Whisper, Deepgram): audio → text streaming. **Calendar-driven**: agent đọc calendar → tự join meeting đúng giờ. **Conversational in-meeting**: agent có thể **phát biểu** (TTS) khi được hỏi. Nguyên tắc: agent là **participant** trong meeting — nghe (transcript), hiểu (extract action items), có thể nói (voice). Khác **342 output-quality** (post-process) — NU là **real-time in-meeting**.

## Mô tả

mya meeting presence agent: agent tham dự Google Meet / Zoom / Microsoft Teams (qua headless browser + meeting SDK, hoặc bot API). Pipeline: (1) **calendar trigger** → join đúng giờ, (2) **real-time transcript** (ASR streaming), (3) **extract** action items / decisions / owners, (4) **post-meeting summary** → memory + notify. Tùy chọn: agent **voice** (TTS phát biểu khi được @mention). mya có `packages/tts` (voice out) + `packages/memory` (lưu summary) — NU thêm meeting connector + realtime STT pipeline.

## Kiến trúc

```
   CALENDAR (Google Calendar)
        │ event: "Standup 10:00"
        ▼
   ┌── MEETING CONNECTOR ────────────────────────────┐
   │  · join Meet/Zoom/Teams (headless browser/bot)  │
   │  · capture audio stream                          │
   └──────┬───────────────────────────────────────────┘
          ▼ audio stream
   ┌── REALTIME TRANSCRIPT (ASR/STT) ────────────────┐
   │  · streaming Whisper / Deepgram                 │
   │  · speaker diarization (ai nói gì)              │
   │  · transcript → segments [{speaker, text, ts}]  │
   └──────┬───────────────────────────────────────────┘
          ▼
   ┌── AGENT (realtime analysis) ────────────────────┐
   │  · extract action items: {task, owner, due}     │
   │  · extract decisions                            │
   │  · @mention → voice reply (TTS) [optional]      │
   └──────┬───────────────────────────────────────────┘
          ▼ meeting end
   POST-MEETING: summary → memory + notify owners
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tts — voice out (nền — NU voice reply)
// ✅ packages/memory — store summary/action items (nền)
// ✅ packages/cron — calendar-triggered join (nền)
// ✅ 384 daemon — always-on để sẵn sàng join (nền)

// ❌ THIẾU: meeting connector (Meet/Zoom/Teams SDK + headless join)
// ❌ THIẾU: realtime STT pipeline (streaming transcript + diarization)
// ❌ THIẾU: action item extraction (NLP/LLM)
// ❌ THIẾU: speaker diarization (ai nói gì)
```

## Implementation

```typescript
// packages/agent/src/meeting-presence.ts (MỚI)
interface TranscriptSegment {
  speaker: string;
  text: string;
  startMs: number;
}

interface ActionItem {
  task: string;
  owner?: string;
  due?: string;
}

class MeetingPresenceAgent {
  constructor(private stt: STTEngine, private tts: TTSEngine, private memory: MemoryStore) {}

  // Join meeting → transcript → extract → summary
  async attend(meetingUrl: string): Promise<MeetingSummary> {
    const audio = await this.joinMeeting(meetingUrl); // headless browser / bot API
    const transcript: TranscriptSegment[] = [];

    // Realtime transcript (streaming)
    for await (const segment of this.stt.transcribeStream(audio)) {
      transcript.push(segment);
      // Optional: @mention → voice reply
      if (this.isMentioned(segment)) {
        await this.tts.speak(await this.generateReply(segment));
      }
    }

    // Post-meeting: extract + summarize
    const actionItems = await this.extractActionItems(transcript);
    const summary: MeetingSummary = {
      transcript,
      actionItems,
      decisions: await this.extractDecisions(transcript),
      endedAt: Date.now(),
    };
    await this.memory.store(summary); // + notify owners
    return summary;
  }

  private async extractActionItems(t: TranscriptSegment[]): Promise<ActionItem[]> {
    // LLM: "extract action items with owner + due"
    return await llm.extract(t, ActionItemSchema);
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Tự động capture meeting (không note thủ công) | ❌ Meeting SDK phức tạp (Meet/Zoom/Teams khác) |
| ✅ Action items + decisions extracted | ❌ STT realtime expensive + latency |
| ✅ Voice reply (agent tham gia active) | ❌ Speaker diarization khó (ai nói gì) |
| ✅ Summary → memory (searchable) | ❌ Privacy (record meeting — cần consent) |

## Khác các hướng gần

| | packages/tts | 342 Output Quality | 343 Relevance | NU: Meeting Presence |
|---|---|---|---|---|
| Cái gì | Voice out | Post-process output | Score relevance | **Tham dự meeting realtime** |
| Realtime | ❌ | ❌ | ❌ | ✅ in-meeting |
| Transcript | ❌ | ❌ | ❌ | ✅ STT |
| Voice | ✅ out | ❌ | ❌ | ✅ in/out |

## Khi nào chọn

- Cần capture meeting tự động (action items, decisions, summary)
- Muốn agent tham gia active (voice reply)
- Có meeting SDK / bot API (Meet/Zoom/Teams)
- Kết hợp packages/tts (voice) + packages/memory (summary) + packages/cron (calendar trigger); thêm meeting connector + realtime STT; guard privacy (consent record) — xét 386 privacy-mode
