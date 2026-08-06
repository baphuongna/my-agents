# Hướng EH: Agent Software Supply Chain — ký và xác minh skill/tool/model trước khi dùng

> **Nguồn gốc:** ReversingLabs "How AI agents upend software supply chain security"; Coalition for Secure AI "Model Signing"; JFrog "Supply Chain State of Union 2026"; Nolabs "Sigstore + AI Agent Provenance"; Cloudsmith 2026 Guide
> **Coupling:** 🟢 — thêm lớp xác minh khi nạp, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (signing package sẵn + MCP gateway + tool registry sẵn; thiếu verify policy)
> **Effort:** 1-2 tuần

## Nguồn gốc

Agent supply chain: **ký số skill/tool/model/prompt, xác minh trước khi agent dùng** — ReversingLabs: "We need stronger standards for agent provenance and accountability — cryptographic signing of skills, clearer publisher trust"; Coalition for Secure AI: "Model signing applies cryptographic techniques to establish verifiable trust between AI model producers and consumers — think of it as a digital signature for AI"; JFrog 2026: "the software supply chain threat model has changed — attacks moved toward the tools developers and AI teams use"; Nolabs: Sigstore cho agent provenance — mới, đang định hình chuẩn. Điểm khác **KKKK credential broker** (bảo vệ secret) và **IIII TEE** (bảo vệ runtime) — IIIIII *bảo vệ nguồn*: skill MCP server tool, prompt template, model đều có nguồn gốc + chữ ký; agent chỉ nạp cái đã verify (như npm/SBOM nhưng cho agent). Nối NNN (skill repo), BBB (MCP — nơi tool vào), WW (policy — gì được nạp), VV (audit nạp cái gì).

## Mô tả

mya supply chain: (1) **registry tin cậy** — skill/MCP server/tool có publisher identity (key), version, signature (Sigstore/COSIGN — signing package đã có); (2) **verify-on-load** — khi agent mở rộng (tool maker AA, cài skill): xác minh chữ ký + hash + SBOM dependencies trước khi nạp — từ chối cái không verify (như npm audit gate); (3) **provenance** — ghi ai publish, khi nào, từ đâu (SBOM + SLSA provenance), agent log nguồn của mọi tool đang dùng; (4) **policy WW** — trust level theo publisher (nhà phát hành quen = tự do; lạ = cảnh báo/không nạp); (5) **update an toàn** — skill mới phải verify + test trước khi thay bản đang chạy (FFFF versioning); (6) **audit VV** — mọi lần nạp/update ghi lại (ai, cái gì, chữ ký ai).

## Kiến trúc

```
  SKILL/MCP/TOOL (publisher) ──► KÝ SỐ (Sigstore/COSIGN — signing sẵn)
        │  publisher identity · version · signature · SBOM
        ▼
  VERIFY-ON-LOAD — chữ ký · hash · dependencies (như npm audit gate)
        │
   OK ──────► NẠP vào registry (NNN) — provenance ghi (SLSA)
  KHÔNG VERIFY ─► từ chối (WW policy — trust level theo publisher)
        │
        ▼
  UPDATE: bản mới verify + test (FF) trước khi thay — VV audit mọi lần nạp
```

```
mya: signing + MCP gateway + NNN SẸN — thiếu: verify-on-load + provenance + trust policy
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ signing package — ký/xác minh (nền tảng Sigstore-style)
// ✅ BBB MCP gateway — nơi tool vào (verify tại đây)
// ✅ NNN tool registry — danh mục tool/skill (provenance attach)
// ✅ WW policy engine — trust level (publisher quen/lạ)
// ✅ FFFF versioning — update có version (gate thay thế)

// ❌ THIẾU: verify-on-load (chữ ký + hash + SBOM trước khi nạp)
// ❌ THIẾU: provenance log (ai publish · khi nào · từ đâu)
// ❌ THIẾU: trust policy theo publisher (WW rules cụ thể)
```

## Implementation

```typescript
// packages/supplychain/src/verify.ts (NEW)
export class VerifyGate {
  async load(artifact: Artifact, ctx: TrustCtx): Promise<Loaded> {
    const ok = await verifySig(artifact.sig, artifact.pubKey); // signing sẵn
    const sbom = await verifySbom(artifact.deps);              // dependencies
    if (!ok || !sbom) throw new Unverified(artifact.id);       // từ chối
    if (!trustPolicy.allows(ctx.publisher, artifact)) return warn; // WW
    audit.log("load", { artifact, publisher: ctx.publisher }); // VV
    return registry.install(artifact);                         // NNN
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chặn skill/tool độc hại từ publisher giả/không rõ | ❌ Thêm bước xác minh khi nạp (chậm nhẹ) |
| ✅ Truy vết nguồn gốc mọi tool đang chạy (provenance) | ❐ Hệ sinh thái chưa chuẩn (Sigstore cho agent mới hình thành) |
| ✅ Update an toàn — verify + test trước khi thay | ❌ Publisher hợp lệ vẫn có thể publish bản xấu |
| ✅ Xây trên signing + BBB + NNN | ❌ Skill tự sinh trong agent (tool maker) không có publisher |

## Khác các hướng gần

| | KKKK Credential | IIII TEE | IIIIII: Supply Chain |
|---|---|---|---|
| Bảo vệ | Secret | Runtime dữ liệu | **Nguồn (tool/skill/model)** |
| Cơ chế | OAuth broker | Enclave | **Ký số + verify + provenance** |
| Thời điểm | Lúc gọi tool | Lúc chạy | **Lúc nạp** |

## Khi nào chọn

- Cài skill/tool/MCP từ bên ngoài (không tự viết)
- Nhiều người publish skill cho agent dùng chung
- Đã có signing + BBB + NNN + WW — thêm verify gate + provenance
- Cần tuân chuẩn (SBOM/SLSA) cho agent