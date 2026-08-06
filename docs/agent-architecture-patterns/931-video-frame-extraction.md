# Hướng AIU: Video Frame Extraction — YouTube/local video: transcript + visual description + frame extraction tại timestamp chính xác dùng ffmpeg/yt-dlp (optional binaries, degrade gracefully)

> **Nguồn gốc:** pi-web-access | **Coupling:** 🟡 — thêm video capability cho web tool | **Agent-agnostic:** ⚠️ (cần ffmpeg/yt-dlp binary) | **Code sẵn:** ⚠️ (có video-gen; chưa có extract local video) | **Effort:** 2 tuần

## Nguồn gốc

**pi-web-access** xử lý **YouTube/local video**: **transcript** (lời nói) + **visual description** + **frame extraction tại timestamp chính xác** dùng **ffmpeg/yt-dlp** — các binary **optional**, **degrade gracefully khi thiếu**. Mục tiêu: **video trở thành context có cấu trúc cho agent** — không phải blob không đọc được, mà là transcript (văn bản) + mô tả hình ảnh + frame tại điểm quan trọng (agent xem được hình qua vision model hoặc mô tả).

Nguyên tắc: **video phải được chuyển thành nhiều modality có cấu trúc** (transcript + frames + description) chứ không phải file nhị phân; **binary bên ngoài là optional** — thiếu ffmpeg/yt-dlp thì degrade (chỉ transcript qua API, hoặc báo rõ không extract được); **frame tại timestamp chính xác** — agent chỉ định thời điểm, không phải lấy frame bừa.

## Mô tả

Với mya, pattern = **video extract tool**: (1) **tool `video_extract` mới** trong packages/tools (cạnh `video_gen` có sẵn — gen là Replicate/Runway tạo video, extract là phân tích video có sẵn); (2) **nhận URL YouTube hoặc local path** → yt-dlp download (YouTube) hoặc dùng thẳng (local); (3) **transcript** — yt-dlp `--write-auto-sub` hoặc API transcript; (4) **frame extraction** — ffmpeg `-ss <timestamp> -frames:v 1` tại timestamp agent chọn; (5) **visual description** — frame đưa vào vision-capable provider (nối packages/ai model routing — model có vision) hoặc bỏ qua nếu không có; (6) **degrade gracefully** — không có ffmpeg → chỉ transcript; không có yt-dlp → chỉ local file; báo rõ capability nào thiếu. Nối `packages/core` (ToolResult typed) + budget (frame count giới hạn).

## Kiến trúc (ASCII)

```
  INPUT: YouTube URL | local path
    │
    ▼ RESOLVE (yt-dlp — optional)
    ├─ YouTube ──► download (yt-dlp) ──► local file
    └─ local ──► dùng thẳng
    │
    ▼ EXTRACT (ffmpeg — optional)
    ├─ TRANSCRIPT  (yt-dlp auto-sub / API)     ──► text (luôn có nếu được)
    ├─ FRAMES      (ffmpeg -ss TS -frames:v 1) ──► images tại timestamp
    │    └─ agent chọn timestamp chính xác
    └─ DESCRIPTION (vision provider — optional)──► mô tả từng frame
    │
    ▼ CONTEXT CÓ CẤU TRÚC (transcript + frames + mô tả)
  DEGRADE: thiếu yt-dlp ──► local only; thiếu ffmpeg ──► transcript only
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools video-gen.ts — video_generate (Replicate/Runway, async polling)
//   (gen có sẵn — extract là hướng ngược: phân tích video có sẵn)
// ✅ packages/ai model-routing.ts — tier routing (nền chọn vision model)
// ✅ packages/tools web/fetch.ts — truncation + security guard (nền output)
// ✅ packages/core types.ts — ToolResult typed (ok/error rõ)
// ✅ packages/tools image-gen.ts — image generation (vision-adjacent)

// ❌ THIẾU: video_extract tool (transcript + frame + description)
// ❌ THIẾU: ffmpeg/yt-dlp wrapper với capability detection
// ❌ THIẾU: frame-at-timestamp API + vision description loop
```

## Implementation

```typescript
// packages/tools/src/video-extract.ts (NEW)
import { execFileSync, execFile } from "node:child_process";
import { existsSync } from "node:fs";

/** Capability detection — binary optional, degrade rõ ràng. */
export function videoCapabilities(): { ytDlp: boolean; ffmpeg: boolean } {
  const has = (bin: string) => {
    try { execFileSync(bin, ["--version"], { stdio: "ignore" }); return true; }
    catch { return false; }
  };
  return { ytDlp: has("yt-dlp"), ffmpeg: has("ffmpeg") };
}

/** Extract transcript + frames tại timestamp. Degrade từng lớp. */
export async function extractVideo(
  input: string, // YouTube URL | local path
  framesAt: number[],   // timestamps (giây) agent chọn
  opts: { describe?: (imagePath: string) => Promise<string> } = {},
): Promise<{ transcript: string; frames: Array<{ at: number; path: string; description?: string }>; degraded: string[] }> {
  const cap = videoCapabilities();
  const degraded: string[] = [];
  let file = input;
  if (/youtube\.com|youtu\.be/.test(input)) {
    if (!cap.ytDlp) { degraded.push("yt-dlp missing — YouTube unavailable"); return { transcript: "", frames: [], degraded }; }
    file = await downloadWithYtDlp(input);   // temp file
  }
  let transcript = "";
  if (cap.ytDlp) {
    transcript = await fetchTranscript(file).catch(() => { degraded.push("transcript failed"); return ""; });
  } else degraded.push("ffmpeg missing — no frames");
  const frames = [];
  if (cap.ffmpeg) {
    for (const at of framesAt) {
      const path = extractFrame(file, at);
      if (path) frames.push({ at, path, ...(opts.describe ? { description: await opts.describe(path).catch(() => undefined) } : {}) });
    }
  }
  return { transcript, frames, degraded };
}
// registerWebTools: thêm video_extract tool — trả transcript + frames + degraded list.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Video thành context có cấu trúc (transcript + frames) | ❌ Phụ thuộc binary bên ngoài (ffmpeg/yt-dlp) |
| ✅ Frame tại timestamp chính xác — agent chọn điểm quan trọng | ❌ Download video tốn disk + bandwidth |
| ✅ Degrade graceful — thiếu binary vẫn có transcript | ❌ Vision description tốn token + cần model vision |
| ✅ Nối video_gen (tạo) — extract (phân tích) đủ cặp | ❌ Bản quyền/ToS — download phải tôn trọng |

## Khác các hướng gần

| | AIU Video Extraction | AIT RSC Extraction | AIW Readability Pipeline |
|---|---|---|---|
| Trọng tâm | Video → transcript + frames | RSC payload → content | HTML → markdown |
| Cơ chế | ffmpeg/yt-dlp + vision | Parse JSON chunks | Readability + Turndown |
| Quan hệ | Đa phương tiện | Web hiện đại | Web tổng quát |

## Khi nào chọn

- Agent cần hiểu nội dung video (transcript) + hình ảnh (frames) — không chỉ metadata
- Máy có ffmpeg/yt-dlp (hoặc chấp nhận degrade transcript-only)
- Đã có web toolchain + image-gen — thêm extract để đủ đa phương tiện
- Guard: capability detection đầu vào, frame count giới hạn, degrade báo rõ