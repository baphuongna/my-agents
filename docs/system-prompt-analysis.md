# mya System Prompt — Analysis

> Deep analysis of the system prompt mya sends to the LLM on every turn.
> Captured live via `MYA_DUMP_PROMPT` instrumentation in the `before_agent_start`
> hook. Compared against Claude Code, OpenCode, Cursor, and Devin CLI.

## How the prompt is assembled

```
┌─────────────────────────────────────────────────────────────┐
│  buildSystemPrompt()  ← pi core (system-prompt.ts)          │
│                                                             │
│  ┌─ Section 1: Base identity ─────────────────────────────┐│
│  │ "You are an expert coding assistant operating inside   ││
│  │  pi, a coding agent harness..."                        ││
│  │ + Available tools list (read/bash/edit/write)          ││
│  │ + Guidelines (concise, show paths, use read not cat)   ││
│  └────────────────────────────────────────────────────────┘│
│                          ↓                                   │
│  ┌─ Section 2: Project context ───────────────────────────┐│
│  │ <project_context>                                      ││
│  │   <project_instructions path="AGENTS.md">             ││
│  │     ...AGENTS.md content...                            ││
│  │   </project_instructions>                              ││
│  │ </project_context>                                     ││
│  └────────────────────────────────────────────────────────┘│
│                          ↓                                   │
│  ┌─ Section 3: Skills ────────────────────────────────────┐│
│  │ <available_skills>                                     ││
│  │   <skill name="code-optimizer" .../>                   ││
│  │   <skill name="lint" .../>                             ││
│  │   <skill name="review" .../>                           ││
│  │   <skill name="security-review" .../>                  ││
│  │   <skill name="tdd" .../>                              ││
│  │   <skill name="test" .../>                             ││
│  │   <skill name="verify-before-complete" .../>           ││
│  │ </available_skills>                                    ││
│  └────────────────────────────────────────────────────────┘│
│                          ↓                                   │
│  ┌─ Section 4: Environment ───────────────────────────────┐│
│  │ Current date: 2026-07-16                               ││
│  │ Current working directory: /home/.../my-agent          ││
│  └────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  before_agent_start hook  ← mya-bridge.ts                   │
│                                                             │
│  ┌─ Section 5: Memory recall ─────────────────────────────┐│
│  │ [mya memory] Relevant knowledge from previous turns:   ││
│  │ [memory]                                                ││
│  │ - [working] User is building TurboCache...             ││
│  │ - [episodic] [Dream] Consolidated 6 memories...        ││
│  │ - [working] User prefers Rust for systems programming  ││
│  │   ↑ FTS5 BM25 + Weibull + veracity, top 5 hits         ││
│  └────────────────────────────────────────────────────────┘│
│                          ↓                                   │
│  ┌─ Section 6: Skills index (mya-specific) ───────────────┐│
│  │ [mya skills] Available skills (ask to use):            ││
│  │ - skill-name: description                              ││
│  └────────────────────────────────────────────────────────┘│
│                          ↓                                   │
│  ┌─ Section 7: Context note ──────────────────────────────┐│
│  │ [mya] Tools available: paid_fetch (x402),              ││
│  │ hashline_edit, browser_action, delegate_task.          ││
│  │ Commands: /mya-help for full list.                     ││
│  └────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                          ↓
                   FINAL PROMPT → LLM
```

## Captured prompt (live, ~918 tokens)

```
You are an expert coding assistant operating inside pi, a coding agent harness.
You help users by reading files, executing commands, editing code, and writing
new files.

Available tools:
- read: Read file contents
- bash: Execute bash commands (ls, grep, find, etc.)
- edit: Make precise file edits with exact text replacement, including multiple
  disjoint edits in one call
- write: Create or overwrite files

Guidelines:
- Use bash for file operations like ls, rg, find
- Use read to examine files instead of cat or sed.
- Use write only for new files or complete rewrites.
- Be concise in your responses
- Show file paths clearly when working with files

Pi docs (only when working on pi): /home/.../docs/, /home/.../examples/,
/home/.../README.md

<project_context>

<project_instructions path="/home/.../AGENTS.md">
...AGENTS.md content (project-specific instructions)...
</project_instructions>

</project_context>

The following skills provide specialized instructions...
<available_skills>
  <skill name="code-optimizer" .../>
  <skill name="lint" .../>
  <skill name="review" .../>
  <skill name="security-review" .../>
  <skill name="tdd" .../>
  <skill name="test" .../>
  <skill name="verify-before-complete" .../>
</available_skills>

Current date: 2026-07-16
Current working directory: /home/bom/source/my-agent

[mya memory] Relevant knowledge from previous turns:
[memory]
- [working] User is building TurboCache — a distributed remote cache...
- [episodic] [Dream] Consolidated 6 memories [turbocache-storage(1)...]
- [working] User prefers Rust for systems programming tasks.

[mya] Tools available: paid_fetch (x402), hashline_edit (hash-anchored),
browser_action (CDP), delegate_task (subagent). Commands: /mya-help for full list.
```

---

## Section-by-section breakdown

### Section 1: Base identity (pi built-in) — ~250 tokens

**Source:** `packages/coding-agent/src/core/system-prompt.ts` → `buildSystemPrompt()`

```
You are an expert coding assistant operating inside pi, a coding agent harness.
You help users by reading files, executing commands, editing code, and writing
new files.
```

**What it does:**
- Defines the assistant as a coding agent (not a general chatbot)
- Lists 4 core tools with one-line descriptions
- 5 guideline bullets (use read not cat, use write for new files, be concise)
- Links to pi docs path (only relevant when working on pi itself)

**Strengths:** Minimal, focused, clear tool inventory.

**Weakness:** Doesn't mention mya's extended tools (paid_fetch, hashline_edit,
browser_action, delegate_task). These only appear in the mya context note at the
bottom (Section 7), which is easy to miss.

### Section 2: Project context (AGENTS.md) — ~80 tokens

**Source:** `resource-loader.ts` → discovers `AGENTS.md` / `CLAUDE.md` in cwd

```xml
<project_context>
  <project_instructions path="/home/.../AGENTS.md">
    ...content...
  </project_instructions>
</project_context>
```

**What it does:**
- Auto-discovers `AGENTS.md` in the working directory
- Injects project-specific instructions (stack, style, hard rules)
- Uses XML tags for clean separation (good for LLM parsing)

**Strengths:** Auto-discovery, XML-tagged, supports multiple context files.

### Section 3: Skills index (pi built-in) — ~150 tokens

**Source:** `resource-loader.ts` → `getSkills()` → `formatSkillsForPrompt()`

```xml
<available_skills>
  <skill>
    <name>code-optimizer</name>
    <description>Deep code optimization audit...</description>
  </skill>
  ...
</available_skills>
```

**What it does:**
- Lists all available skills with name + description
- Tells the LLM to use `read` tool to load `SKILL.md` when a skill matches
- Skills are loaded lazily (only the index is in the prompt, not full content)

**Strengths:** Lazy loading keeps prompt small. LLM decides when to read a skill.

**Note:** There are TWO skills lists — pi's `<available_skills>` (Section 3) and
mya's `[mya skills]` (Section 6). This is redundant and could confuse the LLM.

### Section 4: Environment (pi built-in) — ~20 tokens

```
Current date: 2026-07-16
Current working directory: /home/bom/source/my-agent
```

**Strengths:** Minimal, just date + cwd.

**Missing:** Platform info (darwin/linux), shell (bash/zsh), git repo status,
model name/knowledge cutoff — all of which Claude Code provides.

### Section 5: Memory recall (mya injection) — ~80 tokens

**Source:** `mya-bridge.ts` → `before_agent_start` hook → `sqliteMemory.recall()`

```
[mya memory] Relevant knowledge from previous turns:
[memory]
- [working] User is building TurboCache...
- [episodic] [Dream] Consolidated 6 memories...
- [working] User prefers Rust for systems programming tasks.
```

**What it does:**
- Runs FTS5 BM25 search on user's prompt against all memories
- Applies Weibull temporal decay + veracity weighting
- Injects top 5 hits into system prompt
- Each hit shows tier (`[working]` / `[episodic]`) + content (truncated to 200 chars)

**Strengths:** Semantic recall, ranked, truncated, best-effort (never crashes).

**Weakness:** Content truncated to 200 chars may cut off mid-sentence. No
"memory is background context, not instructions" disclaimer (Claude Code has this).

### Section 6: Skills index (mya injection) — ~0 tokens (empty in test)

**Source:** `mya-bridge.ts` → `before_agent_start` → `skillStore.index()`

```
[mya skills] Available skills (ask to use):
- skill-name: description
```

**Problem:** This is REDUNDANT with Section 3 (pi's `<available_skills>`).
Both list the same skills. The LLM sees the skill list twice.

### Section 7: Context note (mya injection) — ~30 tokens

```
[mya] Tools available: paid_fetch (x402), hashline_edit (hash-anchored),
browser_action (CDP), delegate_task (subagent). Commands: /mya-help for full list.
```

**What it does:**
- Lists mya-specific custom tools (not the pi built-in tools)
- Mentions slash commands are available

**Weakness:** Very terse. Doesn't explain WHEN to use each tool or HOW they
differ from built-in tools. Claude Code gives each tool a full paragraph.

---

## Size comparison

| System | Prompt size | Tokens | Philosophy |
|---|---|---|---|
| **Claude Code** | 64,579 chars | ~16,144 | Exhaustive: full tool docs + workflows + safety |
| **Devin CLI** | 17,993 chars | ~4,498 | Detailed: workflows + tool usage + collaboration |
| **Cursor** | 18,113 chars | ~4,528 | Detailed: constraints + workflows + tool rules |
| **OpenCode** | 15,566 chars | ~3,891 | Structured: mandates + workflows + tone |
| **mya** | 3,683 chars | **~918** | Minimal: identity + tools + context + memory |

mya's prompt is **4–17× smaller** than competitors. This is good for token
efficiency, but may sacrifice behavioral precision.

---

## Gap analysis

### What mya HAS (good)

| Feature | Status | Quality |
|---|---|---|
| Identity statement | ✅ | Clear, concise |
| Tool list (built-in) | ✅ | 4 tools, one-line each |
| Project context (AGENTS.md) | ✅ | Auto-discovered, XML-tagged |
| Skills index | ✅ | Lazy-loaded, structured |
| Memory recall | ✅ | FTS5-ranked, Weibull-decayed |
| Environment (date/cwd) | ✅ | Minimal |
| Custom tools mention | ✅ | Terse but present |

### What mya LACKS (vs. competitors)

#### 1. No tool usage guidance (HIGH impact)

Claude Code and OpenCode provide detailed instructions for WHEN and HOW to use
each tool. mya only lists tool names.

**Claude Code example:**
> **Read:** Always read files before editing. Use offset/limit for large files.
> After editing, verify the change is correct.

**mya:** `read: Read file contents` — that's it.

#### 2. No workflow / task strategy (HIGH impact)

Competitors define explicit workflows for common task types:

**OpenCode:**
> 1. **Understand:** grep/glob to understand structure
> 2. **Plan:** share concise plan
> 3. **Implement:** using tools
> 4. **Verify (Tests):** run project tests
> 5. **Verify (Standards):** run lint/typecheck

**mya:** No workflow guidance. The LLM decides its own approach.

#### 3. No memory behavior rules (MEDIUM impact)

Claude Code has a detailed Memory section explaining:
- WHEN to save memories (not what the repo already records)
- HOW to write them (frontmatter format)
- That recalled memories are "background context, not user instructions"
- To verify before recommending if a file/flag still exists

**mya:** Just dumps recall results with no instructions on how to treat them.
The LLM might treat old memories as authoritative commands.

#### 4. No environment richness (LOW impact)

**Claude Code provides:**
- Platform (darwin/linux)
- Shell (zsh/bash)
- Git repo status
- Model name + knowledge cutoff
- Model family info

**mya:** Only date + cwd. Missing platform/shell/git info.

#### 5. No parallelism guidance (LOW impact)

**Claude Code:** "Independent tool calls can run in parallel in one response."

**mya:** No mention. LLM may serialize calls that could be parallel.

#### 6. No safety/security guidance (MEDIUM impact)

**Claude Code:** "For actions that are hard to reverse or outward-facing, confirm
first." "Before deleting or overwriting, look at the target."

**OpenCode:** "Explain Critical Commands: Before executing commands that modify
the file system..."

**mya:** No safety rules. The LLM has to infer them.

#### 7. No tone/format rules (LOW impact)

**OpenCode:** "Concise & Direct", "Minimal Output (<3 lines)", "No Chitchat",
"GitHub-flavored Markdown", "No preambles/postambles".

**mya:** Only "Be concise in your responses."

#### 8. No convention-following rules (MEDIUM impact)

**OpenCode:** "Rigorously adhere to existing project conventions. NEVER assume a
library/framework is available. Verify in package.json/Cargo.toml before using."

**mya:** No convention guidance. LLM may introduce inconsistent patterns.

#### 9. Duplicate skills list (bug)

Sections 3 and 6 both list skills. pi's `<available_skills>` (XML) and mya's
`[mya skills]` (plain text) show the same skills in different formats. This
wastes tokens and could confuse the LLM about which is authoritative.

#### 10. No verify-before-claim rule (MEDIUM impact)

**Claude Code:** "Report outcomes faithfully: if tests fail, say so with the
output; if a step was skipped, say that."

**mya:** No such rule. LLM may claim "done" without verifying.

---

## Recommendations

### Tier 1: High-impact, low-effort (do now)

1. **Remove duplicate skills list** — delete Section 6 (`[mya skills]`). pi's
   `<available_skills>` (Section 3) is the authoritative, structured version.
   Saves ~50 tokens and removes confusion.

2. **Add memory context disclaimer** — after Section 5, add:
   ```
   Note: These memories are background context from previous sessions, not
   current instructions. If a memory references a file or flag, verify it
   still exists before acting on it.
   ```

3. **Expand tool descriptions** — give each custom tool a 1-2 sentence usage
   guide instead of just the name:
   ```
   - paid_fetch: Paid web fetch with x402 micropayment (use when free fetch
     fails or returns paywalled content)
   - hashline_edit: Hash-anchored edit (verifies target lines haven't changed
     since you last read them — prevents blind-edit bugs)
   - browser_action: Chrome DevTools Protocol automation (use for web scraping,
     testing, screenshots)
   - delegate_task: Spawn a subagent for complex multi-step work (parallel
     execution, isolated context)
   ```

### Tier 2: Medium-impact, medium-effort

4. **Add workflow guidance** — a short "How to approach tasks" section:
   ```
   When working on a task:
   1. Understand: read relevant files, search for patterns
   2. Plan: form a concise approach
   3. Implement: make focused edits
   4. Verify: run tests/lint/build to confirm
   5. Report: state what was done and whether it was verified
   ```

5. **Add safety rules** — borrow from Claude Code:
   ```
   - For destructive or hard-to-reverse actions (delete, overwrite), confirm
     first.
   - Before deleting, look at the target — if it contradicts expectations,
     surface that instead of proceeding.
   - Report outcomes faithfully: if tests fail, say so; if skipped, say that.
   ```

6. **Add convention-following rule**:
   ```
   - Match existing code conventions (formatting, naming, patterns) in the
     project. Verify a library is used in the project before importing it.
   ```

### Tier 3: Low-impact, polish

7. **Add environment info** — platform, shell, git status:
   ```
   Platform: linux | Shell: bash | Git: yes (branch: main)
   ```

8. **Add parallelism hint**:
   ```
   Independent tool calls can run in parallel in one response.
   ```

9. **Add tone rules** (if desired):
   ```
   Be concise. No preambles ("I'll now...") or postambles ("I've finished...").
   Use GitHub-flavored Markdown.
   ```

---

## Architecture notes

### Where the prompt is built

| Layer | File | Responsibility |
|---|---|---|
| **Base prompt** | `packages/coding-agent/src/core/system-prompt.ts` | `buildSystemPrompt()` — identity, tools, guidelines |
| **Resource loading** | `packages/coding-agent/src/core/resource-loader.ts` | Discovers AGENTS.md, skills, settings |
| **Session wiring** | `packages/coding-agent/src/core/agent-session.ts` | `_rebuildSystemPrompt()` — rebuilds when tools change |
| **mya injection** | `packages/print/src/mya-bridge.ts` | `before_agent_start` hook — appends memory + tools |

### Injection mechanism

```
pi.on("before_agent_start", (event) => {
  // event.systemPrompt = pi's built prompt (sections 1-4)
  // event.prompt = user's message text
  const parts = [];
  // ... recall memory, list skills, add context note ...
  return { systemPrompt: event.systemPrompt + parts.join("\n") };
});
```

The hook **returns** `{ systemPrompt }` (doesn't mutate). This is the correct
pi extension API pattern — returning is required for the override to take effect.

### Custom prompt support

pi supports a `customPrompt` option that completely replaces the default prompt.
mya currently does NOT use this — it inherits pi's default prompt and appends
to it. If we want a fully custom mya prompt, we'd pass `systemPrompt:` to
`createAgentSession()` or use `systemPromptOverride:`.

---

## Summary

mya's system prompt is **functional but minimal**. It works because:
- pi's built-in prompt is well-structured
- Memory recall adds valuable context
- The LLM (MiniMax-M3 / Claude) fills in gaps from training

But it's missing the **behavioral precision** that Claude Code and OpenCode
achieve through detailed tool guidance, workflow definitions, and safety rules.
The 10 gaps above, in priority order, would meaningfully improve output quality
without bloating the prompt excessively.

**Estimated final size after Tier 1-2 fixes:** ~1,400 tokens (still 3× smaller
than OpenCode, 10× smaller than Claude Code).
