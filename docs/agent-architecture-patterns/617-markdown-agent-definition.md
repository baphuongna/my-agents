# Hướng WS: Markdown Agent Definition — agents/*.md định nghĩa agent (mode primary/subagent/all, permission ruleset, model override)

> **Nguồn gốc:** opencode `agents/*.md` (markdown file định nghĩa agent; frontmatter: mode primary/subagent/all, permission ruleset, model override); "agents/*.md define agent", "mode primary/subagent/all", "permission ruleset", "model override" | **Coupling:** 🟢 — thêm markdown agent-definition loader vào agent system | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (agent + skills frontmatter sẵn — chưa có agents/*.md definition + mode/permission/model fields) | **Effort:** 2 tuần

## Nguồn gốc

**opencode** agent được định nghĩa bằng **markdown file** trong `agents/` directory (vd `agents/researcher.md`, `agents/coder.md`). Mỗi file có **frontmatter**: (1) **`mode`**: `primary` (agent chính, user-facing), `subagent` (chỉ dùng khi spawn by parent), `all` (cả hai). (2) **`permission` ruleset**: tool permission (vd `tools: [read, grep]` — agent này chỉ được read/grep, không write). (3) **`model` override**: agent dùng model riêng (vd `model: "gpt-4o"` — coder dùng model mạnh, researcher dùng model rẻ). Body markdown = system prompt. Nguyên tắc: **declarative agent definition** — markdown config, không code.

## Mô tả

mya markdown agent definition: (1) **agents/*.md**: scan directory → mỗi file = 1 agent definition. (2) **Frontmatter parse**: `mode`, `permission` (tools), `model` override, `description`. (3) **Agent registry**: load → register vào agent registry (name → definition). (4) **Spawn by definition**: parent spawn subagent → lookup definition → apply (mode check, permission, model override). (5) **Primary select**: user-facing → primary agent (mode primary/all). mya có agent + skills frontmatter — WS thêm **agents/*.md loader** + **mode/permission/model fields** + **definition-driven spawn**.

## Kiến trúc

```
  agents/researcher.md          agents/coder.md
  ┌─ frontmatter ───────────┐   ┌─ frontmatter ─────────────┐
  │ mode: subagent          │   │ mode: all                 │
  │ model: gpt-4o-mini      │   │ model: claude-sonnet      │
  │ tools: [read, grep]     │   │ tools: [read,write,bash]  │
  └─ body: system prompt ───┘   └─ body: system prompt ─────┘
        │ (scan agents/ → load)        │
        ▼                              ▼
  ┌─── AGENT REGISTRY (name → definition) ───────────────┐
  └───────────────┬─────────────────────────────────────┘
                  ▼ spawn("researcher", asSubagent=true)
  ┌─── APPLY definition ─────────────────────────────────┐
  │  mode check: subagent → OK (spawn by parent)          │
  │  tools filter: [read, grep] (read-only)               │
  │  model override: gpt-4o-mini                          │
  │  system prompt: body markdown                         │
  └────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/agent sdk.ts — agent spawn (nền — WS definition-driven spawn)
// ✅ packages/skills skill.ts — frontmatter parse (nền — WS frontmatter reuse)
// ✅ packages/prompts — system prompt (nền — WS body = prompt)
// ✅ packages/tools permission.ts — permission (nền — WS tools ruleset)
// ✅ packages/ai — model selection (nền — WS model override)

// ❌ THIẾU: agents/*.md loader (scan → parse frontmatter + body)
// ❌ THIẾU: mode field (primary/subagent/all gate)
// ❌ THIẾU: definition-driven spawn (lookup → apply mode/tools/model)
```

## Implementation

```typescript
// packages/agent/src/markdown-agent-definition.ts (MỚI)
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

type AgentMode = "primary" | "subagent" | "all";

interface AgentDefinition {
  name: string;
  mode: AgentMode;
  description: string;
  model?: string;        // override (undefined = inherit)
  tools: string[];       // permission ruleset
  systemPrompt: string;  // body markdown
}

// parse frontmatter + body from markdown
function parseAgentMd(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  const fm: Record<string, unknown> = {};
  for (const line of match[1]!.split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { frontmatter: fm, body: match[2]!.trim() };
}

class MarkdownAgentRegistry {
  private defs = new Map<string, AgentDefinition>();

  // scan agents/ → load definitions
  loadDir(dir: string): void {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".md")) continue;
      const { frontmatter, body } = parseAgentMd(readFileSync(join(dir, file), "utf8"));
      const name = file.replace(/\.md$/, "");
      this.defs.set(name, {
        name, mode: (frontmatter.mode as AgentMode) ?? "all",
        description: (frontmatter.description as string) ?? "",
        model: frontmatter.model !== "inherit" ? frontmatter.model as string : undefined,
        tools: (frontmatter.tools as string)?.replace(/[\[\]]/g, "").split(",").map(s => s.trim()) ?? ["all"],
        systemPrompt: body,
      });
    }
  }

  // spawn by definition — apply mode/tools/model
  resolve(name: string, asSubagent: boolean): AgentDefinition | null {
    const def = this.defs.get(name);
    if (!def) return null;
    if (asSubagent && def.mode === "primary") return null; // primary-only → can't be subagent
    if (!asSubagent && def.mode === "subagent") return null; // subagent-only → can't be primary
    return def; // mode all → both OK
  }
}

// Usage:
// const registry = new MarkdownAgentRegistry();
// registry.loadDir("./agents");
// const coder = registry.resolve("coder", true); // subagent spawn
// // → apply: tools filter [read,write,edit,bash], model "claude-sonnet"
```

## Được

- ✅ Declarative (markdown config — không code, dễ chỉnh)
- ✅ Mode gating (primary/subagent/all — spawn rule rõ)
- ✅ Per-agent permission (tools ruleset — least privilege per agent)
- ✅ Model override (agent dùng model phù hợp — coder mạnh, researcher rẻ)

## Mất

- ❌ Definition sprawl (nhiều agent → nhiều file — quản lý)
- ❌ Frontmatter drift (field sai → parse fail silently)
- ❌ Permission bypass risk (tools: [all] → quá rộng)
- ❌ Model cost (override → agent dùng model đắt — cost)

## Khác

Khác **611 WM subagent-depth-gating** (depth limit spawn) — WS **agent definition** (who/what spawn, không depth). Khác **skills SKILL.md** (skill = tool+content) — WS **agent definition** (agent = system prompt+mode+permission). Khác **hardcoded agent** (code-defined) — WS **markdown-declared** (config, không code).

## Khi nào chọn

- Nhiều agent type (researcher, coder, reviewer) → định nghĩa declarative
- Muốn per-agent permission (least privilege — researcher read-only)
- Cần model override (agent dùng model phù hợp — cost optimization)
- Nối packages/agent sdk.ts + packages/skills skill.ts (frontmatter) + packages/prompts + tools permission.ts + packages/ai; guard frontmatter-validation (field sai → error rõ), permission-default-safe (default least privilege — không [all] mặc định), và model-cost-awareness (override → cost check); WS = markdown agent definition, kết hợp 611 WM subagent-depth-gating (spawn rule) + WJ skill-description-only-discovery (discovery analog)
