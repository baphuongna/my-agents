# Hướng AFC: Memory Content-Injection Scanner — mọi memory write qua scanner chống prompt injection, secret patterns, invisible unicode

> **Nguồn gốc:** pi-hermes-memory | **Coupling:** 🟡 — đụng memory write path (an toàn là bắt buộc) | **Agent-agnostic:** ✅ | **Code sẵn:** ✅ (sẵn threat-scan + inject; thiếu memory-write gate) | **Effort:** 1 tuần

## Nguồn gốc

**pi-hermes-memory** (src/store/content-scanner.ts): **mọi memory write phải qua content-scanner** chặn: (1) **prompt injection** — `ignore previous instructions`, `role hijack` (you are now…), `exfil` (curl/cat .env, gửi dữ liệu ra ngoài); (2) **secret patterns** — API keys, tokens, SSH keys (memory không được lưu secret thô); (3) **invisible unicode** — ký tự ẩn (zero-width…) dùng giấu payload. Mục đích: **chống memory poisoning trước khi lưu** — memory bị nhiễm độc sẽ quay lại ám ảnh mọi recall sau này (recall → context → prompt — poison lan qua từng turn).

Giá trị: (1) **chặn tại cửa** — poison không bao giờ vào kho (không cần cleanup muộn); (2) **bảo vệ recall** — mọi recall đọc từ kho đã sạch — không cần scan lại mỗi lần đọc (scan-on-write rẻ hơn scan-on-read); (3) **chống secret leak** — memory tool lỡ ghi API key → bị chặn, không nằm lại đĩa; (4) **bổ sung ragfs** — mya `ragfs.ts` scan-on-read (R25-18) — AFC là scan-on-write — hai lớp bù nhau.

## Mô tả

Với mya, pattern = **write-gate scanner trên memory store**: (1) mya đã có **`core/threat-scan.ts`** — 3-tier scope (all/context/strict), invisible unicode strip + NFKC, pattern injection + hardcoded secret ("strict" scope có `api_key|token|secret = "…20+ chars"`); và **`prompts/inject.ts`** — scanInject context; (2) pattern thêm **write gate** — mọi `remember`/auto-capture/consolidation write → chạy `scanForThreats(content, "strict")` trước khi persist (strict vì memory là nơi lưu lâu — nguy cơ cao nhất); (3) **policy** — match injection → **block write** (fail-loud — trả lỗi cho tool gọi); match secret → block hoặc **redact rồi lưu** (nối `core/redact.ts` — đã có secret redaction engine — maskSecret) tùy policy; (4) **write paths đều qua gate** — memory store (`sqlite-store.ts`), auto-capture (`auto-capture.ts`), consolidation (dream-cycle/brain-store) — một hàm gate dùng chung; (5) **nối ragfs** — read vẫn scan-on-read (R25-18) — write gate + read gate = defense-in-depth. Đây là pattern **poison-proof storage**: dữ liệu vào kho phải sạch — không dựa vào may mắn lúc recall.

## Kiến trúc (ASCII)

```
  MEMORY WRITE (mọi đường: remember tool / auto-capture / consolidation)
    │
    ▼ CONTENT SCANNER (core/threat-scan.ts — "strict" scope)
  ├─ prompt injection: ignore previous / role hijack / exfil curl·cat .env
  ├─ secret patterns: api_key|token|secret = "…" (20+ chars)
  └─ invisible unicode: strip + NFKC (đã sẵn trong threat-scan)
    │
    ▼ POLICY
  ├─ injection match ──► BLOCK write (fail-loud — không vào kho)
  ├─ secret match     ──► redact (core/redact.ts) hoặc block
  └─ sạch             ──► persist (sqlite-store / auto-capture / brain)
    │
    ▼ RECALL (ragfs R25-18 scan-on-read — lớp thứ 2)
  (poison không bao giờ vào kho — recall luôn sạch)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core/src/threat-scan.ts — scanForThreats 3-tier + invisible unicode
//   + "strict" scope có hardcoded secret pattern — scanner GẦN đủ
// ✅ packages/core/src/redact.ts — secret redaction engine (maskSecret)
//   (policy redact khi match secret)
// ✅ packages/memory/src/ragfs.ts — scan-on-read (R25-18) — lớp read đã có
// ✅ packages/memory/src/sqlite-store.ts / auto-capture.ts / brain-store.ts
//   (write paths — nơi chèn gate)
// ✅ packages/prompts/src/inject.ts — scanInject (context scan — tái dùng)

// ❌ THIẾU: write gate chung (mọi write qua scanForThreats strict)
// ❌ THIẾU: policy block vs redact (injection block — secret redact)
// ❌ THIẾU: fail-loud trả lỗi cho tool gọi khi block
```

## Implementation

```typescript
// packages/memory/src/content-gate.ts (NEW)
import { scanForThreats } from "@my-agent/core";
import { redactSecrets } from "@my-agent/core";   // redact.ts engine

export type GateVerdict =
  | { allow: true; content: string }               // sạch (hoặc đã redact)
  | { allow: false; reason: string; pattern: string };

/**
 * WRITE GATE: mọi memory write qua đây — chống memory poisoning trước khi lưu.
 * strict scope: memory là nơi lưu lâu — nguy cơ cao nhất.
 */
export function gateMemoryWrite(content: string, opts: { redactSecrets?: boolean } = {}): GateVerdict {
  const result = scanForThreats(content, "strict");

  for (const m of result.matches) {
    // Injection / exfil → BLOCK (không lưu payload độc hại)
    if (m.scope === "strict" || /inject|exfil|hijack|ignore/i.test(m.pattern)) {
      return { allow: false, reason: "prompt-injection blocked", pattern: m.pattern };
    }
    // Secret → redact rồi lưu (nếu policy cho phép)
    if (/secret|api_?key|token/i.test(m.pattern)) {
      if (!opts.redactSecrets) return { allow: false, reason: "secret blocked", pattern: m.pattern };
      return { allow: true, content: redactSecrets(content) };
    }
  }
  return { allow: true, content };
}
// Wire: sqlite-store.remember / auto-capture / brain consolidation →
//       gateMemoryWrite(content) → allow ? persist : fail-loud (lỗi tool)
// Nối ragfs: read vẫn scan-on-read (R25-18) — write + read = defense-in-depth
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Poison không bao giờ vào kho — recall luôn sạch | ❌ Scan mỗi write — chi phí nhỏ nhưng phải đo |
| ✅ Chặn secret lưu đĩa (leak giảm) | ❌ Redact có thể cắt dữ liệu hợp lệ (nhầm secret) |
| ✅ Scan-on-write rẻ hơn scan-on-read mỗi lần | ❌ Policy redact-vs-block cần cấu hình rõ |
| ✅ Threat-scan + redact đã sẵn — thêm gate | ❌ False positive chặn memory hữu ích (tune pattern) |

## Khác các hướng gần

| | AFC Content Scanner | ADQ Rewrite Registry | AEM Inline Escaping |
|---|---|---|---|
| Trọng tâm | Chống memory poisoning | Quyết định rewrite | Chống XSS embed |
| Cơ chế | Scan-on-write + block/redact | 3 đường quyết định | escape `<>&` |
| Quan hệ | Write path (memory) | Khác miền (output) | Khác miền (render) |

## Khi nào chọn

- Memory là nơi lưu lâu — poison lan qua recall từng turn (nguy cơ cao)
- Đã có threat-scan (strict + secret) + redact — thêm write gate
- Muốn chặn tại cửa thay vì cleanup muộn
- Cần defense-in-depth: write gate (AFC) + read gate (ragfs R25-18)