# Hướng QQ: Conflict URI Resolution — conflict://N giải @theirs/@ours/@base batch

> **Nguồn gốc:** oh-my-pi (pi-coding-agent); "conflict URI scheme"; "conflict://N addressing"; "@theirs/@ours/@base batch resolve"; "merge-conflict as addressable resource"
> **Coupling:** 🟡 — thêm conflict-URI resolver layer trước edit/patch tool
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (read/edit/apply-patch sẵn — chưa có conflict:// URI + theirs/ours/base picker)
> **Effort:** 2-3 tuần

## Nguồn gốc

**oh-my-pi** mô tả **conflict URI**: mỗi merge-conflict trong file nhận **địa chỉ** `conflict://N` (N = index conflict trong file). Thay vì agent tự parse `<<<<<<< ======= >>>>>>>` thủ công (dễ lỗi offset), agent **địa chỉ conflict** rồi **giải batch** bằng picker `@theirs` / `@ours` / `@base` (lấy phiên bản theirs, ours, hoặc base) hoặc **merge thủ công** (viết nội dung mới). **Batch**: giải nhiều conflict cùng lúc (toàn bộ file hoặc chọn theo index). Nguyên tắc: **conflict là resource có địa chỉ** — agent nói "giải conflict://2 = @theirs, conflict://3 = merge(X+Y)" thay vì đếm dòng thủ công. Khác **394 safeguard-tiering** (review) — QQ là **mechanical resolve**; khác edit thuần (text replace) — QQ **hiểu cấu trúc conflict marker**.

## Mô tả

mya conflict URI resolution: (1) **Detect**: scan file tìm conflict markers (`<<<<<<<`...`>>>>>>>`) → đánh index `conflict://0`, `conflict://1`... (2) **Address**: agent tham chiếu conflict theo URI (không cần line number). (3) **Resolve batch**: mỗi conflict nhận resolution — `@theirs` (giữ incoming), `@ours` (giữ current), `@base` (rollback về gốc), hoặc `manual:"<text>"` (merge nội dung mới). (4) **Apply**: rewrite file, gỡ marker, kiểm tra không còn conflict. (5) **Verify**: git status / re-parse. mya có `read` + `edit` (text replace) — QQ thêm **conflict scanner** + **URI indexer** + **batch resolver** (theirs/ours/base/manual).

## Kiến trúc

```
  FILE có 2 conflict:
  <<<<<<< HEAD
  const x = 1;            (ours)
  =======
  const x = 2;            (theirs)
  >>>>>>> feature

  <<<<<<< HEAD
  import old;             (ours)
  =======
  import new;             (theirs)
  >>>>>>> feature
        │
        ▼
  ┌─── CONFLICT SCANNER + URI INDEXER ─────────────────┐
  │  conflict://0 → { ours: "const x = 1;", theirs: ... }│
  │  conflict://1 → { ours: "import old;", theirs: ... } │
  └───────────────────────┬─────────────────────────────┘
                          │ (agent resolves batch)
                          ▼
  ┌─── BATCH RESOLVER ─────────────────────────────────┐
  │  conflict://0 → @theirs  (giữ "const x = 2;")       │
  │  conflict://1 → manual: "import { new, legacy };"   │
  │   (merge cả 2 — cần cả new và legacy)                │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── APPLY + VERIFY ─────────────────────────────────┐
  │  rewrite file (gỡ marker, chèn resolution)          │
  │  re-scan → 0 conflict còn lại → OK                  │
  │  git add file                                        │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ read — đọc file (nền — QQ parse marker)
// ✅ edit — text replace (nền — QQ apply resolution)
// ✅ bash — git status/merge (nền — QQ detect conflict từ git)
// ✅ 296 ast-edit — structured edit (nền — QQ text-level)

// ❌ THIẾU: conflict scanner (parse <<<<<<< ======= >>>>>>>)
// ❌ THIẾU: URI indexer (conflict://N per conflict)
// ❌ THIẾU: batch resolver (theirs/ours/base/manual picker)
// ❌ THIẾU: marker-free rewrite (apply + verify no leftover)
```

## Implementation

```typescript
// packages/agent/src/conflict-uri.ts (MỚI)
type Resolution = '@theirs' | '@ours' | '@base' | { manual: string };

interface Conflict { uri: string; ours: string; theirs: string; base?: string; startLine: number; endLine: number }

function scanConflicts(content: string): Conflict[] {
  const lines = content.split('\n');
  const conflicts: Conflict[] = [];
  let i = 0, idx = 0;
  while (i < lines.length) {
    if (lines[i]?.startsWith('<<<<<<<')) {
      const start = i;
      const ours: string[] = [];
      i++;
      while (i < lines.length && !lines[i]?.startsWith('=======')) { ours.push(lines[i]!); i++; }
      i++; // skip =======
      const theirs: string[] = [];
      while (i < lines.length && !lines[i]?.startsWith('>>>>>>>')) { theirs.push(lines[i]!); i++; }
      conflicts.push({
        uri: `conflict://${idx++}`, ours: ours.join('\n'),
        theirs: theirs.join('\n'), startLine: start, endLine: i,
      });
    }
    i++;
  }
  return conflicts;
}

function resolveBatch(content: string, resolutions: Record<string, Resolution>): string {
  const conflicts = scanConflicts(content);
  let result = content;
  // resolve from last to first so offsets stay valid
  for (const c of [...conflicts].reverse()) {
    const res = resolutions[c.uri];
    const picked = res === '@theirs' ? c.theirs
      : res === '@ours' ? c.ours
      : res === '@base' ? (c.base ?? '')
      : res.manual;
    const lines = result.split('\n');
    lines.splice(c.startLine, c.endLine - c.startLine + 1, ...picked.split('\n'));
    result = lines.join('\n');
  }
  return result;
}

// Usage:
// const conflicts = scanConflicts(fileContent);          // [conflict://0, conflict://1]
// const resolved = resolveBatch(fileContent, {
//   'conflict://0': '@theirs',
//   'conflict://1': { manual: 'import { new, legacy };' },
// });
// await write(file, resolved);                            // gỡ marker, chèn resolution
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent địa chỉ conflict chính xác (URI, không đếm line) | ❌ Nested conflict (marker lồng) khó parse |
| ✅ Batch resolve nhanh (toàn bộ file cùng lúc) | ❌ Manual merge sai → conflict logic mới (không syntax) |
| ✅ theirs/ours/base picker rõ ràng | ❌ Rebase/3-way base cần git (không chỉ file text) |
| ✅ Verify được (re-scan → 0 marker) | ❌ Conflict không phải code (config/lockfile) cần tool riêng |

## Khác các hướng gần

| | 296 AST-Edit | 117 Toolchain-Feedback | QQ: Conflict-URI |
|---|---|---|---|
| Cái gì | Structured edit | Build/test loop | **Conflict address + resolve** |
| Cấu trúc | AST node | Test pass/fail | **Marker <<<<<<< =======** |
| Batch | Multi-edit | N/A | **theirs/ours/base per URI** |

## Khi nào chọn

- Agent giải merge-conflict (git rebase/merge nhiều file)
- Conflict nhiều (đếm line thủ công dễ sai)
- Muốn resolve nhanh (batch theirs/ours cho conflict đơn giản, manual cho phức tạp)
- Nối read (parse marker) + edit (apply resolution) + bash (git merge-base cho @base); guard nested marker + verify re-scan → 0 leftover; manual merge cần agent hiểu ngữ nghĩa (không chỉ syntax)
