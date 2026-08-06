# Hướng RRR: Agentic Firewall — bảo vệ luồng prompt khỏi injection

> **Nguồn gốc:** AccuKnox Prompt Firewall; Palo Alto Cyberpedia; MDPI 2025 "LLM Firewall with Validator Agent"; arXiv 2510.05244
> **Coupling:** 🟢 — firewall là lớp intercept input/output, không đụng core
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (audit + secrets + signing sẵn; thiếu validator layer)
> **Effort:** 1-2 tuần

## Nguồn gốc

Agentic firewall / LLM security gateway: mọi prompt **vào** (user input, web content, tool result) và output **ra** đều đi qua lớp kiểm soát. Vì prompt injection có **cấu trúc** không giống lỗi bảo mật thường: LLM trộn instruction tin cậy với dữ liệu không tin cậy trong 1 luồng token (TrueFoundry: "structural root"). Phòng thủ 2025-2026: **validator agent** (MDPI 2025: LLM firewall dùng validator agent chặn injection + info leakage + policy-violating output), **output firewall** (arXiv 2510.05244: 1 output firewall chặn gần như mọi tấn công), prompt firewall của AccuKnox (chặn trước khi chạm model). Khác **20 Immune System** (phát hiện agent *đã bị* tổn hại) — firewall **chặn trước khi** luồng độc vào model; khác **OO** (quyền tool) và **KKK** (credential) — firewall là lớp riêng trên luồng text.

## Mô tả

mya chèn firewall ở 3 điểm: 1) **input gate** — mọi nội dung từ ngoài (file đọc, web scrape, MCP result) scan injection pattern + delimiter smuggling trước khi vào context; 2) **instruction boundary** — dữ liệu không tin cậy được bọc tag rõ ràng (`<untrusted>`) + hướng dẫn model không tuân theo nội dung trong tag; 3) **output gate** — output trước khi trả về user/tool check: chứa secret không (nối packages/secrets), vượt policy không, có dấu hiệu exfiltration không. Dùng validator agent nhỏ (tier small qua RR) cho quyết định tinh vi — nhưng lưu ý: LLM-judge có thể bị tấn công (nhimg.org) → validator chỉ là 1 tầng, không phải tất cả.

## Kiến trúc

```
  untrusted input (file, web, MCP) ──► INPUT GATE (firewall)
      │  scan: injection pattern, delimiter smuggling, tainted source
      │  wrap: <untrusted>…</untrusted> (instruction boundary)
      ▼
  AGENT LOOP (context đã phân lớp tin cậy)
      ▼
  output ──► OUTPUT GATE
      │  scan: secret leak (packages/secrets), policy-violating,
      │         exfiltration pattern, PII
      ▼
  user / tool (đã sạch)          validator agent (MDPI) = tầng phụ quyết định tinh
```

```
mya: packages/audit + packages/secrets + packages/signing sẵn — nền ghi nhận + chặn
     thiếu: validator layer trên luồng prompt + untrusted wrapping
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/audit — ghi lại mọi luồng (điều tra khi có injection)
// ✅ packages/secrets — phát hiện secret trong output (chặn leak)
// ✅ packages/signing — xác thực nguồn (ai gửi nội dung này)
// ✅ OO roles — chặn tool gọi sai quyền (lớp khác, cùng mục tiêu)
// ✅ packages/ai/src/registry.ts — TaintedProfile (đánh dấu source nghi ngờ)

// ❌ THIẾU: input gate — scan + untrusted wrapping trước khi vào context
// ❌ THIẾU: output gate validator (không chỉ secret — cả policy/exfiltration)
// ❌ THIẾU: validator agent (tier small) cho quyết định tinh vi
```

## Implementation

```typescript
// packages/core/src/firewall.ts (NEW)
const UNTRUSTED_TAG = "<untrusted></untrusted>";

function sanitizeInput(raw: string, source: TrustSource): string {
  if (injectionSignals(raw)) return rejectInput(raw);   // input gate
  return wrapUntrusted(raw, source);                    // instruction boundary
}

async function sanitizeOutput(out: string): Promise<string | null> {
  if (await leaksSecret(out)) return null;              // packages/secrets
  if (violatesPolicy(out)) return null;                 // OO policy text
  const verdict = await validatorAgent(out);            // tier small (RR) — tầng phụ
  return verdict.ok ? out : null;
}

// LƯU Ý: validator LLM là 1 tầng — không tin tưởng tuyệt đối (nhimg.org)
// cấu trúc chính là boundary + rules deterministic; LLM chỉ xử lý tinh vi
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chặn injection trước khi chạm model (input gate) | ❌ False positive chặn nhầm nội dung hợp lệ |
| ✅ Output gate chặn exfiltration + leak secret (secrets sẵn) | ❌ Validator LLM tự nó bị tấn công — chỉ là 1 tầng |
| ✅ arXiv 2510.05244: output firewall chặn gần như mọi tấn công | ❌ Overhead: 2 lần scan mỗi lượt (in/out) |
| ✅ Audit sẵn — ghi đủ để điều tra khi bị tấn công | ❌ Injection mới (chưa có pattern) thoát rule cũ |
| ✅ Bổ sung cho 20-immune + OO + KKK thành phòng thủ nhiều lớp | |

## Khác các hướng gần

| | 20 Immune System | OO Tool Registry | RRR: Firewall |
|---|---|---|---|
| Vị trí | Phát hiện agent bệnh | Quyền gọi tool | **Luồng prompt in/out** |
| Chặn khi nào | Sau khi hư hại | Trước tool call | **Trước khi chạm model** |
| Cơ chế | Giám sát health | Gate quyền | Scan + boundary + validator |
| Mối quan hệ | Đồng đội (phát hiện) | Đồng đội (quyền) | Chặn từ đầu |

## Khi nào chọn

- Agent đọc nội dung không tin cậy (web, MCP, file) — nguy cơ indirect injection
- Muốn output không bao giờ lộ secret (đã có packages/secrets)
- Muốn phòng thủ nhiều lớp: firewall + immune + OO + KKK
- Chấp nhận false-positive và overhead 2 lần scan