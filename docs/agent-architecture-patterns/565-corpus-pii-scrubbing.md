# Hướng US: Corpus PII-Scrubbing — redact PII (phone, email, địa chỉ, ID) thành [REDACTED] như bước tiền-xử-lý bắt buộc

> **Nguồn gốc:** DISTILL-R2 `pii_scrub/` (`scrub.py`, `pii_patterns.json`); "redact PII as mandatory pre-processing"; "phone/email/address/ID → [REDACTED]"; "privacy-safe distillation corpus"; "scrub before store" | **Coupling:** 🟢 — thêm PII-scrubber vào corpus pipeline (scrub bắt buộc trước khi lưu/đóng gói skill) | **Agent-agnostic:** ✅ | **Code sẵn:** ❌ (chưa có PII-scrubber) | **Effort:** 1-2 tuần

## Nguồn gốc

**DISTILL-R2** khi chưng cất skill từ corpus (dialogue, log, transcript) gặp **PII** — thông tin cá nhân (số điện thoại, email, địa chỉ, ID card) nằm rải rác. Nếu để nguyên vào skill → **privacy leak** (skill publish → PII công khai). Giải pháp: **PII-scrubbing bắt buộc** — bước tiền-xử-lý đầu tiên, regex/NER detect PII → replace thành `[REDACTED]` trước khi lưu corpus. Nguyên tắc: **scrub before store** — PII không bao giờ vào artifact. Khác optional redaction — US **mandatory gate** (không scrub → không qua).

## Mô tả

mya corpus PII-scrubbing: (1) **Detect**: regex + NER tìm PII (phone, email, address, ID, credit card). (2) **Redact**: replace → `[REDACTED]` (giữ vị trí, mất giá trị). (3) **Gate**: scrub bắt buộc — corpus chưa scrub → reject (không store). (4) **Report**: log bao nhiêu PII đã redact (audit). mya có secrets + memory — US thêm **PII detector** + **redactor** + **mandatory gate**.

## Kiến trúc

```
  CORPUS (dialogue/log/transcript) chứa PII
   "gọi tôi 0912-345-678, email bom@x.com, ở 123 Lê Lợi"
        │ (PII-scrub — bước đầu tiên, BẮT BUỘC)
        ▼
  ┌─── PII DETECT (regex + NER) ─────────────────────────┐
  │  phone: 0912-345-678   email: bom@x.com               │
  │  address: 123 Lê Lợi   id: 0123456789                  │
  └───────────────────────┬─────────────────────────────┘
                          │ (redact)
                          ▼
  ┌─── REDACT → [REDACTED] ──────────────────────────────┐
  │  "gọi tôi [REDACTED], email [REDACTED], ở [REDACTED]" │
  └───────────────────────┬─────────────────────────────┘
                          │ (gate — chưa scrub = reject)
                          ▼
  STORE / ĐÓNG GÓI skill (PII-safe) — report: 4 PII redacted
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/secrets — secret handling (nền — US detect secret)
// ✅ packages/memory brain-store — corpus store (nền — US gate trước store)
// ✅ 069 agentic-firewall — privacy guard (nền — US PII policy)

// ❌ THIẾU: PII detector (regex + NER: phone/email/address/ID)
// ❌ THIẾU: redactor (replace → [REDACTED])
// ❌ THIẾU: mandatory gate (chưa scrub → reject)
// ❌ THIẾU: redaction report (audit count)
```

## Implementation

```typescript
// packages/secrets/src/pii-scrubber.ts (MỚI)
interface PiiPattern { name: string; regex: RegExp }
interface Redaction { name: string; count: number }

const PATTERNS: PiiPattern[] = [
  { name: 'phone', regex: /(\+?\d[\d\s\-().]{7,}\d)/g },
  { name: 'email', regex: /[\w.+-]+@[\w-]+\.[\w.-]+/g },
  { name: 'id', regex: /\b\d{8,12}\b/g },
  { name: 'credit', regex: /\b(?:\d[ -]*?){13,16}\b/g },
];

class PiiScrubber {
  private extraPatterns: PiiPattern[];
  constructor(extra: PiiPattern[] = []) { this.extraPatterns = [...PATTERNS, ...extra]; }

  // scrub text → redacted (giữ vị trí, mất giá trị)
  scrub(text: string): { clean: string; redactions: Redaction[] } {
    let clean = text;
    const redactions: Redaction[] = [];
    for (const p of this.extraPatterns) {
      const matches = clean.match(p.regex);
      if (matches && matches.length > 0) {
        clean = clean.replace(p.regex, '[REDACTED]');
        redactions.push({ name: p.name, count: matches.length });
      }
    }
    return { clean, redactions };
  }

  // gate: scrub bắt buộc — check corpus chưa scrub
  ensureScrubbed(text: string): { ok: boolean; clean: string } {
    const { clean, redactions } = this.scrub(text);
    // detect residual PII (re-scan clean → nếu còn pattern = chưa sạch)
    const residual = this.extraPatterns.some(p => p.regex.test(clean));
    if (residual) return { ok: false, clean }; // reject — scrub không triệt để
    return { ok: true, clean };
  }

  // report (audit)
  report(text: string): string {
    const { redactions } = this.scrub(text);
    return `PII scrub: ${redactions.map(r => `${r.count} ${r.name}`).join(', ') || 'none'}`;
  }
}

// Usage:
// const scrub = new PiiScrubber([{ name:'address', regex:/\d+\s+[A-Z][\w\s]+/g }]);
// const { ok, clean } = scrub.ensureScrubbed(corpus);
// if (!ok) throw new Error("PII residual — reject"); // mandatory gate
// store(clean); // PII-safe
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Privacy-safe (PII không vào artifact) | ❌ Regex miss (PII format lạ → lọt) |
| ✅ Mandatory gate (chưa scrub = reject) | ❌ False-positive (số hợp lệ bị redact) |
| ✅ Audit (report count) | ❌ NER cost (regex yếu → cần NER model) |
| ✅ Vị trí giữ nguyên ([REDACTED] giữ cấu trúc) | ❌ Re-identification risk (metadata đủ → deanonymize) |

## Khác các hướng gần

| | packages/secrets | 069 Agentic-Firewall | US: Corpus-PII-Scrubbing |
|---|---|---|---|
| Cái gì | Quản secret key | Privacy policy gate | **Scrub PII bắt buộc pre-store** |
| Stage | Runtime | Decision gate | **Pre-processing** |
| Mandatory | ❌ | ⚠️ | **✅ gate reject** |

## Khi nào chọn

- Corpus chứa PII (dialogue/log/transcript người thật)
- Skill publish công khai → cần privacy-safe
- Muốn mandatory gate (không bao giờ để PII lọt)
- Nối packages/secrets + packages/memory + 069 agentic-firewall; guard regex coverage (phone format đa quốc gia), NER fallback (regex miss → NER model), và re-id risk (k-check anonymity); US = corpus PII-scrubbing, chạy ĐẦU TIÊN trước UQ fidelity-scorecard (corpus sạch → chấm) + UV bundled-example-corpus (ví dụ sẵn phải scrub)
