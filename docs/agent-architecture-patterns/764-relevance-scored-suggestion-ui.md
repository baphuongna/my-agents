# Hướng ACJ: Relevance-Scored Suggestion UI — `/suggest-dirs` hiển thị suggestions kèm relevance scores từ genuine project signals, pre-scan tối ưu latency

> **Nguồn gốc:** pi-add-dir (extensions/pi-add-dir/suggestions.ts) | **Coupling:** 🟢 — UI layer, engine độc lập | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có command-registry + panel render — chưa có scored suggestion UI) | **Effort:** 1 tuần

## Nguồn gốc

**pi-add-dir** hiển thị directory suggestions qua lệnh **`/suggest-dirs`** với **relevance scores** tính từ **genuine project signals** (không hardcode path — không "vì dir này tên giống nên gợi ý"). Mỗi suggestion hiển thị **score + signal nguồn** (workspace member / local dep / submodule…) để user hiểu vì sao được gợi ý. Điểm kỹ thuật: **pre-scan optimization** — collector **chỉ chạy khi trigger file tồn tại** (chỉ đọc package.json nếu file có mặt, chỉ đọc .gitmodules nếu tồn tại) — latency giảm từ **1.85ms xuống 0.78ms**. Nguyên tắc: **UI giải thích được điểm số, engine không chạy thừa**.

## Mô tả

mya relevance-scored suggestion UI: (1) **`/suggest-dirs` command** — đăng ký vào command-registry (packages/print command-registry.ts); (2) **render bảng** — mỗi dòng: path + relevance score (0-1) + signal tag (workspace/dep/submodule/docker/ts-ref); (3) **trigger-file gating** — `suggestDirs(root)` trước tiên kiểm tra sự tồn tại của từng manifest (package.json, .gitmodules, docker-compose.yml, tsconfig.json, settings.gradle) — collector nào không có file thì không chạy; (4) **score hiển thị minh bạch** — user thấy lý do, không mù tin. Nối ACI (heuristic engine) — ACJ là UI + gating cho ACI.

## Kiến trúc

```
  /suggest-dirs
       ▼
  TRIGGER-FILE GATE (pre-scan optimization)
    ├─ package.json  có?  ──▶ npm collector chạy
    ├─ .gitmodules   có?  ──▶ submodule collector chạy
    ├─ docker-compose.yml? ─▶ docker collector chạy
    └─ …không có file ──▶ skip collector (0ms chi phí)
       ▼
  SUGGESTIONS (ranked theo confidence)
       ▼
  UI TABLE
    path        relevance  signal
    ../shared   0.95       git-submodule
    lib/ui      0.90       workspace-member
    vendor      0.85       local-dep (file:)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/print command-registry.ts — command registry (nền — đăng ký /suggest-dirs)
// ✅ packages/print agents-panel.ts — renderAgentsPanel + PanelItem (nền — bảng UI)
// ✅ packages/tools find.ts — existsSync helpers (nền — trigger-file gate)
// ✅ packages/intercom ui/session-list.ts — list rendering (nền — suggestion list)
// ✅ packages/core laneboard.ts — classification (nền — score display pattern)

// ❌ THIẾU: /suggest-dirs command + scored table render
// ❌ THIẾU: trigger-file gating trong suggestDirs (pre-scan opt)
// ❌ THIẾU: relevance score display (signal tag + confidence)
```
## Implementation
```typescript
// packages/print/src/suggest-dirs.ts (MỚI)
import { existsSync } from "node:fs";
import { join } from "node:path";
import { suggestDirs, type DirSignal } from "@my-agent/tools";
/** Pre-scan gate — chỉ chạy collector khi trigger file tồn tại. */
const TRIGGER_FILES: Array<{ file: string; signal: DirSignal["signal"] }> = [
  { file: "package.json", signal: "workspace-member" },
  { file: ".gitmodules", signal: "git-submodule" },
  { file: "docker-compose.yml", signal: "docker-context" },
  { file: "tsconfig.json", signal: "ts-ref" },
  { file: "settings.gradle", signal: "gradle" },
];
export function activeCollectors(root: string): string[] {
  return TRIGGER_FILES.filter((t) => existsSync(join(root, t.file))).map((t) => t.signal);
}
export interface SuggestionRow {
  path: string;
  score: number;       // 0..1 relevance
  signal: string;
  reason: string;      // giải thích — không hardcode
}
/** Render /suggest-dirs — bảng có score + signal + reason. */
export async function renderSuggestDirs(root: string): Promise<string[]> {
  const active = activeCollectors(root);
  const signals = await suggestDirs(root, { onlySignals: active });
  if (signals.length === 0) return ["Không tìm thấy directory liên quan (chạy từ git root?)."];
  const rows: SuggestionRow[] = signals.map((s) => ({
    path: s.path,
    score: s.confidence,
    signal: s.signal,
    reason: reasonFor(s),
  }));
  const width = Math.max(...rows.map((r) => r.path.length), 8);
  const lines = ["Suggestions (relevance từ project signals):", ""];
  for (const r of rows) {
    const pct = `${Math.round(r.score * 100)}%`;
    lines.push(`  ${r.path.padEnd(width)}  ${pct.padStart(4)}  ${r.signal.padEnd(18)} ${r.reason}`);
  }
  lines.push("", `Add: /add-dir <path> · active collectors: ${active.join(", ") || "none"}`);
  return lines;
}
function reasonFor(s: DirSignal): string {
  switch (s.signal) {
    case "workspace-member": return "khai báo trong workspaces";
    case "local-dep": return "dependency local (file:/link:/portal:)";
    case "git-submodule": return "git submodule (.gitmodules)";
    case "docker-context": return "build context trong docker-compose";
    case "ts-ref": return "TS project reference";
    case "gradle": return "Gradle multi-project";
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Score + reason minh bạch — user hiểu vì sao gợi ý | ❌ Bảng UI thêm code render cần test |
| ✅ Trigger-file gate — latency giảm 1.85ms → 0.78ms | ❌ Gate phải khớp danh sách collector (dễ lệch) |
| ✅ Không hardcode — mọi score từ tín hiệu thật | ❌ Confidence calibrate thủ công |
| ✅ User thấy active collectors — debug dễ | ❌ Monorepo lớn — nhiều dòng, cần giới hạn hiển thị |

## Khác các hướng gần

| | ACI: heuristic engine | ACJ: Suggestion UI |
|---|---|---|
| Chức năng | Sinh signals (collector + fusion) | **Hiển thị score + reason, gate trigger file** |
| Output | DirSignal[] | **Bảng UI /suggest-dirs** |
| Latency | Không quan tâm | **Pre-scan gate — chỉ chạy collector có file** |
| Quan hệ | Nền | **UI cho ACI** |

## Khi nào chọn

- User cần hiểu vì sao một directory được gợi ý (trust + chọn đúng)
- Lệnh gợi ý chạy thường xuyên — latency phải thấp (gate trigger file)
- Đã có ACI engine — thêm UI scored là bước tự nhiên
- Guard: gate khớp collector, score hiển thị từ tín hiệu (không hardcode), giới hạn dòng
