# Hướng AEH: Line-Ending & BOM Preservation — bảo toàn BOM + CRLF/LF khi normalize rồi restore lúc write-back

> **Nguồn gốc:** pi-diff | **Coupling:** 🟡 — đụng edit path (hashline) nhưng isolate trong lớp text-encoding | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn canon() strip CR; thiếu BOM + restore) | **Effort:** 1 tuần

## Nguồn gốc

**pi-diff** có `src/core/text-encoding.ts`: trước khi **normalize nội dung để hashline matching**, phát hiện và ghi nhớ (1) **BOM** (`\uFEFF` đầu file) và (2) **line-ending style** (CRLF/LF) của từng dòng/file; sau khi diff + sửa, **restore nguyên trạng lúc write-back**. Mục đích: **tránh diff nhiễu do encoding** — một file CRLF không bị "đổi toàn file" chỉ vì công cụ viết lại bằng LF, và một file có BOM không bị mất BOM khi qua tay edit tool.

Failure mode bị chống: edit tool đọc text, normalize về LF, write-back → Git thấy cả file thay đổi (line-ending churn) → diff nhiễu, blame hỏng, code review khó. Hoặc file UTF-8 BOM bị mất BOM → một số toolchain (Windows PowerShell, trình biên dịch cũ) đọc sai encoding.

## Mô tả

Với mya, `packages/tools/src/hashline-edit.ts` đã có `canon(line)` **strip CR (`\r`) + trimEnd** trước khi hash — tức normalize CRLF→LF **đã tồn tại ở tầng so khớp**. Pattern thêm 2 mảnh còn thiếu: (1) **detect** — trước khi đọc, ghi nhận `hasBom` + `lineEnding` ("crlf" | "lf" | "mixed") từ raw bytes; (2) **restore** — sau khi áp edit, write-back với đúng BOM + line-ending gốc, và nếu file **mixed** thì giữ nguyên từng dòng (chỉ thêm mới theo style chiếm đa số). Nối AEC apply-log để ghi "file này giữ nguyên encoding". Đây là pattern **byte-faithful** — phù hợp triết lý mya "byte-faithful JSON" (§18): input byte thế nào, output byte đúng vậy (trừ vùng sửa).

## Kiến trúc (ASCII)

```
  RAW BYTES ──► DETECT ENCODING (text-encoding.ts)
                 ├─ hasBom: \uFEFF đầu file?  (giữ lại)
                 ├─ lineEnding: crlf | lf | mixed (đếm \r\n vs \n)
                 └─ normalize nội dung: CRLF→LF, bỏ BOM tạm thời
                          │
                          ▼
                 HASH LINE (hashline-edit canon — đã strip CR)
                          │
                          ▼  EDIT / DIFF trên bản đã normalize
                 RESTORE TRƯỚC WRITE-BACK
                 ├─ thêm lại BOM nếu có
                 └─ CRLF lại các dòng (dòng mới theo style đa số)
                          │
                          ▼
                 WRITE BYTES — nguyên trạng, không nhiễu diff
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools/src/hashline-edit.ts — canon() strip CR + trimEnd
//   (normalize CRLF→LF để hash ổn định — đã sẵn)
// ✅ packages/tools/src/hashline.ts — hash-anchored edit nền
// ✅ packages/tools/src/hashline-edit.ts — applyEdits theo span (write-back point)
// ✅ packages/audit — AuditLog (ghi encoding giữ nguyên — nối AEC)

// ❌ THIẾU: detect BOM + lineEnding trước khi đọc
// ❌ THIẾU: restore nguyên trạng lúc write-back (BOM + CRLF)
// ❌ THIẾU: chính sách mixed line-ending (dòng mới theo style đa số)
```

## Implementation

```typescript
// packages/tools/src/text-encoding.ts (NEW)
export interface FileEncoding {
  hasBom: boolean;
  lineEnding: "crlf" | "lf" | "mixed";
  dominant: "crlf" | "lf";
}

export function detectEncoding(raw: Uint8Array): FileEncoding {
  const text = new TextDecoder("utf-8").decode(raw);
  const hasBom = text.charCodeAt(0) === 0xfeff;
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
  const lineEnding = crlf > 0 && lf > 0 ? "mixed" : crlf > 0 ? "crlf" : "lf";
  return { hasBom, lineEnding, dominant: crlf >= lf ? "crlf" : "lf" };
}

export function restoreEncoding(content: string, enc: FileEncoding): string {
  let out = content;
  if (enc.lineEnding === "crlf" || enc.lineEnding === "mixed") {
    // CRLF lại — dòng mới sinh ra theo style đa số (dominant)
    out = out.replace(/(?<!\r)\n/g, enc.dominant === "crlf" ? "\r\n" : "\n");
  }
  return enc.hasBom ? `\uFEFF${out}` : out;   // restore BOM
}
// Edit tool: đọc raw → detect → normalize → edit → restore → write bytes
// Nối AEC: ghi {file, hasBom, lineEnding} vào audit log
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Git diff sạch — không nhiễu CRLF/BOM | ❌ Mixed line-ending khó xử lý chuẩn (heuristic) |
| ✅ Toolchain cũ đọc đúng (BOM giữ nguyên) | ❌ Phải đọc raw bytes thay vì text string |
| ✅ Byte-faithful — đúng triết lý mya | ❌ Regex `(?<!\r)\n` cần test kỹ trên mọi OS |
| ✅ Nối hashline-edit tự nhiên (canon đã strip CR) | ❌ Editor/IDE tự đổi encoding vẫn ngoài tầm kiểm soát |

## Khác các hướng gần

| | AEH Text-Encoding | AEF Cascade Replace | ADQ Rewrite Registry |
|---|---|---|---|
| Trọng tâm | Bảo toàn byte khi write-back | Khớp chỗ cần sửa | Quyết định đường rewrite |
| Cơ chế | Detect + restore BOM/CRLF | 4 tầng khớp + Levenshtein | 3 đường quyết định |
| Quan hệ | Nền cho mọi edit | Chọn vị trí edit | Chọn output |

## Khi nào chọn

- Repo đa OS (Windows dev + CI Linux) — CRLF churn là vấn đề thực
- File có BOM (PowerShell scripts, một số toolchain)
- Đã có hashline-edit (canon strip CR) — chỉ thêm detect + restore
- Muốn byte-faithful tuyệt đối khi agent sửa file