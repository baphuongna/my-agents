# Hướng ZN: Blocker-vs-Deferrable Triage — khi phát hiện side work giữa task: phân loại ngay blocker (pause + switch) hay deferrable (file + continue) — chống cả scope creep lẫn context loss
> **Nguồn gốc:** beads (research.md) | **Coupling:** 🟢 — triage helper trong agent loop | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (agent loop + session-branch — chưa có triage quyết định) | **Effort:** 1-2 tuần

## Nguồn gốc

**beads** nhận ra: giữa task chính, agent luôn gặp **side work** (issue phụ, câu hỏi, bug nhỏ). Xử lý sai 2 hướng: (1) **làm luôn** → **scope creep** (task chính chết, context tràn); (2) **bỏ qua hoàn toàn** → **context loss** (side work đáng giá bị quên). Giải pháp **triage ngay lúc phát hiện**: phân loại thành (a) **blocker** — side work **chặn task chính** (không xử lý thì không xong) → **pause** task chính + **switch** sang blocker, xử lý xong quay lại; (b) **deferrable** — không chặn → **file** (ghi vào task graph/pending list) + **continue** task chính, xử lý sau. Nguyên tắc: **triage ngay — blocker thì switch, deferrable thì file rồi tiếp tục**.

## Mô tả

mya blocker-vs-deferrable triage: (1) **Detect side work** — agent gặp việc phụ giữa task. (2) **Triage** — đánh giá: có chặn task chính không? (dependency, error chặn, thiếu input). (3) **Blocker path** — pause task chính (lưu resume note — nối ZL), chạy side work, xong quay lại. (4) **Deferrable path** — ghi pending (task graph/note) + continue. mya có core/session.ts + session-branch.ts + agent loop — ZN thêm **triage helper** + **pending registry** + **pause/resume contract**.

## Kiến trúc

```
  TASK CHÍNH đang chạy
  ┌─────────────────────────────────────────────────┐
  │  gặp SIDE WORK giữa chừng                         │
  └────────────────────┬────────────────────────────┘
                       ▼ TRIAGE (ngay lúc phát hiện)
  ┌────────────────────┴────────────────────────────┐
  │  BLOCKER? (chặn task chính)                      │
  │  ┌── yes ───────────────────────┐ ┌── no ────┐  │
  │  │ PAUSE task chính (resume note)│ │ FILE side │  │
  │  │ SWITCH → xử lý blocker        │ │ work      │  │
  │  │ xong → quay lại task chính    │ │ CONTINUE  │  │
  │  └───────────────────────────────┘ │ task chính│  │
  │                                     └──────────┘  │
  └──────────────────────────────────────────────────┘
  chống scope creep (deferrable không làm luôn)
  chống context loss (file lại, không quên)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/core session.ts — createSession (nền — ZN pause/resume)
// ✅ packages/core session-branch.ts — branch/delegate markers (nền — ZN switch task)
// ✅ packages/agent index.ts — agent loop (nền — ZN triage trong loop)
// ✅ packages/core loop.ts — runTurn (nền — ZN hook triage)
// ✅ packages/memory sqlite-store.ts — persistent (nền — ZN pending registry)

// ❌ THIẾU: triage helper (phân loại blocker/deferrable chuẩn)
// ❌ THIẾU: pending registry (deferrable file lại, không quên)
// ❌ THIẾU: pause/resume contract (pause lưu trạng thái, resume nối lại)
```

## Implementation

```typescript
// packages/core/src/side-work-triage.ts (MỚI)

type TriageVerdict = "blocker" | "deferrable";

interface SideWork { id: string; description: string; blocksMain?: boolean; urgency: "high" | "low" }

class SideWorkTriage {
  constructor(
    private pending: { add(w: SideWork): Promise<void>; list(): Promise<SideWork[]> },
    private pauseMain: (note: string) => Promise<void>,
    private resumeMain: () => Promise<void>,
  ) {}

  // Triage ngay: blocker → pause+switch; deferrable → file+continue
  async triage(work: SideWork): Promise<{ verdict: TriageVerdict; action: string }> {
    if (work.blocksMain || work.urgency === "high") {
      await this.pauseMain(`paused for blocker: ${work.description}`);  // lưu trạng thái task chính
      await this.resumeMain();                                          // (placeholder — thực tế: switch context)
      return { verdict: "blocker", action: "switch" };
    }
    await this.pending.add(work);          // file lại — không quên, không làm luôn
    return { verdict: "deferrable", action: "continue" };
  }

  // Sau task chính: xử lý pending (deferrable) — không scope creep giữa chừng
  async drainPending(): Promise<SideWork[]> {
    const list = await this.pending.list();
    for (const w of list) {
      // (thực tế: giao cho agent/subagent riêng hoặc human quyết định)
      console.log(`[triage] deferred work còn lại: ${w.id} — ${w.description}`);
    }
    return list;
  }
}
// Usage (trong agent loop khi phát hiện side work):
// const triage = new SideWorkTriage(pendingRegistry, pauseSession, resumeSession);
// const { verdict, action } = await triage.triage({ id: "sw-1", description: "bug nhỏ ở logger", urgency: "low" });
// // deferrable → file + continue (không làm luôn, không quên)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chống scope creep (deferrable không làm luôn) | ❌ Triage sai → blocker bị coi là deferrable (task chính kẹt) |
| ✅ Chống context loss (file lại, không quên) | ❌ Pending nhiều → backlog phình (phải drain) |
| ✅ Quyết định ngay (không suy nghĩ giữa task) | ❌ Pause/resume phải lưu đúng trạng thái (sai → mất tiến độ) |
| ✅ Task chính tập trung (không bị cắt ngang) | ❌ Side work urgent nhưng không "blocks" → chờ lâu |

## Khác các hướng gần

| | Làm luôn side work | Bỏ qua side work | ZN: Triage |
|---|---|---|---|
| Scope creep | ✅ bị | ✅ tránh | **✅ tránh** |
| Context loss | ✅ tránh | ✅ bị | **✅ tránh** |
| Quyết định | Không | Không | **Ngay lúc phát hiện** |

## Khi nào chọn

- Task dài hay gặp side work (bug phụ, câu hỏi, việc đáng giá)
- Muốn task chính không bị cắt ngang nhưng không quên việc phụ
- Cần phân loại blocker (phải xử lý) vs deferrable (xử lý sau)
- Nối packages/core session.ts + session-branch.ts + agent index.ts + loop.ts + memory sqlite-store.ts; guard triage-accuracy (đánh giá blocksMain đúng), pause-resume-correctness (trạng thái lưu/khôi phục đủ), và pending-drain (backlog không phình vô hạn); ZN = blocker-vs-deferrable triage, kết hợp 688 ZL compaction-survival-notes (pause lưu note) + 687 ZK graph-task-dependencies (deferrable vào task graph)
