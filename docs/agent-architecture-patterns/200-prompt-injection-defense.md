# Hướng SSSSSSSS: Prompt Injection Defense — chống tấn công inject: input sanitize, tách dữ liệu không tin, guard

> **Nguồn gốc:** OWASP LLM Prompt Injection Prevention Cheat Sheet (regular security testing, monitor new techniques, update defenses); Microsoft "How Microsoft Defends Against Indirect Prompt Injection" (systems xử lý untrusted data); Palo Alto "What is Prompt Injection" (attacker inject executable code — manipulate responses, execute unauthorized actions); tldrsec "Injecting compute — treat all LLM outputs and untrusted data as potentially malicious"
> **Coupling:** 🟡 — mọi input/output LLM phải qua kiểm tra
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (guardrail + tool call check sẵn; thiếu per-layer defense)
> **Effort:** 2-4 tuần

## Nguồn gốc

Prompt injection defense: **kẻ tấn công nhồi chỉ dẫn độc vào input (email, web, tool output) làm agent làm chuyện ngoài ý — phòng thủ nhiều lớp** — OWASP: "conduct regular security testing with known attack patterns — monitor for new injection techniques and update defenses"; Microsoft: indirect injection — "systems that leverage LLMs to process untrusted data" (nguy hiểm qua dữ liệu gián tiếp); Palo Alto: "attacker injects executable code into LLM prompt to manipulate responses or execute unauthorized actions"; tldrsec: "always treat all LLM outputs as potentially malicious, and under control of any entity that has been able to inject" (triết lý tin 0%). Điểm khác **MMMMMMM guardrails** (chặn hành động — hệ quả) và **TTTTTTT output validate** (schema) — SSSSSSSS *chống ở đầu vào*: (1) input sanitize — lọc input người dùng (kites: filter noted adversarial — Wingtech); (2) treat untrusted — mọi dữ liệu ngoài (web/email/file) là untrusted — đặt riêng, không trộn với instructions (Microsoft indirect — tách rõ instruction vs data); (3) instruction vs data separation — mỗi tool result/web content đánh dấu "data" — LLM không được thực thi chỉ dẫn trong data (delim là nền tảng); (4) allowlist tool — agent chỉ gọi tool theo chính sách (GGGGGGGG scope + UUUU perms — kể cả LLM bị lừa cũng không quyền); (5) monitoring — phát hiện (multi-agent LLM defense pipeline — arXiv 2509.14285: specialized LLM agents phát hiện các chain), catch khi orche start; (6) OWASP update — cập nhật theo khuôn mẫu tấn công mới (OWASP — monitor new techniques). Nối MMMMMMM (guard — chặn action), GGGGGGGG (scope — ít quyền hại), TTTTTTT (output validate — làm nhụt làm độc), QQQQQQQ (audit — ghi bị attack), YYYYYYY (identity — user ảnh hưởng vùng), II (IIII cargo supply — third-party barrier), 168 (guardrails).

## Kiến trúc

```
  INPUT (user + WEB/email/api/file — untrusted data)
        │
        ├── SANITIZE (OWASP — lọc pattern độc)
        ├── SEPARATE (Microsoft — tách instructions vs untrusted data)
        │     delimiters · data tô "không tin"
        │
        ▼
  POLICY-GATED TOOL (GGGGGGGG + UUUU): dù bịa chỉ đạo, chỉ được tool allowlist
        │
        ▼
  DETECT (arXiv 2509.14285 — multi-agent pipeline phát hiện)
   · guardrail (MMMMMMM chặn) · output validate (TTTTTTT)
        │
        ▼
  AUDIT (QQQQQQQQ — ghi attack) · UPDATE (OWASP — techniques mới)
```

```
mya: QQQQQ injection defense SẴN — thiếu: per-layer + separation
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ QQQQQ prompt injection defense — đã có lớp cơ bản (nền)
// ✅ GGGGGGGG least privilege + UUUU — quyền chặn (nền)
// ✅ MMMMMMM guardrails — chặn hành động
// ✅ TTTTTTT output validate — chặn output độc
// ✅ QQQQQQQ audit — ghi
// ✅ 162 supply chain — xác thực tool/mã bên thứ ba

// ❌ THIẾU: data separation layer (delimiters — Microsoft indirect)
// ❌ THIẾU: per-source untrusted gating (web/email/file tách ảnh hưởng)
// ❌ THIẾU: detector agent (phát hiện inject — arXiv 2509.14285)
// ❌ THIẾU: OWASP checklist + update vòng lặp
```

## Implementation

```typescript
// packages/secinject/src/defense.ts (NEW)
export class PromptDefense {
  async guard(input: Input, ctx: Ctx): Promise<SafeInput> {
    await sanitize(input);                        // OWASP — lọc pattern độc
    if (untrusted(ctx.source))                      // web/email/file = data
      markAsData(input);                            // tách — không thực thi
    const approved = await policy.allowlist(input.tools); // GGGGGGGG chặn quyền
    detector.watch(approved);                       // detect + alert (arXiv)
    return approved;
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Ngăn chặn agent điều hành trái phép qua data (Microsoft) | ❌ Nhiều lớp đè — chậm thêm mỗi call |
| ✅ Dữ liệu gián tiếp (web/email) không leveraged (guarding) | ❐ Khó phân biệt "chỉ dẫn hợp lệ" vs inject |
| ✅ Quyền thấp + guard — system chịu thiệt hại giới hạn | ❌ Vô vọng chống 100% — phải chấp nhận chặn vành |
| ✅ Xây trên QQQQQ + MMMMMMM + TTTTTT | ❌ Triết lý "0-trust" — chặn nhiều hoạt động hợp pháp |

## Khác các hướng gần

| | MMMMMMM Guardrails | TTTTTTT Output | SSSSSSSS: Injection |
|---|---|---|---|
| Mục | Chặn hành động | Validate schema | **Chống input độc (prompt inject)** |
| Thời điểm | Khi hành động | Khi trả | **Trước khi vài người LLM xử** |
| Quan hệ | Hậu | Sau | **Đầu vào — lớp + phủ rộng** |

## Khi nào chọn

- Agent đọc data không tin cậy (web/email/file đính kèm)
- Tool có hệ thuộc quyền — inject hậu quả (Palo Alto unauthorized)
- Bắt buộc theo OWASP — cập nhật định kỳ
- Phòng thủ đầu vào bắt buộc (OWASP cheat sheet — cập nhật định kỳ)