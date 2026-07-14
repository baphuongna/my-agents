# Slow-prompt fix proposals

Two concrete trims for the harness. Both opt-in — apply, ignore, or mix.

## 1. `AGENTS.md` → slim index

**Current:** ~2.5 KB inline every turn.
**Cut to:** ~600-byte index + on-demand spec link.

Replace the bulk of `AGENTS.md` with:

```markdown
# AGENTS.md — see .learned/AGENT-SPEC.md (authoritative)

Stack: TS7 / Rust-stable via napi-rs / Node ≥20 ESM.
Rust gate (any one): trust boundary | hot inner loop (>100k files / AST) | determinism | platform parity.
Hard rules (§18): minimal core, no sandbox, single time helper (`core.time` / `natives.time`),
no `process::exit` in natives (`NativeResult<T>`), transports ↛ core, byte-faithful JSON,
no stub-then-replace.
Style: TS strict + `noUncheckedIndexedAccess` + ESM + discriminated unions; Rust `clippy::exit` denied.
Layout (§3): `packages/{core,agent,ai,memory,prompts,skills,tools,council,natives,print,rpc,gateway,web,tui}`
+ standalone + `vendored/{pi,pi-ai,pi-agent-core}`.
```

Spec stays the source of truth; only the loader-visible first screen is slimmed.

**Saving:** ~1.9 KB / turn ≈ 60–70 % of `AGENTS.md` block.

## 2. Skills catalog → lazy description-only

**Current:** every turn: full `<name>` + `<description>` (200–500 chars) + `<location>` per skill, 40+ skills.
**Cut to:** name + ≤80-char first sentence. Full `SKILL.md` loaded lazily via `read` on first mention per session, cached to `.prompts/skill-cache.jsonl` (TTL = session).

Schematic:

```yaml
- name: <name>
  description: <≤80 chars; first sentence; ellipsis on trim>
  # location: elided — resolved on first use via find_skills_dir(name)
```

**Saving:** ~70 % of the skills block (~3–4 KB / turn).

## 3. Bash + tool output → terse by default

- Pipe noisy cmds through `| head -n 50` (or `rg ... | head`).
- Default tool-result truncation already exists; just stop un-truncating big trees.
- Cache `ls` / `rg` results to `.prompts/fs-cache.jsonl` keyed by `(cwd, argv)` with mtime invalidation.

**Saving:** variable; meaningful on explore-heavy turns.

## Combined

~5–6 KB / turn fewer tokens → lower prefill cost → faster TTFT on long-context sessions.

## Apply

Say `go` and I'll:
1. Write `AGENTS.md.slim` (new) + back up current to `AGENTS.md.full`.
2. Add `tools/skill-loader.ts` (or `.mjs` if simpler) implementing lazy load + cache.
3. Add `tools/fs-cache.ts` for bash result memoization.
4. Open a single PR — one concern, ready to revert per file.

No change ships without your `go`.
