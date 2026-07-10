# harness — Learnings for mya

> Studied 2026-07-08. **This is NOT a codebase — it is a Claude Code plugin (prompt-engineering / meta-skill).** ~15 markdown files + plugin manifest, no Rust/TS/Py/Go source. Source: `/home/bom/source/my-agent/source/harness`.

## TL;DR (what kind of project this is)
**Harness** (revfactory, Apache-2.0, v1.2.0) is **"The Team-Architecture Factory for Claude Code"** — a **meta-skill plugin** (`.claude-plugin/`) that turns a domain sentence ("build a harness for this project") into an **agent team + the skills they use**, picked from **six pre-defined team-architecture patterns**. It positions itself at the **L3 Meta-Factory layer** (generates other harnesses). It is pure prompt/content engineering: a `SKILL.md` + a `references/` library (design-pattern, QA, skill-writing, skill-testing, orchestrator-template, team-examples) + i18n READMEs. No runtime, no code — but a **rich source of multi-agent orchestration vocabulary + a productized meta-skill template**.

## Overview (cite paths)
- `.claude-plugin/{plugin.json,marketplace.json}` — plugin packaging.
- `skills/harness/SKILL.md` — the meta-skill entry.
- `skills/harness/references/` — `agent-design-patterns.md`, `qa-agent-guide.md`, `skill-writing-guide.md`, `skill-testing-guide.md`, `orchestrator-template.md`, `team-examples.md`.
- `README{,_KO,_JA}.md`, `docs/{quickstart,experimental-dependency}.md`, `index.html` (landing), banner PNGs.

## The six team-architecture patterns (the core asset)
1. **Pipeline** — sequential stages, each agent hands off to the next.
2. **Fan-out / Fan-in** — one dispatcher → N parallel workers → aggregator.
3. **Expert Pool** — a pool of specialists; router picks the right expert per task.
4. **Producer-Reviewer** — one agent produces, another critiques/approves (loop until quality bar).
5. **Supervisor** — a supervisor agent directs worker agents, handles escalation.
6. **Hierarchical Delegation** — tree of agents, top delegates down, results roll up.

## Notable patterns & techniques (Pattern → Why → How mya adopts)

1. **Named multi-agent topology vocabulary.** The 6 patterns are a clean, complete-enough taxonomy of agent-team shapes. → **mya has `subagents`/`delegate`/`spawn_subagent` + pi-crew `team` workflows, but no named topology catalog.** Formalizing these 6 as first-class `TeamTopology` variants (with matching spawn/graph helpers in `mya-runtime`) would give users a vocabulary and let `mya-cron`/SOP/skills declare "run this as Producer-Reviewer" declaratively. High conceptual leverage, low code cost.

2. **Meta-skill: a skill that generates agents + skills.** Harness is itself a skill whose output is *more* skills/agents. → **mya has `SkillForge` (auto skill discovery) but not a "team/skill architect" meta-skill.** A mya meta-skill that reads a domain description and emits `[agents.*]` config + `SKILL.md` bundles (using the 6 topologies) would be a powerful onboarding/automation feature — and it composes naturally with mya's existing skills + config system.

3. **Skill structure template: `SKILL.md` + `references/`.** Each skill is a front-matter'd markdown + a `references/` folder of guides (writing, testing, QA, patterns, examples, orchestrator template). → **mya skills already use SKILL.md + frontmatter; adopting the explicit `references/` sub-library convention** (separate guides for *writing* vs *testing* vs *QA-ing* a skill) would improve mya skill authoring quality and is directly borrowable from `skills/harness/references/`.

4. **`orchestrator-template` as a reference artifact.** A reusable template for the orchestrating agent's prompt. → mya's `mya-runtime` agent-loop prompt assembly could expose a swappable "orchestrator template" so teams (Producer-Reviewer, Supervisor, …) each get a tailored system-prompt scaffold.

5. **Plugin/marketplace packaging (`.claude-plugin/`).** Clean `plugin.json` + `marketplace.json` discovery model. → mya's WASM plugins (`mya-plugins`) use a manifest + Ed25519 signature (stronger); the marketplace.json *discovery* idea (list + owner + version) is worth mirroring for a future mya plugin registry.

## Top ideas worth adopting (prioritized)
1. **Formalize the 6 team topologies** (Pipeline / Fan-out-Fan-in / Expert Pool / Producer-Reviewer / Supervisor / Hierarchical Delegation) as named, declarable shapes in `mya-runtime` + pi-crew workflows.
2. **A "team/skill architect" meta-skill** for mya: domain description → `[agents.*]` + skill bundles.
3. **Adopt the `SKILL.md` + `references/` library convention** (separate writing/testing/QA guides) for mya skill authoring.
4. **Swappable orchestrator templates** per team topology in mya's prompt assembly.

## Gotchas / anti-patterns
- **Not a runtime** — don't expect executable patterns; it's prompt content. Borrow the *vocabulary + templates*, not code.
- Heavily i18n'd (EN/KO/JA) marketing READMEs — the substance is in `skills/harness/references/`.
- "L3 Meta-Factory" framing is the author's taxonomy; treat as inspiration, not standard.

## Key reference files
- `skills/harness/SKILL.md` (meta-skill entry), `skills/harness/references/{agent-design-patterns,team-examples,orchestrator-template,skill-writing-guide,skill-testing-guide,qa-agent-guide}.md`
- `.claude-plugin/{plugin,marketplace}.json`
- `README.md` §Architecture Patterns, §Use Cases
