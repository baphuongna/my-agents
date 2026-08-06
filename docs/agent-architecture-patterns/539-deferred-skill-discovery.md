# Hướng TS: Deferred Skill Discovery — chỉ liệt kê tên skill trong index nhỏ; agent call describe_skill để lấy metadata khi cần

> **Nguồn gốc:** deer-flow `src/skills/discovery.ts` (`skill_name` index), `describe_skill` tool; "only list skill names in small index — not full metadata"; "agent calls describe_skill to get metadata on demand"; "lazy discovery — don't bloat prompt with all skill details" | **Coupling:** 🟢 — dùng progressive disclosure sẵn, thêm skill-name-only index + describe_skill tool | **Agent-agnostic:** ✅ | **Code sẵn:** ✅ (SkillStore progressive disclosure + loadBody sẵn — TS chỉ refine) | **Effort:** 1 tuần

## Nguồn gốc

**deer-flow** có nhiều skill — nhưng **không dump tất cả metadata vào prompt** (description, triggers, tools, body). Thay vào đó: (1) **Skill-name index**: prompt chỉ liệt kê **tên skill** (nhỏ, compact — "search", "cite", "deploy", "format"). (2) **describe_skill tool**: agent khi cần metadata cho skill cụ thể → **call `describe_skill(name)`** → trả về full metadata (description, triggers, tools). (3) **Lazy discovery**: metadata load **on-demand**, không upfront — prompt luôn nhỏ bất kể số skill. Nguyên tắc: **progressive disclosure taken further** — không chỉ body lazy, mà **description cũng lazy** (chỉ tên upfront).

## Mô tả

mya deferred skill discovery: (1) **Name-only index**: system prompt chỉ liệt kê tên skill (`## Skills: search, cite, deploy, format`). (2) **describe_skill tool**: agent call → trả full metadata (description, triggers, allowedTools, model). (3) **On-demand load**: agent không cần metadata → không load (prompt nhỏ); cần → call describe_skill (1 tool call, lấy đúng skill cần). (4) **Cache**: describe_skill result cache trong session (không call lại cùng skill). mya có progressive disclosure (index = name+description, loadBody = full body) — TS **đi thêm 1 bước**: index = **name only**, description cũng lazy.

## Kiến trúc

```
  SYSTEM PROMPT (compact — chỉ tên skill)
  ┌─── SKILLS (name-only index) ──────────────────────────┐
  │  Available skills: search, cite, deploy, format, debug  │
  │  Call describe_skill(name) for details.                 │
  │  (KHÔNG có description/triggers/tools ở đây)            │
  └───────────────────────────────────────────────────────┘

  AGENT (cần dùng "cite" skill)
        │
        │  "I need to cite sources — let me check cite skill"
        ▼
  ┌─── describe_skill("cite") ────────────────────────────┐
  │  → { name: "cite",                                      │
  │      description: "Add citations to response",          │
  │      triggers: ["cite", "source", "reference"],         │
  │      allowedTools: ["read", "search"],                  │
  │      model: null }                                      │
  └───────────┬───────────────────────────────────────────┘
              │ (agent biết metadata → invoke skill)
              ▼
  ┌─── INVOKE skill (loadBody — progressive disclosure) ──┐
  │  loadBody("cite") → full SKILL.md body                  │
  │  → agent theo workflow cite                              │
  └─────────────────────────────────────────────────────┘

  COMPARISON:
  EAGER (tất cả metadata trong prompt):  [search:desc+triggers+tools, cite:..., deploy:..., ...]  → PHÌNH
  DEFERRED (TS):                          [search, cite, deploy, format, debug]                    → COMPACT
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills SkillStore.index — name + description index (nền — TS rút gọn further)
// ✅ packages/skills SkillStore.loadBody — progressive disclosure body (nền — TS dùng)
// ✅ packages/skills SkillStore.suggest — suggest by query (nền — TS describe_skill gần)
// ✅ packages/tools ToolRegistry — tool registration (nền — TS describe_skill là tool)

// ❌ THIẾU: name-only index (renderIndexBlock hiện có description — TS rút name only)
// ❌ THIẾU: describe_skill tool (call → full metadata)
// ❌ THIẾU: per-session cache (describe_skill không call lại cùng skill)
```

## Implementation

```typescript
// packages/skills/src/deferred-discovery.ts (MỚI — refine trên SkillStore)
import type { SkillStore } from "./curator.js";

class DeferredSkillDiscovery {
  private cache = new Map<string, SkillMetadata>();

  constructor(private store: SkillStore) {}

  // name-only index (compact — chỉ tên, không description)
  renderNameIndex(): string {
    const names = [...this.store.index().map(s => s.name)];
    if (names.length === 0) return "";
    return `## Skills (call describe_skill(name) for details)\nAvailable: ${names.join(", ")}`;
  }

  // describe_skill tool — trả full metadata on-demand
  describe(name: string): SkillMetadata | null {
    // cache hit
    if (this.cache.has(name)) return this.cache.get(name)!;
    const skill = this.store.get(name);
    if (!skill) return null;
    const meta: SkillMetadata = {
      name: skill.name,
      description: skill.description,
      triggers: skill.triggers,
      allowedTools: skill.allowedTools ?? [],
      model: skill.model ?? null,
    };
    this.cache.set(name, meta); // cache trong session
    return meta;
  }
}

interface SkillMetadata {
  name: string;
  description: string;
  triggers: string[];
  allowedTools: string[];
  model: string | null;
}

// Usage:
// const discovery = new DeferredSkillDiscovery(skillStore);
// prompt: discovery.renderNameIndex();  // "Available: search, cite, deploy..."
// agent calls: discovery.describe("cite")  // → full metadata (cached)
```

## Được

- ✅ Prompt compact (chỉ tên — không description/triggers, prompt luôn nhỏ)
- ✅ Scales (100 skill → vẫn chỉ tên list, không phình)
- ✅ On-demand (agent chỉ load metadata skill cần — không load thừa)
- ✅ Cache (describe_skill 1 lần per session — không repeat)

## Mất

- ❌ Extra tool call (agent cần describe_skill trước khi invoke — thêm 1 round-trip)
- ❌ Discovery delay (agent không biết skill gì → phải describe từng cái để tìm)
- ❌ Name ambiguity (chỉ tên → agent không biết skill làm gì → guess rồi describe)
- ❌ Cache staleness (skill đổi sau cache → metadata stale)

## Khác

Khác **progressive disclosure hiện tại** (index = name+description, loadBody lazy) — TS **description cũng lazy** (index = name only). Khác **TT slash-skill-activation** (inject skill body khi /skill-name) — TS là **describe_skill tool** (agent chủ động call). Khác **TL routing-eval-cases** (eval routing) — TS là **discovery mechanism** (cách agent biết skill tồn tại).

## Khi nào chọn

- Rất nhiều skill (prompt phình khi dump tất cả metadata)
- Prompt budget tight (mỗi token count — name-only tiết kiệm đáng kể)
- Agent smart enough (biết describe để tìm — không cần description upfront)
- Nối packages/skills SkillStore.index + loadBody + suggest + packages/tools ToolRegistry; guard discoverability (tên skill phải intuitive — agent guess đúng), cache invalidation (skill đổi → clear cache), và fallback (nếu agent không describe → vẫn hoạt động với suggest); TS = deferred skill discovery, kết hợp TT slash-skill-activation (activation) + TL routing-eval-cases (routing correctness)
