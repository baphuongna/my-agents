# mya Skills System

> On-demand skill discovery for the mya agent.
> Pattern: [pi-skill-search](https://github.com/earendil-works/pi-skill-search) (ported, self-contained).

## Overview

mya has **hundreds** of potential skills but injects **none** of them into the
system prompt. Instead, the agent sees a tiny category summary and searches for
the right skill **on-demand** via a `skill-search` tool. This cuts skill-related
prompt tokens by ~97% (vs. injecting all skill descriptions every turn).

There are **two tiers** of skills, kept deliberately separate:

```
~/.mya/agent/
  skills/                     ← MAIN skills (pi-discovered, injected as a list)
    skill-search/SKILL.md       ← the meta-skill (teaches the agent the tool)
    <your-skill>/SKILL.md       ← any skill you want pi to always "see"
  data/                       ← CORPUS (pi-skill-search scans this; pi does NOT)
    <skill>/SKILL.md            ← searchable skills (the bulk of knowledge)
```

### Why two tiers?

| Tier | pi discovers? | In `<available_skills>`? | Purpose |
|------|---------------|--------------------------|---------|
| **Main** (`skills/`) | ✅ yes | ✅ listed (then stripped) | Skills the agent should *always* know about (e.g. the `skill-search` meta-skill) |
| **Corpus** (`data/`) | ❌ no | ❌ never | The searchable knowledge base — indexed by `skill-search`, surfaced only when relevant |

If corpus skills lived in `skills/`, pi would discover + inject **all** of them
again — defeating the token-saving goal. So the corpus sits in `data/`, which pi
ignores, and `skill-search` scans it itself.

## How it works (end-to-end)

```
                        ┌─────────────────────────────────────┐
                        │  ~/.mya/agent/data/  (CORPUS)        │
                        │   284+ SKILL.md files                │
                        │   (scanned by scanSkillDirectory)    │
                        └──────────────┬──────────────────────┘
                                       │ buildIndex (BM25 + synonyms + categories)
                                       ▼
   before_agent_start (mya-bridge) ──────────────────────────────
   1. STRIP pi's <available_skills> block from the system prompt
      (whatever pi discovered in skills/ — token save)
   2. BUILD index from corpus (+ any main skills)
   3. REGISTER the `skill-search` tool (once per session)
   4. INJECT a compact "## Available Skill Domains" summary (≤250 tokens)
                                       │
                                       ▼
   agent turn ──────────────────────────────────────────────────
   agent calls: skill-search({ query: "debugging", limit: 5 })
                                       │
                                       ▼
   returns: ## <skill-name> (score: 3.00)
            <description>
            Path: ~/.mya/agent/data/<skill>/SKILL.md
                                       │
                                       ▼
   agent reads the SKILL.md (read tool) → follows its instructions
```

**Result:** the agent has access to the full corpus but only pays the token cost
for skills it actually needs, fetched by keyword when relevant.

## The `skill-search` meta-skill

`~/.mya/agent/skills/skill-search/SKILL.md` is a **main** skill that teaches the
agent *how* to use the system. It is pi-discovered (so it's in pi's skill
registry) and tells the agent:

- When you see `## Available Skill Domains`, the system is active.
- Call `skill-search({ query, limit })` with **domain keywords** (not error text).
- Always `read` the returned SKILL.md path before following it.
- Don't call it every turn — only when a task needs a skill.

Because it lives in `skills/`, pi knows about it (for invocation / progressive
disclosure) even though its *description* is stripped from the prompt by the
`skill-search` extension.

## SKILL.md format

Every skill is a directory containing a `SKILL.md`:

```
~/.mya/agent/data/<skill-name>/
  SKILL.md          ← required (frontmatter + body)
  <other files>     ← optional assets (resolve relative paths against this dir)
```

**SKILL.md** — YAML frontmatter + markdown body:

```markdown
---
name: api-design
description: REST API design patterns — resource naming, versioning, pagination, error handling, status codes, idempotency.
triggers: ["rest", "api", "endpoint", "http"]
---

# api-design

Resources are nouns (/users, /orders). Version via header or /v1.
Use 200/201/204/400/404/409/422/500 correctly.

## Anti-patterns
- Don't return 200 for errors.
- Don't use verbs in paths (/getUser → /users).
```

### Frontmatter fields

| Field | Required | Purpose |
|-------|----------|---------|
| `name` | ✅ | Unique skill identifier. **kebab-case** (`^[a-z0-9][a-z0-9-]*$`). |
| `description` | ✅ | One line. **Indexed by skill-search** — be specific (domain + purpose). This is what the search engine matches against. |
| `triggers` | optional | Array of keywords that hint relevance. |

The **body** is the actual instruction set the agent reads after a search hit.
Keep it actionable (rules, patterns, anti-patterns, examples).

> **Naming constraint:** names must match `^[a-z0-9][a-z0-9-]*$` (lowercase,
> digits, hyphens). This is enforced everywhere (launcher create, delete) to
> prevent path traversal.

## The search engine

Ported from pi-skill-search into `packages/print/src/skill-search/`:

| Module | Role |
|--------|------|
| `scanner.ts` | `scanSkillDirectory(dir)` + `parseFrontmatter()` — reads corpus |
| `indexer.ts` | `buildIndex()` (two-pass) + `fingerprintSkills()` (change detection) |
| `text.ts` | Tokenizer (SPEC §5.3) |
| `synonyms.ts` | Synonym expansion (`ml` → `machine learning`, `plot` → `plotting chart`) |
| `categories.ts` | 14 category rules + `classify()` |
| `search.ts` | Scored search (BM25-style, SPEC §5.1) |
| `strip.ts` | Regex to strip `<available_skills>` from the prompt |
| `format.ts` | `formatCategorySummary()` (≤250 tokens) + `formatResults()` + `renderToolDescription()` |

Search scores skills against the tokenized query (name + description + category
keywords), with automatic synonym expansion. Queries should use **domain
keywords / tool names / task descriptions**, not exact error messages.

## The `MYA_SKILL_SOURCE` gate (main skills only)

pi's skill discovery is **scoped** to `~/.mya/agent/skills/` only via a fork
gate in `packages/coding-agent/src/core/resource-loader.ts`:

```ts
// updateSkillsFromPaths — when MYA_SKILL_SOURCE is set (by pi-main.ts),
// load ONLY that directory, ignoring pi's auto-discovery
// (~/.agents/skills, project .agents/skills, pi-packages).
const myaSkillSource = process.env.MYA_SKILL_SOURCE;
if (myaSkillSource) skillPaths = [myaSkillSource];
```

`packages/print/src/pi-main.ts` sets `MYA_SKILL_SOURCE=~/.mya/agent/skills` before
launching pi. So:

- **pi discovers** only `~/.mya/agent/skills/` (the meta-skill + any main skills).
- **`~/.agents/skills/`**, project skills, pi-package skills are **not** read.
- The corpus (`~/.mya/agent/data/`) is read by `skill-search`, not pi.

> The gate replaces the `--no-skills` flag (which emptied the loaded-resources
> panel's [Skills] section). With the gate, the panel behaves normally; only the
> source is scoped.

## Launcher Skills tab (manage skills)

`mya launcher` → Skills tab (press `6`). Two sub-tabs + full CRUD:

```
Skills tab:  [Main 1]  [Corpus 4]  (s to switch)
  from ~/.mya/agent/skills/   ← or data/ when Corpus active
  ●  skill-search   On-demand skill discovery tool...
  ●  api-design     REST API design patterns...

  1-8 tabs | ↑/↓ select | s=sub-tab | a=add | v=view | e=edit | d=delete | q quit
```

| Key | Action | What happens |
|-----|--------|--------------|
| `s` | switch sub-tab | Main ↔ Corpus (resets selection) |
| `a` | **add** | prompt name (kebab validated) + description → creates `<active-dir>/<name>/SKILL.md` → opens `$EDITOR` to fill the body. **Saves to the active sub-tab's directory.** |
| `v` / `Enter` | **view** | opens SKILL.md in `$PAGER` (less) |
| `e` | **edit** | opens SKILL.md in `$VISUAL` / `$EDITOR` / `vi` |
| `d` | **delete** | confirm by typing the name → `rm -rf` the skill dir |

### Security

- **Create / delete** validate the name against `^[a-z0-9][a-z0-9-]*$` before any
  path construction (path-traversal guard).
- **Delete** derives the directory from the SKILL.md `filePath` via `dirname()`
  (not the frontmatter `name`, which is untrusted) and verifies it stays within
  the expected base dir before `rmSync`.

### Inline prompts

Every launcher prompt (skills, roles, channels, cron, mcp, providers) shows a
**multi-line hint** explaining the field + a footer `Enter = confirm · Esc = cancel`.

## Adding skills

### Via launcher (recommended)

1. `mya launcher` → Skills (`6`) → switch to the sub-tab you want (`s`).
2. Press `a` → enter name (kebab-case) + description.
3. Your `$EDITOR` opens on the new SKILL.md — fill the body.
4. Save + quit → the skill is indexed on the next `before_agent_start`.

### Manually

```bash
# A corpus skill (searchable):
mkdir -p ~/.mya/agent/data/my-skill
cat > ~/.mya/agent/data/my-skill/SKILL.md << 'EOF'
---
name: my-skill
description: What this skill does — be specific, it's indexed for search.
triggers: ["keyword1", "keyword2"]
---
# my-skill
Instructions the agent follows after a search hit.
EOF

# A main skill (pi always sees it): put it in skills/ instead of data/.
mkdir -p ~/.mya/agent/skills/my-main-skill
# ... same SKILL.md format
```

> The index rebuilds (fingerprint-based change detection) whenever the corpus
> changes, so new skills are picked up on the next agent turn — no restart needed.

## Code map

| File | Role |
|------|------|
| `packages/print/src/skill-search/` | The ported pi-skill-search core (8 modules + barrel `index.ts`). Self-contained — scans its own corpus, independent of pi discovery. |
| `packages/print/src/mya-bridge.ts` | `before_agent_start` integration: scans `~/.mya/agent/data/` → strips `<available_skills>` → injects category summary → registers `skill-search` tool. |
| `packages/print/src/pi-main.ts` | Sets `MYA_SKILL_SOURCE` so pi reads only `~/.mya/agent/skills/`. |
| `packages/coding-agent/src/core/resource-loader.ts` | Fork gate: `MYA_SKILL_SOURCE` overrides pi's skill discovery. |
| `packages/print/src/launcher.ts` | Skills tab: 2 sub-tabs (main/corpus) + add/view/edit/delete. |

## Configuration

| Setting | Where | Default | Effect |
|---------|-------|---------|--------|
| `MYA_SKILL_SOURCE` | env (set by pi-main.ts) | `~/.mya/agent/skills` | pi's only skill source (the gate) |
| Corpus dir | hardcoded (mya-bridge) | `~/.mya/agent/data/` | where `skill-search` looks for skills |
| `quietStartup` | `~/.mya/agent/settings.json` | `false` | when `true`, hides the loaded-resources panel at startup (Main/Corpus/Context/Extensions/Themes) |

## Design decisions

| Decision | Rationale |
|----------|-----------|
| Corpus in `data/`, not `skills/` | pi would discover + inject-all again, killing token savings. |
| `skill-search` meta-skill in `skills/` | pi discovers it (invocable) even though its description is stripped. |
| `MYA_SKILL_SOURCE` gate (not `--no-skills`) | scopes pi's source without hiding the loaded-resources panel. |
| Strip + on-demand search (not inject-all) | ~97% token reduction; agent only pays for skills it uses. |
| `better-sqlite3`-independent | the skill index is in-memory (rebuilt per session); no DB needed. |

## Verification

The system is verified end-to-end through the real mya TUI:

- **Search precision:** domain-specific queries return the correct skill
  (git → git-workflow, REST → api-design, SQL → sql-optimization, React → react-testing).
- **Lifecycle:** agent calls `skill-search` → reads the SKILL.md → **applies** the
  skill's instructions (e.g. returns `201 Created` for resource creation per
  `api-design`).
- **Launcher CRUD:** add/view/edit/delete all work via TUI; active-sub-tab-aware
  create; path-traversal-safe delete.

## See also

- [pi-skill-search](https://github.com/earendil-works/pi-skill-search) — upstream reference.
- `docs/memory-system-v2.md` — the (separate) memory system.
- `docs/roles-architecture.md` — the roles system (one agent, multiple hats).
