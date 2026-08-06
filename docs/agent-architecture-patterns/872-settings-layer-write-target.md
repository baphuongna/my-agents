# Hướng AGN: Settings Layer Write-Target — merge global + project config, ghi vào nơi key đã tồn tại để không phá cấu hình người dùng

> **Nguồn gốc:** pi-powerline-footer | **Coupling:** 🟢 — config layer thuần | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (mya có intercom config + env override, nhưng KHÔNG có write-target heuristic) | **Effort:** 0.5 tuần

## Nguồn gốc

**pi-powerline-footer** đọc config **merge** hai lớp: global (`~/.pi/agent/settings.json`) + project (`.pi/settings.json`). Điểm tinh tế nằm ở **ghi**: khi cần persist setting mới, hệ thống **chọn project file nếu key `powerline` đã tồn tại ở đó**, ngược lại ghi **global**. Lý do: tránh ghi nhầm sang project (làm repo dính config cá nhân) hoặc ghi global (phá cấu hình project có sẵn). Write-target theo "nơi key đã sống" → setting về đúng chỗ nó thuộc về.

Nguyên tắc: **đọc merge nhiều lớp** (global < project precedence); **ghi theo nơi key đã tồn tại** (không tạo dup/migration ngầm); **default = global** (project chỉ khi key đã ở đó); **không phá config người dùng** ở lớp khác.

## Mô tả

Với mya, packages/intercom có `config.ts` (đọc config, env override như `PI_INTERCOM_ASK_TIMEOUT_MS`) và packages/print `cli.ts` xử lý env. Nhưng mya **chưa có** write-target heuristic rõ ràng: khi user đổi một setting qua UI/command, quyết định **ghi global hay project** dựa trên "key đã sống ở đâu". Pattern này tránh tình trạng: đổi 1 setting vô tình commit vào repo (ghi project) hoặc mất tính project-local (ghi global).

## Kiến trúc (ASCII)

```
  ┌─ READ ────────────────────────────┐
  │ global (~/.pi/agent/settings.json)│  merge: project > global
  │ project (.pi/settings.json)       │
  └───────────────────────────────────┘
              │  config = {...global, ...project}
              ▼
  ┌─ WRITE (đổi key K) ───────────────┐
  │ K đã ở project? → ghi project     │
  │ K chưa có đâu? → ghi global       │  ← không phá config người dùng
  └───────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/intercom/src/config.ts — đọc config + env override (PI_INTERCOM_*)
// ✅ packages/print/src/cli.ts — env override (env wins, line 45)
// ✅ packages/tools/src/kanban.ts — readFileSync/writeFileSync config pattern
// ❌ KHÔNG có write-target heuristic (global/project theo nơi key đã sống)
// ❌ KHÔNG có merge global + project settings thành 1 view khi ghi
```

## Implementation

```typescript
// packages/core/src/settings-layers.ts (NEW)
import { readFileSync, writeFileSync, existsSync } from "node:fs";

export interface LayeredSettings { [k: string]: unknown; }

export function readMerged(globalPath: string, projectPath: string): LayeredSettings {
  const load = (p: string): LayeredSettings =>
    existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
  return { ...load(globalPath), ...load(projectPath) };        // project > global
}

/** Ghi key K vào lớp nơi K đã tồn tại; default global nếu chưa có đâu. */
export function writeTargeted(
  key: string,
  value: unknown,
  globalPath: string,
  projectPath: string,
): void {
  const global = existsSync(globalPath) ? JSON.parse(readFileSync(globalPath, "utf8")) : {};
  const project = existsSync(projectPath) ? JSON.parse(readFileSync(projectPath, "utf8")) : {};

  const inProject = Object.prototype.hasOwnProperty.call(project, key);
  const target = inProject ? project : global;                  // nơi key đã sống
  target[key] = value;
  const path = inProject ? projectPath : globalPath;
  writeFileSync(path, JSON.stringify(target, null, 2) + "\n");
}
// UI đổi setting → writeTargeted(k, v, global, project) → đúng lớp, không dup.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Setting về đúng lớp nó thuộc về | ❌ Phải scan cả 2 file mỗi ghi (O(file size)) |
| ✅ Không commit vô tình config cá nhân vào repo | ❌ User muốn "move to project" phải migrate thủ công |
| ✅ Đọc merge nhất quán (project > global) | ❌ Key mới luôn rơi global (default) — có thể không đúng ý |

## Khác các hướng gần

| | AGN Write-Target | AGT Env-Precedence | AHC Deep-Merge |
|---|---|---|---|
| Trọng tâm | Chọn nơi ghi | Thứ tự ưu tiên đọc | Merge lồng nhau an toàn |
| Cơ chế | Key-sống-ở-đâu | File > theme, env override | Recursive merge skip undefined |
| Quan hệ | Nối persistence | Nối precedence | Nối merge semantics |

## Khi nào chọn

- Setting có 2 lớp (global cá nhân + project repo) — cần ghi đúng chỗ
- Tránh commit config cá nhân vô tình vào repo
- User đổi setting qua UI — phải persist không phá lớp kia
- Guard: read merge project>global, write theo key-sống-ở-đâu, default global
