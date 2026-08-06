# Hướng ABZ: Frontmatter-Driven Subagent Discovery — subagent định nghĩa bằng markdown + YAML frontmatter (name/model/thinking/tools/skills/compaction/interactive), discover từ 3 nguồn theo priority

> **Nguồn gốc:** pi-crew (README.md) | **Coupling:** 🟡 — thêm agent definition discovery vào subagent spawn | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có skill frontmatter + role-subagent — chưa có agent md discovery) | **Effort:** 2 tuần

## Nguồn gốc

**pi-crew** định nghĩa subagent bằng **markdown file có YAML frontmatter**: `name, model, thinking, tools, skills, compaction, interactive`. Subagent được **discover từ 3 nguồn theo priority**: (1) **project** `.pi/agents/*.md` > (2) **user global** `~/.pi/agent/agents/*.md` > (3) **bundled**. Cho phép **override bundle subagent chỉ bằng cách đặt file trùng tên** — đặt `scout.md` trong project là thay thế scout bundled. Nguyên tắc: **subagent = markdown + frontmatter, discovery theo priority, override bằng trùng tên**.

## Mô tả

mya frontmatter-driven subagent discovery: subagent definitions là **markdown + YAML frontmatter** (name, model, thinking, tools, skills, compaction, interactive); discovery quét **3 nguồn theo priority** — project `.mya/agents/*.md` > user `~/.mya/agents/*.md` > bundled; **trùng tên → nguồn priority cao hơn thắng** (override). mya có packages/skills skill.ts (SKILL.md frontmatter parse — pattern y hệt) + packages/print role-subagent-spawn.ts (spawn role) + packages/prompts assembler.ts — ABZ thêm **agent frontmatter shape** (model/thinking/tools/skills/compaction/interactive) + **3-nguồn discovery** + **override-by-name**.

## Kiến trúc

```
  SUBAGENT DEFINITION (markdown + YAML frontmatter)
  ┌────────────────────────────────────────┐
  │ ---  name: scout · model: haiku-4-5   │
  │ thinking: true · tools: [read,grep]   │
  │ skills: [codebase] · interactive: false│
  │ ---  System prompt cho subagent       │
  └────────────────────┬───────────────────┘
                       ▼
  DISCOVERY (3 nguồn theo priority)
    1. project .mya/agents/*.md  (cao nhất)
    2. user    ~/.mya/agents/*.md
    3. bundled (built-in — thấp nhất)
       │  trùng tên → priority cao thắng
       ▼
  SPAWN ──► subagent với config từ frontmatter
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills skill.ts — SKILL.md frontmatter parse (nền — ABZ frontmatter pattern)
// ✅ packages/print role-subagent-spawn.ts — spawn role-subagent (nền — ABZ spawn path)

// ❌ THIẾU: agent frontmatter shape (model/thinking/tools/skills/compaction/interactive)
// ❌ THIẾU: 3-nguồn discovery (project > user > bundled)
// ❌ THIẾU: override-by-name (trùng tên → priority cao thắng)
```

## Implementation

```typescript
// packages/agent/src/agent-discovery.ts (MỚI)
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface AgentDefinition {
  name: string;
  description: string;
  model?: string;
  thinking?: boolean;
  tools?: string[];
  skills?: string[];
  compaction?: "auto" | "off";
  interactive?: boolean;
  systemPrompt: string;
  source: "project" | "user" | "bundled";
}

/** Parse markdown + YAML frontmatter → AgentDefinition. */
export function parseAgentMd(content: string, source: AgentDefinition["source"]): AgentDefinition | null {
  const m = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return null;
  const fm = new Map(m[1]!.split("\n").map(l => {
    const [k, ...v] = l.split(":");
    return [k!.trim(), v.join(":").trim()];
  }));
  const name = fm.get("name");
  if (!name) return null;
  return {
    name,
    description: fm.get("description") ?? "",
    model: fm.get("model"),
    thinking: fm.get("thinking") === "true",
    tools: fm.get("tools")?.replace(/[\[\] ]/g, "").split(",").filter(Boolean),
    skills: fm.get("skills")?.replace(/[\[\] ]/g, "").split(",").filter(Boolean),
    compaction: fm.get("compaction") === "off" ? "off" : "auto",
    interactive: fm.get("interactive") === "true",
    systemPrompt: m[2]!.trim(),
    source,
  };
}

/** Discovery 3 nguồn theo priority: project > user > bundled. Trùng tên → priority cao thắng. */
export function discoverAgents(cwd: string, bundled: AgentDefinition[]): Map<string, AgentDefinition> {
  const out = new Map<string, AgentDefinition>();
  for (const def of bundled) out.set(def.name, def); // bundled trước (thấp nhất)
  for (const [dir, source] of [[join(homedir(), ".mya", "agents"), "user"], [join(cwd, ".mya", "agents"), "project"]] as const) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter(f => f.endsWith(".md"))) {
      const def = parseAgentMd(readFileSync(join(dir, file), "utf8"), source);
      if (def) out.set(def.name, def); // project ghi đè user, user ghi đè bundled (override)
    }
  }
  return out;
}
// Usage:
// const agents = discoverAgents(process.cwd(), bundledScout);
// agents.get("scout")!.source === "project"; // project scout.md override bundled
// spawnSubagent(agents.get("scout")!); // dùng config từ frontmatter
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Khai báo được (markdown + frontmatter — review/version-controlled) | ❌ Frontmatter parse (format sai → subagent mất config) |
| ✅ Override dễ (đặt file trùng tên — không sửa code) | ❌ Priority surprise (user quên project override → hành vi khác) |
| ✅ 3 nguồn rõ (project > user > bundled — scope phân cấp) | ❌ Validation thiếu (model/tools sai tên → lỗi lúc spawn) |
| ✅ Agent-agnostic (markdown thuần — không phụ thuộc runtime) | ❌ Discover mỗi lần (file mới → phải quét lại — như pi-crew) |

## Khác các hướng gần

| | Hardcode subagent (code) | Skill frontmatter (SKILL.md) | ABZ: Agent md Discovery |
|---|---|---|---|
| Định nghĩa | code | skill | **markdown + frontmatter** |
| Override | sửa code | curator | **đặt file trùng tên** |
| Nguồn | 1 | 1-2 | **3 (project > user > bundled)** |
| Config | ít | skill-focused | **model/thinking/tools/skills/compaction/interactive** |

## Khi nào chọn

- Muốn subagent config được bằng file (không hardcode — team review được)
- Cần override per-project (project muốn scout khác — đặt file là xong)
- Nối packages/skills skill.ts + packages/print role-subagent-spawn.ts + packages/prompts assembler.ts; guard frontmatter-validation (validate model/tools/name trước spawn), priority-transparency (override phải log), và interactive-semantics (interactive:true → subagent chờ user); ABZ = frontmatter-driven subagent discovery, kết hợp 753 ABY nonblocking-subagent-steering (subagent → chạy nền) + 636 XL skill-frontmatter-portability (frontmatter portable)
