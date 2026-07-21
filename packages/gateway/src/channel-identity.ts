/**
 * @my-agent/tools — E2 per-platform identity + rate-limit utilities.
 * Source: §12 Channels, PLAN-FEATURES E2.
 */
import { nowWallclock } from "@my-agent/core";

/** Token bucket rate limiter (per-channel). */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  constructor(
    private readonly capacity: number,
    private readonly refillRatePerSec: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = nowWallclock();
  }

  /** Try to consume 1 token. Returns true if allowed. */
  tryConsume(): boolean {
    this.refill();
    if (this.tokens >= 1) { this.tokens -= 1; return true; }
    return false;
  }

  private refill(): void {
    const now = nowWallclock();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRatePerSec);
    this.lastRefill = now;
  }
}

/** Per-platform rate limiters. */
const rateLimiters = new Map<string, RateLimiter>();

export function getRateLimiter(platform: string): RateLimiter {
  if (!rateLimiters.has(platform)) {
    // Telegram: 30msg/sec global; Discord: 50req/2s; Slack: 1msg/sec/channel
    const limits: Record<string, [number, number]> = {
      telegram: [30, 30],
      discord: [50, 25],
      slack: [5, 1],
      email: [10, 2],
      matrix: [10, 2],
      default: [10, 5],
    };
    const [cap, rate] = limits[platform] ?? limits.default!;
    rateLimiters.set(platform, new RateLimiter(cap, rate));
  }
  return rateLimiters.get(platform)!;
}

/** Sticker/media cache per platform (LRU bounded). */
export class MediaCache {
  private cache = new Map<string, { data: Buffer; ts: number }>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(maxEntries = 100, ttlMs = 30 * 60_000) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  get(key: string): Buffer | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (nowWallclock() - entry.ts > this.ttlMs) { this.cache.delete(key); return null; }
    return entry.data;
  }

  set(key: string, data: Buffer): void {
    if (this.cache.size >= this.maxEntries) {
      const oldest = [...this.cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
      if (oldest) this.cache.delete(oldest[0]);
    }
    this.cache.set(key, { data, ts: nowWallclock() });
  }
}
