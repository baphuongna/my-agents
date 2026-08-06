# Hướng IS: Change Preview & Diff — xem diff trước khi apply sửa đổi

> **Nguồn gốc:** Git `diff` / `add -p`; VS Code "Preview Changes"; GitHub PR review; Cursor "Apply" diff preview; GitHub Actions "plan" step; Terraform `terraform plan`
> **Coupling:** 🟡 — chạm tool edit + TUI render
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (hashline-edit-pro diff sẵn — thiếu pre-apply preview gate)
> **Effort:** 2-3 tuần

## Nguồn gốc

Change preview: **agent tính diff trước, user xem, duyệt rồi mới apply** — "prepare, don't submit" (Hướng HR 226). Terraform `plan`: tính changeset (add/change/destroy) trước `apply` — user review resource impact. Git `add -p` (interactive patch): hunk-by-hunk review. Cursor/Cline: agent propose edit → render diff → "Accept/Reject" per hunk. GitHub PR: review diff trước merge. Cốt lõi: **separate compute-change from apply-change** — phase 1 dry-run, phase 2 commit. Giảm blast radius (Hướng IW 257): sai sót phát hiện trước khi ghi đĩa.

## Mô tả

mya change preview: khi agent đề xuất sửa file, tool edit **không ghi ngay** — tính diff (unified/hunk), render trong TUI, chờ user duyệt (accept/reject/edit per hunk). Khi tool có nhiều file → changeset tổng hợp (như Terraform plan). Nối HR (226) approval gate: diff = preview, accept = gate pass. Dùng hashline-edit-pro (đã có diff engine) — thiếu gate "stop trước apply". Diff cũng log vào audit (Hướng 198) để truy vết ai duyệt gì.

## Kiến trúc

```
  AGENT đề xuất edit (file, hunks)
        │
        ▼
  ┌──────────────────────────────────────────┐
  │  COMPUTE DIFF (dry-run — chưa ghi)       │
  │  hashline-edit-pro → unified diff        │
  │  ┌────────────────────────────────────┐  │
  │  │  - const x = 1;                    │  │
  │  │  + const x = 2;                    │  │
  │  │  - deleteMe();                     │  │
  │  └────────────────────────────────────┘  │
  └──────────────────┬───────────────────────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
  ┌───────────┐          ┌──────────────────┐
  │ RISK LOW  │          │  RISK HIGH       │
  │ auto-apply│          │  USER REVIEW     │
  └───────────┘          │  ✓ accept hunk   │
                         │  ✗ reject hunk   │
                         │  ✎ edit hunk     │
                         └────────┬─────────┘
                                  │ approved
                                  ▼
                         ┌──────────────────┐
                         │  APPLY (ghi đĩa) │
                         │  + AUDIT (198)   │
                         └──────────────────┘
```

```
mya: hashline-edit-pro diff sẵn — thiếu: pre-apply gate + hunk-level accept/reject
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ pi-hashline-edit-pro — diff engine (sẵn trong source/)
// ✅ tool edit — ghi file (sẵn)
// ✅ 198 audit-trails — log changes (sẵn)
// ✅ HR (226) approval gates — risk classify (documented)

// ❌ THIẾU: pre-apply preview render (TUI diff view)
// ❌ THIẾU: hunk-level accept/reject/edit (interactive patch)
// ❌ THIẾU: changeset aggregate (multi-file plan like Terraform)
// ❌ THIẾU: dry-run mode (compute diff without side effects)
```

## Implementation

```typescript
// packages/tools/src/edit-preview.ts (NEW)
interface FileDiff {
  path: string;
  hunks: Hunk[];      // each: { oldStart, newStart, lines: ["-x","+y"] }
  action: "modify" | "create" | "delete";
}

export class ChangePreview {
  constructor(private risk: RiskPolicy) {}

  // Phase 1: compute changeset (dry-run — no side effects)
  async plan(edits: Edit[]): Promise<Changeset> {
    const diffs: FileDiff[] = [];
    for (const e of edits) diffs.push(await computeDiff(e)); // hashline-edit-pro
    return { diffs, summary: summarize(diffs) };
  }

  // Phase 2: present → gate → apply (only approved hunks)
  async applyPlan(plan: Changeset): Promise<ApplyResult> {
    const approved: FileDiff[] = [];
    for (const d of plan.diffs) {
      if (this.risk.low(d)) { approved.push(d); continue; }     // auto (low risk)
      const decision = await this.tui.reviewHunks(d);            // gate (HR 226)
      approved.push({ ...d, hunks: decision.accepted });
    }
    for (const d of approved) await writeFile(d.path, applyHunks(d)); // commit
    await audit.log("edit-applied", { files: approved });        // 198
    return { applied: approved.length };
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Sai sót phát hiện trước khi ghi đĩa (Terraform plan) | ❌ Chậm — user phải duyệt từng hunk |
| ✅ Hunk-level control — reject 1 hunk, keep rest (Git add -p) | ❌ Diff noise (large changeset = mệt review) |
| ✅ Audit trail — ai duyệt hunk nào (198) | ❌ Dry-run ≠ thực tế (race condition) |
| ✅ Giảm blast radius (IW 257) | ❌ UX: diff render phức tạp trong TUI |

## Khác các hướng gần

| | HR (226) Approval Gate | Edit Tool (ghi ngay) | IS: Change Preview |
|---|---|---|---|
| Khi dừng | Trước hành động rủi ro | ❌ (ghi luôn) | **Trước mọi edit (diff)** |
| Granularity | Per-action | Per-file | **Per-hunk** |
| Dry-run | ⚠️ | ❌ | ✅ plan phase |

## Khi nào chọn

- Agent sửa code/file — cần review trước apply
- Multi-file changeset (Terraform-style plan)
- Cần hunk-level accept/reject (không all-or-nothing)
- Nối HR (226) gate + IW (257) blast radius + 198 audit
