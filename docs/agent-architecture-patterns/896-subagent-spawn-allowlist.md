# Hướng AHL: Subagent Spawn Allowlist — worker agent khai báo `subagent_agents` frontmatter chỉ được spawn scout/researcher; allowlist truyền qua env PI_SUBAGENT_ALLOWED xuống child, child filter registry trước khi tool description lộ ra LLM

> **Nguồn gốc:** pi-subagents | **Coupling:** 🟡 — bind vào spawn boundary + tool registry | **Agent-agnostic:** ❌ (cốt lõi agent spawn) | **Code sẵn:** ⚠️ (mya có allowedTools + maxSpawnDepth, nhưng KHÔNG có agent-type spawn allowlist) | **Effort:** 1 tuần

## Nguồn gốc

**pi-subagents** worker agent khai báo **`subagent_agents`** trong **frontmatter** — danh sách agent mà worker này **được phép spawn** (vd chỉ `scout`, `researcher`). Allowlist này được **truyền qua env `PI_SUBAGENT_ALLOWED`** xuống tiến trình pi con. Điểm tinh tế: child **filter registry TRƯỚC KHI tool description lộ ra LLM** — nghĩa là model con **không bao giờ thấy** agent ngoài danh sách, nên **không thể gọi** agent cấm (không chỉ chặn runtime — ẩn luôn khỏi context model). Defense-in-depth: frontmatter (khai báo) + env (truyền) + registry filter (ẩn khỏi LLM).

Nguyên tắc: **allowlist agent-type** (không phải tool — chỉ định agent nào spawn được); **truyền qua env** (cross-process boundary); **filter TRƯỚC khi LLM thấy** (ẩn description, không chỉ chặn call); **defense-in-depth** (3 lớp).

## Mô tả

Với mya, packages/agent `index.ts` có **`allowedTools`** (tool-level allowlist — restrict tool con dùng được) + **`maxSpawnDepth`** (depth control — chặn đệ quy vô hạn). mya **đã có tool allowlist + depth limit**, nhưng **chưa có** **agent-type spawn allowlist**: (1) `subagent_agents` frontmatter, (2) truyền `PI_SUBAGENT_ALLOWED` env xuống child, (3) child filter registry **trước khi** tool description lộ ra LLM. mya chặn tool nhưng model vẫn thấy/đề xuất mọi agent type.

## Kiến trúc (ASCII)

```
  WORKER agent (frontmatter: subagent_agents: [scout, researcher])
        │
        ▼
  spawn child → env PI_SUBAGENT_ALLOWED="scout,researcher"
        │
        ▼
  CHILD pi process:
    load registry → filter theo PI_SUBAGENT_ALLOWED
        │  (TRƯỚC KHI build tool description cho LLM)
        ▼
  LLM chỉ thấy scout + researcher (agent khác ẩn hoàn toàn)
        │  → KHÔNG THỂ gọi agent ngoài allowlist (không thấy description)
  ── defense-in-depth: frontmatter + env + registry-filter-before-LLM
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/agent/src/index.ts — spawnSubagent(goal, { allowedTools, signal }) (tool allowlist)
// ✅ packages/agent/src/index.ts — maxSpawnDepth (default 2, depth control, line 116-117)
// ✅ packages/agent/src/subagent.test.ts — subagent restriction tested
// ⚠️ KHÔNG có agent-type spawn allowlist (subagent_agents frontmatter)
// ❌ KHÔNG có PI_SUBAGENT_ALLOWED env truyền allowlist xuống child
// ❌ KHÔNG có registry filter TRƯỚC KHI tool description lộ ra LLM
```

## Implementation

```typescript
// packages/agent/src/spawn-allowlist.ts (NEW)
import { spawn } from "node:child_process";

export interface AgentSpawnSpec { name: string; description: string; }

/** Filter registry theo allowlist — TRƯỚC KHI description lộ ra LLM. */
export function filterSpawnable(
  registry: readonly AgentSpawnSpec[],
  allowed?: readonly string[],
): AgentSpawnSpec[] {
  if (!allowed || allowed.length === 0) return [...registry];   // không allowlist = tất cả
  const set = new Set(allowed);
  return registry.filter((a) => set.has(a.name));               // ẩn agent ngoài list
}

/** Parse allowlist từ env PI_SUBAGENT_ALLOWED (child side). */
export function parseAllowedFromEnv(env: NodeJS.ProcessEnv = process.env): string[] | undefined {
  const raw = env.PI_SUBAGENT_ALLOWED;
  if (!raw) return undefined;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Spawn child với allowlist truyền qua env (parent side). */
export function spawnChildWithAllowlist(
  cmd: string[],
  allowed: readonly string[],
): ReturnType<typeof spawn> {
  return spawn(cmd[0]!, cmd.slice(1), {
    env: { ...process.env, PI_SUBAGENT_ALLOWED: allowed.join(",") },
    stdio: "inherit",
  });
}

// Parent: frontmatter.subagent_agents → spawnChildWithAllowlist(cmd, list)
// Child boot: const allowed = parseAllowedFromEnv(); const visible = filterSpawnable(registry, allowed);
//             buildToolDescriptions(visible)  // LLM chỉ thấy allowed agents
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Model con không thấy agent cấm (ẩn description) | ❌ Frontmatter + env + filter 3 lớp (coupling) |
| ✅ Defense-in-depth (không chỉ chặn runtime) | ❌ Allowlist phải sync parent/child đúng |
| ✅ Cross-process boundary (env truyền) | ❌ Agent mới phải add vào allowlist thủ công |

## Khác các hướng gần

| | AHL Spawn Allowlist | AHK Delegated Subagent | AHM Fanout Semaphore |
|---|---|---|---|
| Trọng tâm | Giới hạn agent-type spawnable | Worktree cô lập delegation | Bound parallel subagent |
| Cơ chế | subagent_agents + env + filter-before-LLM | git worktree + spawnSubagent | maxConcurrency semaphore |
| Quan hệ | Nối spawn permission | Nối delegation isolation | Nối parallel bound |

## Khi nào chọn

- Worker agent chỉ được spawn một số agent type (principle of least privilege)
- Cần ẩn agent cấm khỏi LLM (không chỉ chặn call runtime)
- Cross-process spawn boundary (allowlist truyền qua env)
- Guard: frontmatter khai báo, env truyền, filter-before-LLM, kết hợp allowedTools + maxSpawnDepth
