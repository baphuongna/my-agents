# Hướng AIO: Worktree-Theme-Dev — theme pack phát triển trong git worktree của pi-themes repo (commit "feat: add tokyo miasma and solarized themes") — nhiều theme được thêm/điều chỉnh trên branch riêng trước khi merge, preview images trong docs/assets theo từng theme

> **Nguồn gốc:** pi-themes-worktree | **Coupling:** 🟢 — dev workflow | **Agent-agnostic:** ✅ | **Code sẵn:** N/A (workflow, không code) | **Effort:** 0 tuần (convention)

## Nguồn gốc

**pi-themes-worktree** theme pack phát triển trong **git worktree** của pi-themes repo (commit "feat: add tokyo miasma and solarized themes") — nhiều theme được **thêm/điều chỉnh trên branch riêng trước khi merge**, **preview images trong docs/assets** theo từng theme. Nguyên tắc: **worktree isolation** — mỗi theme/dev branch worktree riêng (không clobber main); **branch-before-merge** — theme trên branch, preview, review, rồi merge; **preview images** — docs/assets screenshot per theme (visual QA); **parallel dev** — nhiều theme song song (worktree độc lập).

## Mô tả

Với mya, pattern = **theme dev workflow via git worktree**: (1) đây là **dev workflow convention**, không phải code pattern — mya áp dụng cho package dev nói chung; (2) AIO document: theme pack trong git worktree, mỗi theme branch riêng; (3) **worktree per theme** — `git worktree add ../pi-themes-tokyo` → dev tokyo; (4) **preview assets** — `docs/assets/tokyo-night.png` screenshot; (5) **branch → review → merge** — không dev trực tiếp main; (6) nối AIM/AIN — theme JSON + discovery được dev trong worktree này.

## Kiến trúc (ASCII)

```
  pi-themes/ (main repo)
    ├─ themes/*.json        (AIM semantic palette — merged)
    ├─ docs/assets/*.png    (preview per theme)
    └─ worktrees:
        ├─ ../pi-themes-tokyo/   (branch: feat/tokyo-miasma)
        │    └─ themes/tokyo-miasma.json (DEV — riêng, không clobber main)
        ├─ ../pi-themes-solar/   (branch: feat/solarized)
        │    └─ themes/solarized.json (DEV song song)
        └─ ../pi-themes-fix/     (branch: fix/tokyo-contrast)
  Workflow:
    worktree add ──► dev theme + preview screenshot ──► branch review ──► MERGE to main
  (mỗi theme worktree độc lập — dev song song, không clobber)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/pkg — themes = PackageKind (theme package model)
// ✅ AIM semantic-color-vars — theme JSON format (target dev)
// ✅ AIN theme-discovery-manifest — pi.themes (target dev)
// ✅ CONTRIBUTING.md — dev workflow docs (nền convention)

// ❌ KHÔNG ÁP DỤNG CODE: đây là dev workflow convention (worktree + branch)
// ❌ THIẾU: theme preview screenshot convention (docs/assets per theme) — optional
```

## Implementation

```bash
# Dev workflow convention — KHÔNG code, git commands + convention.
# 1. Tạo worktree cho theme mới (isolation — không clobber main):
git worktree add ../pi-themes-<name> -b feat/<name>
cd ../pi-themes-<name>

# 2. Dev theme JSON (AIM format):
cat > themes/<name>.json <<'EOF'
{
  "accent": "#...", "toolSuccessBg": "#...", "toolErrorBg": "#...",
  "pi": { "themes": ["./themes"] }
}
EOF

# 3. Preview screenshot (docs/assets per theme):
#    (chạy Pi với theme, screenshot → docs/assets/<name>.png)

# 4. Commit + branch review:
git add themes/<name>.json docs/assets/<name>.png
git commit -m "feat: add <name> theme"
#    → PR review → MERGE to main (không dev trực tiếp main)

# 5. Cleanup worktree:
git worktree remove ../pi-themes-<name>
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Worktree isolation — không clobber main | ❌ Nhiều worktree — disk space |
| ✅ Dev song song (mỗi theme worktree riêng) | ❌ Sync worktree khi main đổi (rebase) |
| ✅ Preview screenshot — visual QA | ❌ Screenshot manual (không auto) |
| ✅ Branch review trước merge | ❌ Workflow overhead cho theme nhỏ |

## Khác các hướng gần

| | AIO Worktree-Theme-Dev | AIM Semantic-Color-Vars | AIN Theme-Discovery-Manifest |
|---|---|---|---|
| Trọng tâm | Dev workflow (worktree) | Biến ngữ nghĩa render | Discover theme package |
| Cơ chế | git worktree + branch + preview | Standard palette + JSON | pi.themes manifest |
| Quan hệ | Dev (tạo theme) | Render (dùng theme) | Discovery (tìm theme) |

## Khi nào chọn

- Phát triển nhiều theme song song → cần isolation (worktree)
- Muốn branch review trước merge (không dev trực tiếp main)
- Visual QA — preview screenshot per theme
- Guard: worktree cleanup, rebase khi main đổi, preview in docs/assets, branch naming convention
