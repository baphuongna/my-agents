# Hướng AKP: Persistence Loop Ralph — `vetc-ralph` là persistence loop: implement đến hoàn thành + verified, tiến độ ghi vào `specs/features/*/ralph-progress.json`, SessionStart hook đọc progress file hỏi user có resume không

> **Nguồn gốc:** vetc-dev-kit (README.md, hooks/hooks.json) | **Coupling:** 🟡 — loop + progress persist + resume | **Agent-agnostic:** ⚠️ (phụ thuộc model + verify) | **Code sẵn:** ⚠️ (có runTurn loop + iteration-budget; thiếu progress persist) | **Effort:** 2 tuần

## Nguồn gốc

**vetc-dev-kit** có **`vetc-ralph`** — **persistence loop**: (1) **implement đến hoàn thành + verified** — loop giữ task tới khi xong và có bằng chứng verify (nối 783 Ralph — cùng tên Ralph: self-referential loop); (2) **tiến độ ghi vào `specs/features/*/ralph-progress.json`** — mỗi bước, progress (đã làm gì, đến đâu, còn gì) được ghi vào file JSON theo feature; (3) **SessionStart hook đọc progress file và hỏi user có resume không** — session mới bắt đầu: đọc progress còn dang dở → hỏi "resume task X?" — work-in-progress state **sống sót qua session**; (4) **crash/restart không mất tiến độ** — progress trên đĩa, không trong memory.

Giá trị: (1) **không bỏ cuộc giữa chừng** — persistence loop tới verified; (2) **WIP sống qua session** — đóng máy/đổi session vẫn resume được; (3) **resume có ngữ cảnh** — progress file cho session sau biết chính xác tiếp tục từ đâu; (4) **audit tiến độ** — file JSON là lịch sử làm được gì.

## Mô tả

Với mya, pattern = **progress-persisted persistence loop**: (1) **loop core** — tái dùng `packages/core` (runTurn + iteration-budget — đã có loop); thêm contract: complete? verify (nối AJZ/AKN evidence gate) → xong; (2) **progress file** — mỗi feature: `specs/features/<feature>/ralph-progress.json`: `{ status, stepsDone, currentStep, verified, updatedAt }` — ghi sau mỗi vòng (mẫu snapshot — 783 Ralph); (3) **SessionStart hook** — mya có lifecycle (cron/agent tools; hooks preTool/postTool) — thêm session-start: scan `specs/features/*/ralph-progress.json` có status != done → hỏi user resume (nối approval — `packages/tools/src/approval.ts`); (4) **resume** — user đồng ý → nạp progress → chạy tiếp từ currentStep (không làm lại); (5) nơi gắn — `packages/workflows` (loop wrapper), `packages/core` (iteration-budget — giới hạn vòng), `packages/tools` (approval cho resume hỏi). Đây là pattern **durable task state**: tiến độ là file có thể đọc lại, không phải trạng thái trong RAM.

## Kiến trúc (ASCII)

```
  TASK (feature X)
    │
    ▼ RALPH LOOP (implement → verify → iterate — nối 783)
  ├─ mỗi vòng: làm bước → GHI PROGRESS
  │     specs/features/X/ralph-progress.json
  │     { status, stepsDone, currentStep, verified, updatedAt }
  └─ complete + verified ──► status: "done" → xong
    │
    ▼ SESSION KẾT THÚC (đóng máy / đổi session)
    (progress đã trên đĩa — WIP sống sót)
    │
    ▼ SESSIONSTART HOOK (session mới)
  ├─ scan specs/features/*/ralph-progress.json
  ├─ status != done ──► HỎI user: "resume task X?" (approval)
  └─ đồng ý ──► nạp progress → tiếp tục từ currentStep (không làm lại)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core/src/loop.ts — runTurn + TurnHandle · iteration-budget.ts (giới hạn vòng)
// ✅ packages/workflows/src/runner.ts — runner · core types.ts ToolHookSink (SessionStart hook)
// ❌ THIẾU: progress file write (ralph-progress.json) · SessionStart scan + resume hỏi · complete→verify→persist
```

## Implementation

```typescript
// packages/workflows/src/ralph-progress.ts (NEW)
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { nowWallclock } from "@my-agent/core";

export type RalphStatus = "in-progress" | "done" | "blocked";
export interface RalphProgress {
  feature: string;
  status: RalphStatus;
  stepsDone: string[];
  currentStep: string | null;
  verified: boolean;
  updatedAt: number;
}

/** Ghi progress — sau mỗi vòng loop, persist xuống đĩa. */
export function writeProgress(featuresDir: string, progress: RalphProgress): string {
  const dir = join(featuresDir, progress.feature);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "ralph-progress.json");
  writeFileSync(path, JSON.stringify({ ...progress, updatedAt: nowWallclock() }, null, 2), "utf8");
  return path;
}

/** SessionStart — scan progress chưa xong → danh sách resume candidates. */
export function scanResumable(featuresDir: string): RalphProgress[] {
  if (!existsSync(featuresDir)) return [];
  return readdirSync(featuresDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(featuresDir, e.name, "ralph-progress.json"))
    .filter((p) => existsSync(p))
    .map((p) => JSON.parse(readFileSync(p, "utf8")) as RalphProgress)
    .filter((p) => p.status !== "done");
}

/** Resume — user đồng ý → nạp progress, tiếp tục từ currentStep. */
export function resumeProgress(progress: RalphProgress, ask: (q: string) => Promise<boolean>): Promise<{ resumed: boolean; progress: RalphProgress }> {
  return ask(`Resume task "${progress.feature}"? Đang ở bước "${progress.currentStep ?? "?"}", ${progress.stepsDone.length} bước đã xong.`)
    .then((yes) => (yes ? { resumed: true, progress } : { resumed: false, progress }));
}

/** Persistence loop — implement tới verified, persist mỗi vòng. */
export async function ralphLoop(progress: RalphProgress, step: (p: RalphProgress) => Promise<{ done: boolean; verified: boolean; stepName: string }>, persist: (p: RalphProgress) => string, maxIterations: number): Promise<RalphProgress> {
  let p = { ...progress };
  for (let i = 0; i < maxIterations; i++) {
    const r = await step(p);                       // implement một bước
    p = {
      ...p,
      stepsDone: r.done ? [...p.stepsDone, r.stepName] : p.stepsDone,
      currentStep: r.done ? null : r.stepName,
      verified: r.verified,
      status: r.done && r.verified ? "done" : "in-progress",
    };
    persist(p);                                    // progress trên đĩa — crash không mất
    if (p.status === "done") break;
  }
  return p;
}
// Nối AJZ: verify trong step() dùng evidence gate — verified chỉ khi có bằng chứng
// Nối approval: resumeProgress nối ApprovalChannel — hỏi user qua humanPrompt
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ WIP sống qua session — đóng máy vẫn resume | ❌ Progress file phát sinh — cần dọn khi done |
| ✅ Resume có ngữ cảnh — biết chính xác tiếp tục từ đâu | ❌ Resume hỏi phiền nếu nhiều task dang dở |
| ✅ Loop tới verified — không bỏ cuộc | ❌ Loop dài tốn token — cần maxIterations |
| ✅ Audit tiến độ — JSON là lịch sử làm được gì | ❌ Progress lệch code (tay sửa) — cần đối chiếu |

## Khác các hướng gần

| | AKP Ralph Progress | 783 Ralph Persistence | 807 Context Save Restore |
|---|---|---|---|
| Trọng tâm | Progress file + resume | Loop + snapshot context | Checkpoint/resume |
| Cơ chế | ralph-progress.json + SessionStart | .omc/context snapshot | Git state + decisions |
| Quan hệ | Persist tiến độ của 783 | Loop nền | Khôi phục session |

## Khi nào chọn

- Task dài qua nhiều session — không muốn làm lại từ đầu khi đóng máy
- Feature có specs/ structure — progress theo feature là tự nhiên
- Muốn session mới tự biết còn việc dang dở (SessionStart scan)
- Guard: progress persist mỗi vòng, resume có ngữ cảnh, verified trước done, maxIterations