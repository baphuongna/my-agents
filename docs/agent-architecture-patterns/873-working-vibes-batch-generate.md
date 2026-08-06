# Hướng AGO: Working Vibes Batch Generate — loading message AI-generated theo theme, 2 mode generate (per-prompt) hoặc file (pre-generate batch + shuffle seed deterministic)

> **Nguồn gốc:** pi-powerline-footer | **Coupling:** 🔴 — gọi model để gen text | **Agent-agnostic:** ⚠️ (cần provider/model) | **Code sẵn:** ❌ (mya KHÔNG có AI-generated loading message layer) | **Effort:** 1 tuần

## Nguồn gốc

**pi-powerline-footer** hiển thị "working vibes" — loading message tùy theme (ví dụ theme "cyberpunk" → câu鼓舞 kiểu neon, theme "zen" → câu tĩnh tại). Có hai mode: (1) **generate mode** — gọi model **per-prompt** mỗi lần (tránh lặp qua `recentVibes` bằng cách exclude recent), (2) **file mode** — **pre-generate batch** trước, **shuffle với seed deterministic** rồi duyệt tuần tự (reproducible, rẻ, không gọi model mỗi lần). Seed deterministic đảm bảo cùng theme → cùng thứ tự message.

Nguyên tắc: **themed copy** (giọng văn theo theme); **tránh lặp** (exclude recentVibes hoặc pre-gen + shuffle); **seed deterministic** cho reproducibility; **trade-off per-call vs batch** (chi phí model vs ấm áp).

## Mô tả

Với mya, loading message hiện tại tĩnh (spinner + "thinking..."). mya **chưa có** layer "working vibes": generate copy theo theme qua model, hoặc pre-generate batch + deterministic shuffle. Pattern này thuần thẩm mỹ/nhân hóa nhưng teaching value nằm ở: (1) **deterministic shuffle** (seed → cùng thứ tự, testable), (2) **recentVibes exclude** (tránh lặp), (3) **batch vs per-call cost trade-off**.

## Kiến trúc (ASCII)

```
  THEME = "cyberpunk"
        │
        ├─ mode GENERATE ─► model(prompt, exclude=recentVibes) → 1 vibe/call
        │                    (không lặp recent, mỗi lần gọi model)
        │
        └─ mode FILE ─► pre-generate batch [v1..vN]
                          → shuffle(seed=hash(theme)) deterministic
                          → duyệt tuần tự (rẻ, reproducible)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/ai/src/openai.ts — gọi model (cần thiết cho generate mode)
// ✅ packages/agent/src/sdk.ts — prompt/stream interface
// ❌ KHÔNG có working-vibes layer (themed loading message)
// ❌ KHÔNG có recentVibes exclude + deterministic shuffle batch
```

## Implementation

```typescript
// packages/print/src/working-vibes.ts (NEW)
import { createHash } from "node:crypto";

export class WorkingVibes {
  private queue: string[] = [];
  private recent: string[] = [];
  constructor(
    private readonly generate: (prompt: string, exclude: string[]) => Promise<string>,
    private readonly maxRecent = 12,
  ) {}

  /** Mode FILE: pre-generate batch, shuffle deterministic theo seed=hash(theme). */
  prime(theme: string, batch: string[]): void {
    const seed = parseInt(createHash("md5").update(theme).digest("hex").slice(0, 8), 16);
    this.queue = deterministicShuffle(batch, seed);
  }

  /** Mode GENERATE: gọi model per-prompt, exclude recentVibes. */
  async nextGenerated(theme: string): Promise<string> {
    const vibe = await this.generate(`Write a short ${theme} loading message`, this.recent);
    this.remember(vibe);
    return vibe;
  }

  /** Mode FILE: lấy tuần tự từ queue đã shuffle. */
  nextFromBatch(): string | undefined {
    const v = this.queue.shift();
    if (v) this.remember(v);
    return v;
  }

  private remember(v: string): void {
    this.recent.push(v);
    if (this.recent.length > this.maxRecent) this.recent.shift();
  }
}

function deterministicShuffle<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;            // LCG deterministic
    const j = s % (i + 1);
    [out[i]!, out[j]!] = [out[j]!, out[i]!];
  }
  return out;
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Loading message ấm, theo theme | ❌ Generate mode tốn model call mỗi lần |
| ✅ Deterministic shuffle → reproducible/testable | ❌ Batch tĩnh → hết queue phải re-gen |
| ✅ Exclude recentVibes → không lặp | ❌ Coupling model (🔴) cho tính năng thẩm mỹ |

## Khác các hướng gần

| | AGO Working Vibes | AGL Render Coalescer | AGX Live-Preview UI |
|---|---|---|---|
| Trọng tâm | Nhân hóa loading message | Gộp vẽ thành 1 frame | Preview setting thật |
| Cơ chế | Model gen + deterministic shuffle | 1 timer + editor-defer | Interval rebuild spinner |
| Quan hệ | Nối UX copy | Nối render loop | Nối settings UI |

## Khi nào chọn

- Muốn loading message ấm, theo theme, không lặp
- Cần deterministic (cùng theme → cùng thứ tự) cho test
- Chấp nhận trade-off: batch (rẻ, tĩnh) vs per-call (đắt, tươi)
- Guard: seed deterministic, exclude recentVibes, batch fallback khi model fail
