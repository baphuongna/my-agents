# Hướng UT: Source-Liveness Gate — trước publish verify mọi URL HTTP 200; ghi "N sources liveness lúc distill; M đã chết" vào honest-boundaries

> **Nguồn gốc:** DISTILL-R2 `liveness_gate/` (`check_urls.py`, `honest_boundaries.md`); "verify all URLs HTTP 200 before publish"; "record N sources live at distillation; M dead"; "link rot honesty"; "honest-boundaries artifact" | **Coupling:** 🟢 — thêm URL-liveness checker + honest-boundaries artifact vào publish gate | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (tools fetch sẵn — chưa có batch URL checker + liveness report) | **Effort:** 1-2 tuần

## Nguồn gốc

**DISTILL-R2** skill thường cite nhiều **URL nguồn** (tài liệu, paper, blog). Nhưng **link rot** — URL chết theo thời gian (404, domain expire). Nếu publish skill mà URL chết → **user bấm link hỏng** → mất niềm tin. Giải pháp: **source-liveness gate** — trước publish, **verify mọi URL HTTP 200**; ghi vào **honest-boundaries** artifact: "N sources live lúc distillation; M đã chết" (transparency — user biết có bao nhiêu link sẽ hỏng). Nguyên tắc: **publish chỉ khi live, hoặc disclose dead ratio**. Khác blind-publish — UT **liveness-verified + honest disclosure**.

## Mô tả

mya source-liveness gate: (1) **Extract URLs**: thu thập mọi URL trong skill corpus. (2) **Check**: batch HEAD/GET → HTTP status (200 live / 4xx-5xx dead). (3) **Gate**: publish yêu cầu live ratio (vd > 80%) hoặc disclose dead. (4) **Honest-boundaries**: ghi artifact "N live, M dead" (transparency). mya có tools fetch — UT thêm **batch URL checker** + **liveness gate** + **honest-boundaries report**.

## Kiến trúc

```
  SKILL CORPUS chứa URL nguồn (docs, paper, blog)
   [https://example.com/a, https://blog.dead.io/b, …]
        │ (source-liveness gate — trước publish)
        ▼
  ┌─── URL CHECK (batch HTTP status) ────────────────────┐
  │  example.com/a → 200 LIVE                              │
  │  blog.dead.io/b → 404 DEAD                             │
  │  paper.org/c → 200 LIVE                                │
  └───────────────────────┬─────────────────────────────┘
                          │ (liveness ratio)
                          ▼
  ┌─── GATE (publish decision) ──────────────────────────┐
  │  live: 8/10 (80%) → OK publish                         │
  │  live: 5/10 (50%) → BLOCK hoặc disclose dead           │
  └───────────────────────┬─────────────────────────────┘
                          ▼
  HONEST-BOUNDARIES artifact:
   "N=10 sources liveness lúc distill; M=2 đã chết (link rot)
    → verify lại sau publish, link có thể hỏng tiếp"
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools fetch — HTTP (nền — UT URL check)
// ✅ packages/core time — timestamp (nền — UT liveness-at-time)
// ✅ 066 chaos-engineering — failure inject (nền — UT dead URL sim)

// ❌ THIẾU: batch URL extractor (thu thập URL trong corpus)
// ❌ THIẾU: liveness checker (batch HTTP status)
// ❌ THIẾU: publish gate (live ratio threshold)
// ❌ THIẾU: honest-boundaries artifact (N live / M dead)
```

## Implementation

```typescript
// packages/tools/src/source-liveness-gate.ts (MỚI)
interface UrlStatus { url: string; status: number; live: boolean; checkedAt: number }
interface LivenessReport { total: number; live: number; dead: number; ratio: number; statuses: UrlStatus[]; ts: number }

class SourceLivenessGate {
  constructor(
    private now: () => number,
    private fetchHead: (url: string) => Promise<number>, // HTTP status
    private minRatio: number, // publish threshold (vd 0.8)
  ) {}

  // extract URLs từ corpus
  extractUrls(corpus: string): string[] {
    return [...new Set(corpus.match(/https?:\/\/[^\s)]+/gi) ?? [])];
  }

  // batch check liveness
  async check(urls: string[]): Promise<LivenessReport> {
    const ts = this.now();
    const statuses = await Promise.all(urls.map(async url => {
      try {
        const status = await this.fetchHead(url);
        return { url, status, live: status >= 200 && status < 400, checkedAt: ts };
      } catch {
        return { url, status: 0, live: false, checkedAt: ts }; // network error = dead
      }
    }));
    const live = statuses.filter(s => s.live).length;
    const dead = statuses.length - live;
    return { total: urls.length, live, dead, ratio: live / Math.max(1, urls.length), statuses, ts };
  }

  // gate: publish decision
  canPublish(report: LivenessReport): { ok: boolean; reason: string } {
    if (report.ratio >= this.minRatio) return { ok: true, reason: `live ${(report.ratio * 100).toFixed(0)}%` };
    return { ok: false, reason: `live ratio ${report.ratio.toFixed(2)} < ${this.minRatio}` };
  }

  // honest-boundaries artifact
  toBoundaries(report: LivenessReport): string {
    const deadList = report.statuses.filter(s => !s.live).map(s => `- [DEAD ${s.status}] ${s.url}`).join('\n');
    return `# Honest Boundaries\n\n## Source Liveness\n` +
      `N=${report.total} sources checked at distillation (ts=${report.ts}).\n` +
      `Live: ${report.live} | Dead: ${report.dead} | Ratio: ${report.ratio.toFixed(2)}\n\n` +
      `### Dead sources (link rot — verify lại sau publish)\n${deadList}\n`;
  }
}

// Usage:
// const gate = new SourceLivenessGate(now, fetchHeadFn, 0.8);
// const report = await gate.check(gate.extractUrls(corpus));
// fs.writeFileSync('honest-boundaries.md', gate.toBoundaries(report));
// if (!gate.canPublish(report).ok) → block hoặc disclose
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ No broken link (verify trước publish) | ❌ Check cost (HTTP request mỗi URL) |
| ✅ Honest disclosure (N live / M dead rõ) | ❌ Transient failure (server tạm down → false dead) |
| ✅ Link-rot aware (user biết sẽ hỏng) | ❌ Snapshot staleness (live nay, chết mai) |
| ✅ Publish gate (chặn skill link-hỏng) | ❌ Retry/threshold tuning (timeout hợp lý) |

## Khác các hướng gần

| | 138 Agent-Supply-Chain | 066 Chaos-Eng | UT: Source-Liveness-Gate |
|---|---|---|---|
| Cái gì | Verify dependency | Inject failure | **Verify URL HTTP 200** |
| Object | Package | System | **URL nguồn** |
| Disclose | ⚠️ | ❌ | **honest-boundaries** |

## Khi nào chọn

- Skill cite nhiều URL (docs, paper, blog)
- Muốn no broken link (verify trước publish)
- Cần honest disclosure (link rot transparency)
- Nối packages/tools fetch + packages/core time + 066 chaos-engineering; guard transient-retry (server tạm down ≠ chết, retry), timeout calibration (không quá dài), và periodic re-check (link rot tiếp tục sau publish); UT = source-liveness gate, chạy TRƯỚC publish — sau UQ fidelity-scorecard (corpus chấm xong → check URL → publish)
