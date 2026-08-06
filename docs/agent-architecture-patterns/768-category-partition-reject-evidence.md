# Hướng ACN: Category Partition Reject Evidence — chia site thành category mutually exclusive, REJECT category bằng semantic proof

> **Nguồn gốc:** pi-crew-distill-v3 (references/apply-plan.md) | **Coupling:** 🟢 — phương pháp phân loại, không đụng kiến trúc | **Agent-agnostic:** ⚠️ (cần semantic reasoning) | **Code sẵn:** ⚠️ (có eval parity — chưa có partition pipeline) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-crew-distill-v3** chia **106 site** thành **4 category mutually exclusive**: (1) **drop-in 44** — thay trực tiếp bằng helper, hành vi không đổi; (2) **const-stored 59** — kết quả được lưu vào const trước (vẫn thay được, chỉ khác chỗ); (3) **sanitize-wrapped 1** — đã bọc sanitize, thay không thêm giá trị; (4) **genuine variants 2** — biến thể thật sự khác. Sau đó **REJECT 2 category bằng semantic proof**: thay `String(err ?? "unknown")` bằng `errorMessage()` sẽ **đổi hành vi null/undefined** (helper trả "unknown error", còn `String(null)` trả "null") — còn **unwrap `sanitizeErrorMessage` là regression** (mất lớp vệ sinh). Nguyên tắc: **phân loại không chồng lấn, reject phải có chứng minh ngữ nghĩa, không phải cảm tính**.

## Mô tả

mya category partition reject evidence: (1) **partition** — quét danh sách site (từ ACM grep evidence), gán mỗi site vào đúng một category qua quy tắc rõ: `drop-in` (thay nguyên), `const-stored` (gán const trước), `sanitize-wrapped` (đã sanitize), `genuine-variant` (biến thể khác); (2) **mutually exclusive** — một site không thể nằm 2 category (quy tắc gán có ưu tiên); (3) **reject by semantic proof** — với category nghi ngờ, phân tích **hành vi trước/sau** của biểu thức: null/undefined, kiểu lạ, side-effect; (4) **apply phần còn lại** — chỉ category chứng minh được an toàn mới thay. Nối ACL (consolidation) + ACM (evidence) — ACN là khâu quyết định giữa detect và apply.

## Kiến trúc

```
  106 SITES (từ ACM grep evidence)
       ▼
  PARTITION (mutually exclusive)
    ├─ drop-in 44          — thay trực tiếp, hành vi không đổi
    ├─ const-stored 59     — gán const trước, vẫn thay được
    ├─ sanitize-wrapped 1  — đã sanitize — thay không thêm giá trị
    └─ genuine variants 2  — biến thể thật khác
       ▼
  SEMANTIC PROOF CHO REJECT
    String(err ?? "unknown") ──▶ errorMessage() ĐỔI hành vi
                                  (null → "null" vs "unknown error")
    sanitizeErrorMessage unwrap ──▶ REGRESSION (mất lớp vệ sinh)
       ▼
  APPLY (103/106 — category an toàn) · REJECT (3/106 — có proof)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core error-message.ts (ACL) — helper chung (nền — đối tượng apply)
// ✅ packages/tools grep-evidence.ts (ACM) — evidence chính xác (nền — danh sách site)
// ✅ packages/eval harness.ts — ParityHarness + identicalPassthrough (nền — kiểm tra không đổi hành vi)
// ✅ packages/audit index.ts — AuditLog (nền — ghi reject + proof)
// ✅ packages/memory conflict.ts — jaccardSimilarity (nền — so sánh phân loại)

// ❌ THIẾU: partition rules (category gán site, ưu tiên)
// ❌ THIẾU: semantic proof checker (null/undefined regression)
```
## Implementation
```typescript
// packages/tools/src/partition.ts (MỚI)
export type SiteCategory = "drop-in" | "const-stored" | "sanitize-wrapped" | "genuine-variant";
export interface PartitionedSite {
  file: string;
  line: number;
  text: string;
  category: SiteCategory;
}
/** Gán category — mutually exclusive, ưu tiên theo thứ tự. */
export function classifySite(text: string): SiteCategory {
  if (/sanitize|sanitiz|scrub|clean/i.test(text)) return "sanitize-wrapped";
  if (/String\(err\s*\?\?\s*["']unknown["']\)/.test(text)) return "genuine-variant";
  if (/^\s*const\s+\w+\s*=/.test(text)) return "const-stored";
  return "drop-in";
}
export function partition(sites: Array<{ file: string; line: number; text: string }>): Map<SiteCategory, PartitionedSite[]> {
  const out = new Map<SiteCategory, PartitionedSite[]>();
  for (const s of sites) {
    const category = classifySite(s.text);
    const list = out.get(category) ?? [];
    list.push({ ...s, category });
    out.set(category, list);
  }
  return out;
}
/** Semantic proof — biểu thức có đổi hành vi khi thay bằng helper không. */
export function semanticProof(text: string, helper = "errorMessage"): { safe: boolean; reason: string } {
  // Case null/undefined: String(err ?? "unknown") vs errorMessage()
  if (/String\(err\s*\?\?\s*["']unknown["']\)/.test(text)) {
    return {
      safe: false,
      reason: "String(err ?? 'unknown') trả 'null'/'undefined' khi err null — errorMessage() trả 'unknown error'. ĐỔI hành vi — REJECT.",
    };
  }
  // Unwrap sanitize là regression.
  if (/sanitize/i.test(text)) {
    return { safe: false, reason: "Bỏ lớp sanitizeErrorMessage là regression (mất vệ sinh). REJECT." };
  }
  // drop-in + const-stored: thay bằng helper, hành vi giữ nguyên.
  return { safe: true, reason: `${helper}() giữ nguyên hành vi cho nhánh này — APPLY.` };
}
/** Apply plan — chỉ category an toàn, kèm proof. */
export function buildApplyPlan(parts: Map<SiteCategory, PartitionedSite[]>): { apply: PartitionedSite[]; reject: Array<PartitionedSite & { reason: string }> } {
  const apply: PartitionedSite[] = [];
  const reject: Array<PartitionedSite & { reason: string }> = [];
  for (const [cat, sites] of parts) {
    for (const s of sites) {
      const proof = semanticProof(s.text);
      if (proof.safe) apply.push(s);
      else reject.push({ ...s, reason: proof.reason });
    }
  }
  return { apply, reject };
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Category không chồng lấn — đếm được chính xác từng loại | ❌ Regex classify có thể miss biến thể viết khác |
| ✅ Reject có semantic proof — không cảm tính | ❌ Proof cần hiểu ngữ nghĩa JS (null coercion) |
| ✅ Chỉ apply category an toàn — regression giảm | ❌ Genuine variants phải review thủ công |
| ✅ Balance under/over-apply — size không phải filter | ❌ Partition rules cần test với fixture thật |

## Khác các hướng gần

| | ACL: Consolidation Plan | ACN: Partition + Reject |
|---|---|---|
| Đầu vào | Detect anti-pattern | **Danh sách site + category gán** |
| Quyết định | Gom về helper | **Chia category + REJECT bằng proof** |
| Đo | Số site | **Phân bố category + lý do reject** |
| Quan hệ | Nền detect | **Khâu quyết định trước apply** |

## Khi nào chọn

- Refactor hàng loạt — cần phân loại site trước khi đụng code
- Muốn reject có căn cứ (semantic proof) thay vì "cảm giác không nên"
- Đã có ACL + ACM — thêm partition là bước giữa
- Guard: category mutually exclusive, proof cho mọi reject, parity test sau apply
