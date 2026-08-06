# Hướng YQ: Issue Form Submission — GitHub Issue Form (category dropdown, repo URL, one-line desc) làm UI submit skill — cấu trúc hóa đầu vào trước khi vào pipeline (scripts/auto_add_skills.py)

> **Nguồn gốc:** awesome-human-distillation (scripts/auto_add_skills.py) | **Coupling:** 🟢 — submission UI, ngoài runtime | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có curator pipeline — chưa có structured intake) | **Effort:** 1 tuần

## Nguồn gốc

**awesome-human-distillation** dùng **GitHub Issue Form** làm UI submit skill: người submit chọn **category** (dropdown), điền **repo URL**, **one-line description** — đầu vào đã **cấu trúc hóa** ngay từ form, không phải issue tự do viết tùy ý. Script `auto_add_skills.py` đọc issue form → tự xử lý (validate, thêm vào danh sách). Mục đích: (1) dữ liệu đầu vào đồng nhất — script parse được, không cần NLP linh tinh; (2) thiếu field quan trọng bị form chặn ngay; (3) pipeline downstream (663 YM curation, 669 YS sort) nhận input chuẩn.

## Mô tả

mya áp dụng issue-form-submission: thay vì "submit skill qua chat tự do", có **structured intake form**: `category` (dropdown — coding/web/security...), `sourceRepo` (URL bắt buộc, format kiểm tra), `description` (1 dòng), `vendor` (dropdown — 664 YN), `runtime` (dropdown — 665 YO). Form validate trước khi submit (URL hợp lệ, category hợp lệ). Backend nhận payload JSON chuẩn → vào curation pipeline (663 YM). Skill thiếu field → form chặn (không cho submit), không phải pipeline xử lý rác. mya có sẵn gateway (channel nhận message), workflows (runner xử lý), skills curator (pipeline sau intake) — YQ thêm **form schema** + **validation trước submit**.

## Kiến trúc

```
  USER ──► SUBMIT FORM (cấu trúc hóa)
    ├─ category:  [dropdown] coding | web | security | ...
    ├─ sourceRepo:[URL — bắt buộc, validate format]
    ├─ description:[one-line — tối đa N ký tự]
    ├─ vendor:    [dropdown] Anthropic | community | ...
    └─ runtime:   [dropdown] claude-code | mya | generic | ...
       │
       ▼  (form chặn field thiếu/sai — không submit được)
  PAYLOAD JSON chuẩn ──► CURATION PIPELINE (663 YM)
       │
       ├─ validate URL thật (653 YC đọc repo)
       ├─ review chống AI-slop
       └─ badge + vendor classify → vào danh sách
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/gateway — nhận message từ channel (nền — YQ sink submit)
// ✅ packages/workflows runner.ts — xử lý task (nền — YQ pipeline chạy)
// ✅ packages/skills curator.ts — đánh giá skill (nền — YQ downstream)
// ✅ packages/tools url-safety.ts — kiểm tra URL (nền — YQ validate sourceRepo)

// ❌ THIẾU: form schema (fields + dropdown options + required)
// ❌ THIẾU: validate-trước-submit (URL format, field hợp lệ)
```

## Implementation (TS)

```typescript
// packages/skills/src/submission-form.ts (MỚI)
export type Category = "coding" | "web" | "security" | "data" | "ops" | "other";

export interface SkillSubmission {
  category: Category;
  sourceRepo: string;   // URL bắt buộc
  description: string;  // one-line ≤ 140 ký tự
  vendor: string;
  runtime: string;
}

const CATEGORIES: Category[] = ["coding", "web", "security", "data", "ops", "other"];
const MAX_DESC = 140;

export class SubmissionForm {
  /** Validate TRƯỚC khi submit — form chặn field sai. */
  validate(raw: Partial<SkillSubmission>): { ok: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!raw.category || !CATEGORIES.includes(raw.category)) errors.push("category phải thuộc dropdown");
    if (!raw.sourceRepo) {
      errors.push("sourceRepo bắt buộc");
    } else {
      try {
        const u = new URL(raw.sourceRepo);
        if (!/^https?:$/.test(u.protocol)) errors.push("sourceRepo phải là http(s) URL");
      } catch { errors.push("sourceRepo không phải URL hợp lệ"); }
    }
    if (!raw.description || raw.description.length > MAX_DESC) {
      errors.push(`description one-line ≤ ${MAX_DESC} ký tự`);
    }
    return { ok: errors.length === 0, errors };
  }

  /** Payload chuẩn → vào curation pipeline (663 YM). */
  toPipelinePayload(s: SkillSubmission): { category: Category; sourceRepo: string; description: string; vendor: string; runtime: string } {
    return { ...s, description: s.description.trim() }; // chuẩn hóa trước khi pipeline
  }
}

// Usage:
// const form = new SubmissionForm();
// const v = form.validate({ category: "security", sourceRepo: "https://github.com/x/y", description: "Phishing detection skill" });
// v.ok || return renderFormErrors(v.errors);   // form hiện lỗi, không submit
// enqueue(toPipelinePayload(submission));      // → curation pipeline
```

## Được

- ✅ Input chuẩn — pipeline parse JSON, không xử lý text tự do
- ✅ Form chặn sớm — field thiếu/sai không vào pipeline
- ✅ Dropdown có kiểm soát — category/vendor/runtime không bịa
- ✅ One-line desc — danh sách đồng nhất, không mô tả dài lê thê
- ✅ Tái dùng url-safety — URL validate đúng chuẩn mya

## Mất

- ❌ Cứng form — submit phức tạp (multi-skill, mô tả dài) bị chặn oan
- ❌ User friction — form nhiều field làm giảm lượt submit
- ❌ Category đóng — category mới phải sửa schema + dropdown

## Khác các hướng gần

| | Issue tự do (text) | Chat submit | YQ: Issue Form |
|---|---|---|---|
| Parse | NLP/linh tinh | tùy hứng | **JSON chuẩn** |
| Chặn sai | pipeline xử lý | pipeline | **form chặn trước** |
| Field thiếu | xử lý sau | hỏi lại | **không submit được** |

## Khi nào chọn

- Có pipeline curation (663 YM) mà input lộn xộn làm pipeline khó tự động
- Muốn chặn field thiếu ở cổng vào thay vì xử lý rác sau
- Có gateway + workflows + url-safety sẵn — YQ thêm form schema
- Nối packages/gateway (nhận submit) + workflows/runner.ts (chạy pipeline) + tools/url-safety.ts (validate URL); guard category-drift (category thêm mới — migration form cũ), desc-quality (one-line quá ngắn "cool skill" — chặn), và dup-submit (cùng URL submit 2 lần — dedup check); YQ = issue form, kết hợp 663 YM badge-curation (downstream) + 669 YS star-sort (sau intake, sort theo metrics) + 670 YT cron (xử lý định kỳ)
