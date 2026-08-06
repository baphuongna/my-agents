# Hướng WJ: Skill Description-Only Discovery — discovery chỉ để tên+desc vào system prompt; full content load on demand (progressive disclosure)

> **Nguồn gốc:** pi `skill discovery` (progressive disclosure — discovery chỉ inject name+description vào system prompt, full SKILL.md content load on demand khi trigger); "discovery puts name+desc in system prompt", "full content load on demand", "progressive disclosure" | **Coupling:** 🟢 — tách skill discovery (light) vs content load (heavy) trong skill pipeline | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (skills + curator sẵn — chưa có desc-only discovery + on-demand content load) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi** skill system dùng **progressive disclosure** — 2 tầng tải: (1) **Discovery (light)**: scan skill registry → chỉ lấy **name + description** (1-2 dòng) → inject vào system prompt. Agent biết skill tồn tại (name + tóm tắt) nhưng **không** thấy full content. (2) **Load on demand (heavy)**: khi agent quyết định dùng skill → **lúc đó mới load** full SKILL.md content (instructions, examples, code). Lợi ích: discovery rẻ (chỉ desc vào prompt — ít token), full content chỉ load khi cần (tiết kiệm context). Nguyên tắc: **desc đủ để biết tồn tại, content chỉ khi dùng**.

## Mô tả

mya skill description-only discovery: (1) **Discovery pass**: scan SkillStore → collect `{name, description}` cho mỗi skill → inject thành list ngắn vào system prompt. (2) **System prompt lightweight**: agent thấy "skill X: refactor helper" (1 dòng) — biết tồn tại, không thấy detail. (3) **On-demand load**: agent chọn skill X → load full SKILL.md (instructions/content) → inject vào context lúc đó. (4) **Lazy**: skill không dùng → full content không bao giờ load. mya có skills + curator — WJ thêm **desc-only discovery** + **on-demand content load** + **progressive disclosure contract**.

## Kiến trúc

```
  ┌─── DISCOVERY (light — mỗi session start) ────────────┐
  │  SkillStore.scan() → [{ name, description }]          │
  │  inject vào system prompt (NGẮN — 1 dòng/skill):      │
  │    "Available skills:                                  │
  │     - refactor-helper: refactor code safely            │
  │     - test-gen: generate test from code                │
  │     - deploy: deploy to staging"                       │
  │  → agent biết tồn tại, KHÔNG thấy full content         │
  │  → chi phí: ~50 tokens (chỉ desc)                      │
  └───────────────┬─────────────────────────────────────┘
                  │ (agent chọn dùng skill "test-gen")
                  ▼
  ┌─── LOAD ON DEMAND (heavy — chỉ khi trigger) ─────────┐
  │  skill = SkillStore.load("test-gen")                  │
  │  → full SKILL.md content (instructions, examples):    │
  │    "## Instructions                                    │
  │     1. Read target file                                │
  │     2. Analyze exports                                 │
  │     3. Generate test scaffold..."                      │
  │  → inject vào context LÚC ĐÓ (lazy)                    │
  │  → chi phí: ~500 tokens (chỉ skill được chọn)          │
  └───────────────┬─────────────────────────────────────┘
                  ▼
  ┌─── PROGRESSIVE DISCLOSURE ───────────────────────────┐
  │  discovery (desc) → trigger (load content)             │
  │  skill không dùng → content KHÔNG load (save token)    │
  └────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills skill.ts — skill loading (nền — WJ on-demand load ở đây)
// ✅ packages/skills curator.ts — skill curator (nền — WJ discovery scan)
// ✅ packages/skills skill-description.ts — skill description (nền — WJ desc-only inject)
// ✅ packages/prompts — system prompt (nền — WJ inject skill desc list)

// ❌ THIẾU: desc-only discovery (scan → name+desc list → system prompt)
// ❌ THIẾU: on-demand content load (lazy load khi trigger)
// ❌ THIẾU: progressive disclosure contract (desc vs content tách biệt)
```

## Implementation

```typescript
// packages/skills/src/desc-only-discovery.ts (MỚI)
interface SkillRef { name: string; description: string } // light — discovery
interface SkillContent { name: string; content: string } // heavy — full load

class ProgressiveSkillDiscovery {
  private cache = new Map<string, SkillContent>(); // loaded content cache

  // DISCOVERY: light pass → name+desc list (inject system prompt)
  discoverAll(refs: SkillRef[]): string {
    const lines = refs.map(r => `- ${r.name}: ${r.description}`);
    return `Available skills:\n${lines.join("\n")}`;
  }

  // LOAD ON DEMAND: heavy pass → full content (lazy, chỉ khi trigger)
  async loadOnDemand(
    name: string,
    fetchContent: (name: string) => Promise<string>,
  ): Promise<SkillContent> {
    if (this.cache.has(name)) return this.cache.get(name)!; // cache hit
    const content = await fetchContent(name); // lazy load
    const skill: SkillContent = { name, content };
    this.cache.set(name, skill);
    return skill;
  }
}

// Usage:
// const discovery = new ProgressiveSkillDiscovery();
// // discovery (light):
// const descList = discovery.discoverAll([{name:"test-gen", description:"generate test"}]);
// systemPrompt += descList; // ~50 tokens
// // on-demand (heavy) — chỉ khi agent chọn:
// const skill = await discovery.loadOnDemand("test-gen", fetchSkillMd); // ~500 tokens
```

## Được

- ✅ Token-efficient (discovery chỉ desc — skill không dùng không tốn token)
- ✅ Progressive (agent biết tồn tại → chọn → load detail — tự nhiên)
- ✅ Scalable (100 skill → discovery vẫn nhẹ — chỉ desc, không full content)
- ✅ Lazy cost (content load chỉ khi dùng — pay-per-use)

## Mất

- ❌ Discovery incomplete (agent chỉ thấy desc — có thể miss skill phù hợp)
- ❌ Load latency (trigger → load content → delay turn)
- ❌ Desc quality dependency (desc tồi → agent không chọn đúng skill)
- ❌ Cache invalidation (skill update → cache stale)

## Khác

Khác **full-skill-inject** (load tất cả skill content vào prompt) — WJ **desc-only + on-demand** (progressive). Khác **99 progressive-disclosure** (general pattern) — WJ **skill-specific** (name+desc discovery → content load). Khác **skill search/RAG** (query → top-k skill) — WJ **enumerate desc** (tất cả desc vào prompt, agent chọn).

## Khi nào chọn

- Nhiều skill (10-100+) → full content inject quá tốn token
- Skill dùng selective (mỗi session chỉ 1-2 skill) → on-demand tiết kiệm
- Muốn progressive disclosure (agent biết tồn tại trước, detail khi cần)
- Nối packages/skills skill.ts + curator.ts + skill-description.ts + packages/prompts; guard desc-quality (desc rõ ràng — agent chọn đúng), cache-invalidation (skill update → clear cache), và load-fallback (load fail → graceful error, không crash); WJ = skill description-only discovery, kết hợp 99 progressive-disclosure (general) + 142 skill-marketplace (registry)
