# Hướng IIIIIIII: Voice Agent Pipeline — VAD → STT → LLM → TTS, tối ưu latency dưới 500ms

> **Nguồn gốc:** LiveKit "Voice Agent Architecture: STT, LLM, TTS Pipelines" (4 nguồn latency — streaming pipeline overlap làm giảm latency tổng); Ketch "Voice Agent Pipeline: VAD, STT, LLM & TTS" (ABY — phải dưới 500ms response time); Retell AI "How Real-Time Voice AI Works" (voice agent stream audio out 200-400ms chunks); arXiv 2603.05413 "Building Enterprise Realtime Voice Agents" (measured TTFA 755ms — streaming overlap giảm dưới sequential); Hamming "Voice AI Latency" ("industry consensus: 500ms TTFT hoặc thấp hơn — LLM chiếm ~70% tổng latency"); Cerebrium (500ms global voice agent)
> **Coupling:** 🟡 — chạm layer giao diện âm thanh (input/output) + LLM latency
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (đa phần text pipeline; chưa có VAD/STT/TTS)
> **Effort:** 4-8 tuần

## Nguồn gốc

Voice pipeline: **âm thanh → (VAD phát hiện nói → STT riêng tiếng) → LLM → (TTS đọc ra) — mỗi hop thêm latency; phải *streaming overlap* để total < 500ms** — LiveKit: "streaming pipeline — stages overlap để giảm latency"; Hamming: LLM chiếm ~70%, còn lại STT 60-120ms, TTS overlap; arXiv 2603.05413: streaming overlap — từng bộ stage song song; Reddit AI_Agents: 800-1200ms sequential là "inherited bad". Khác **215 deadline** (budget thời gian chung — HHH áp), **207 spec decode** (giảm LLM latency), **212 quantize-local** (TTS/STT nhiều model local — latency), **event-stream 12** (stream token — nền cho voice). Kết nối: **178 routing** (native model cho voice? STT model), **203/loop** (voice session verlopen), **12 event** (streaming media). Mục tiêu chính: giữ **TTFT ~500ms** và đảm bảo lời thoại không gián đoạn (barge-in).

## Kiến trúc

```
  MIC ──► VAD (phát hiện tiếng nói — chunk 20-50ms)
        │
        ▼
  STT (transcript streaming — ra từng phần hết tiếng / partial)
        │
        ▼
  LLM (context + response streaming — tổi nguồn latency lớn nhất, Hamming)
   · agent pipeline (tool calls, memory…) — như bình thường, chỉ tính deadline
        │
        ▼
  TTS (overlap khi LLM mới tribute — bắt đầu đọc sớm, barge-in hỗ trợ)
        ▼
  SPEAKER
  Latency maintenance: VAD ~20ms + STT ~120ms + LLM (stream token) + TTS ~100-200ms
```

```
mya: chưa có voice — mọi tiep qua text/terminal; thêm STT/TTS khi cần
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 12 event-stream — stream token (nền cho TTS)
// ✅ 203 loop guard / deadline — kiểm soát thời gian (nền cho 500ms)
// ✅ 178 dynamic routing — chọn model STT/LLM phù hợp
// ✅ 215 deadline — trade-off latency — nền

// ❌ THIẾU: VAD (phát hiện tiếng — chunk)
// ❌ THIẾU: STT stream (transcript partial realtime)
// ❌ THIẾU: TTS (voice out + barge-in)
// ❌ THIẾU: giám sat latency per hop (VAD/STT/LLM/TTS — đo <500ms)
```

## Implementation

```typescript
// packages/voice/src/pipe.ts (NEW)
export class VoiceAgent {
  constructor(private stt: STT, private llm: LLM, private tts: TTS) {}
  async run(mic: AudioStream): Promise<void> {
    const vad = new VAD(mic);                     // chunk — phát hiện tiếng
    for await (const seg of vad.speechSegments()) {
      const text = await this.stt.transcribe(seg);          // partial realtime
      const reply = this.llm.streamReply(text);              // stream token
      await this.tts.speak(reply, { bargeIn: true });        // TTS overlap
    }
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Trải nghiệm tự nhiên — như nói chuyện, không gõ | ❌ LLM latency (~70%) — khó xuống <500ms nếu agent phức |
| ✅ Voice tầm xa/tay bận — ứng dụng gọi phone, robot | ❌ Mỗi hop STT/TTS thêm model + chi phí + triển khai |
| ✅ Streaming overlap — TTFA < sequential (arXiv 755ms) | ❌ Conversation context/speak điều — barge-in khó |
| ✅ Dùng lại 203/12/215 — tầng voice lightweight | ❌ STT/TTS chất lượng cần model riêng — phức tạp + chi phí |

## Khác các hướng gần

| | 12 Stream | 215 Deadline | 207 Spec | IIIIIIII: Voice |
|---|---|---|---|---|
| Mục | Stream token | Giới hạn thời gian | Tăng tốc LLM | **Kênh tiếng nói — VAD+STT+LLM+TTS** |
| Nền tảng | Áp dụng | Hỗ trợ | **Bao — dùng cả ba** | |
| Quan hệ | Nền | Nền | Nền | **Thay kênh nhập/xuất text** |

## Khi nào chọn

- Sản phẩm cần gọi thoại (phone bot, trợ lý giọng nói, robot)
- Không thể bàn phím (tay bận, môi trường)
- Không cần: text chat đủ cho mya hiện tại — thêm voice là phức tạp + chi phí