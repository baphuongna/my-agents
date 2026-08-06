# Hướng JB: Compliance Automation — bằng chứng tuân thủ SOC2/GDPR

> **Nguồn gốc:** SOC 2 Trust Services Criteria; GDPR Article 30 (records of processing); Vanta/Drata compliance automation; "Compliance as Code"; ISO 27001 audit evidence; PCI-DSS logging
> **Coupling:** 🟡 — chạm audit log + data governance
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (audit-trails 198 + PII redaction 214 sẵn — thiếu evidence chain + retention policy)
> **Effort:** 3-5 tuần

## Nguồn gốc

Compliance automation: **tự động thu thập + tổ chức bằng chứng tuân thủ** — không thủ công screenshot khi audit. SOC 2 Trust Services: Security, Availability, Confidentiality — cần evidence (access logs, change logs, vulnerability scans). GDPR Art. 30: "records of processing activities" — phải có. Vanta/Drata: continuous compliance — connect to systems, auto-collect evidence, alert khi gap. "Compliance as Code": policy viết thành code, auto-verify. Cốt lõi: **evidence chain** — mỗi action có: who, what, when, why, immutable. Data retention: GDPR right-to-erasure (PII 214), auto-delete sau N ngày.

## Mô tả

mya compliance automation: audit log (198) → structured thành compliance evidence (SOC2 control mapping). Mỗi agent action (tool call, data access, decision) ghi evidence với control tag (CC1.1, CC6.1). PII (214) auto-redact trước khi log. Retention policy: auto-expire logs sau 90 ngày (GDPR). Audit report: export evidence bundle (JSON + signature) cho auditor. Nối HV (230) event-sourcing: events = immutable evidence. Nối IY (259) prompt-hardening: compliance check trong prompt boundary.

## Kiến trúc

```
  AGENT ACTION (tool call, data access, decision)
        │
        ▼
  ┌──────────────────────────────────────────────────────┐
  │  COMPLIANCE PIPELINE                                  │
  │  1. CAPTURE (audit 198): who/what/when/why/outcome   │
  │  2. PII REDACT (214): email → [REDACTED], phone hash │
  │  3. CONTROL TAG: action → SOC2 (CC6.1) / GDPR (Art6)│
  │  4. IMMUTABLE STORE (HV 230): hash chain, tamper-proof│
  └──────────────────┬───────────────────────────────────┘
        ┌────────────┴────────────┐
        ▼                         ▼
  ┌───────────────┐       ┌──────────────────┐
  │ RETENTION     │       │ AUDIT REPORT     │
  │ GDPR: expire  │       │ export evidence  │
  │ after 90 days │       │ bundle (signed)  │
  │ → auto-delete │       │ → auditor        │
  └───────────────┘       └──────────────────┘
```

```
mya: audit 198 + PII 214 sẵn — thiếu: control mapping + evidence chain + retention automation + report export
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 198 audit-trails — append-only log (sẵn — base)
// ✅ 214 pii-redaction — redact PII (sẵn)
// ✅ HV (230) event-sourcing — immutable store (documented)
// ✅ 221 feature-flags — track rollout (documented)
// ✅ 226 approval-gates — who approved (documented)

// ❌ THIẾU: control mapping (action → SOC2/GDPR tag)
// ❌ THIẾU: evidence chain (hash-linked, tamper-evident)
// ❌ THIẾU: retention policy (auto-expire GDPR)
// ❌ THIẾU: audit report export (signed evidence bundle)
```

## Implementation

```typescript
// packages/compliance/src/index.ts (NEW)
interface Evidence {
  id: string;
  actor: string;        // who (agent/user)
  action: string;       // what
  ts: number;           // when
  control: string;      // SOC2 tag: "CC6.1"
  gdprBasis?: string;   // "Art.6.1.b"
  prevHash: string;     // chain link (tamper-evident)
  hash: string;
}

export class ComplianceEngine {
  private lastHash = "genesis";

  async record(action: AgentAction): Promise<void> {
    const redacted = redactPii(action.payload); // 214
    const ev: Evidence = {
      id: crypto.randomUUID(),
      actor: action.actor,
      action: action.type,
      ts: Date.now(),
      control: this.mapControl(action),     // SOC2 mapping
      gdprBasis: action.gdprBasis,
      prevHash: this.lastHash,
      hash: "",
    };
    ev.hash = sha256(JSON.stringify({ ...ev, hash: "" }));
    this.lastHash = ev.hash;
    await this.store.append(ev);            // HV 230 immutable
  }

  // Retention: GDPR auto-expire
  async enforceRetention(days = 90): Promise<void> {
    const cutoff = Date.now() - days * 86400_000;
    await this.store.deleteBefore(cutoff);  // GDPR right-to-erasure
  }

  // Export signed evidence bundle for auditor
  async exportReport(): Promise<Buffer> {
    const all = await this.store.all();
    return sign(JSON.stringify(all));       // tamper-evident signature
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Audit-ready liên tục (Vanta/Drata — no manual) | ❌ Control mapping maintenance (SOC2 changes) |
| ✅ Evidence chain tamper-evident (HV 230) | ❌ Storage growth (immutable logs) |
| ✅ GDPR retention auto (right-to-erasure) | ❌ Retention vs audit-need conflict (delete too early) |
| ✅ PII redact trước log (214) | ❌ False control mapping → audit gap |

## Khác các hướng gần

| | 198 Audit Trail | 214 PII Redaction | JB: Compliance Auto |
|---|---|---|---|
| Mục | Ghi log | Redact PII | **Bằng chứng tuân thủ (SOC2/GDPR)** |
| Control | ❌ | ❌ | ✅ tag mapping |
| Retention | ❌ | ❌ | ✅ auto-expire |

## Khi nào chọn

- Cần SOC2 / GDPR / ISO 27001 compliance
- Auditor cần evidence bundle (không screenshot thủ công)
- PII-sensitive data (214) — cần retention control
- Nối 198 audit + HV (230) event-store + 214 PII
