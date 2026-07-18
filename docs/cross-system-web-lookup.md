# Cross-System Web-Lookup Comparison

> READ-ONLY research audit. Studied 2026-07-18.
> Sources under `source/` and `vendored/`. All claims verified by reading source/prompt files.

## Comparison matrix

Key to **Mode**: Pull = fetch a known URL → content; Push = search query → ranked results; Interact = full browser automation (click/scroll/JS).

| # | System | Mode | Tool names | Browser model | Config burden | Native vs MCP | Source path |
|---|--------|------|------------|---------------|---------------|---------------|-------------|
| 1 | **pi-coding-agent** | **None** | (only `openBrowser` for OAuth login) | none | zero-config | — | `vendored/pi/dist/core/tools/index.js` |
| 2 | **oh-my-pi** | **Pull + Push + Interact** | `web_search`, `fetch`, `browser` | headless-built-in **+** CDP-attach (`cmux`) | needs-API-key (per search provider) | native | `source/oh-my-pi/packages/coding-agent/src/{tools/browser.ts,tools/fetch.ts,web/}` |
| 3 | **claw-code** | **None native** (MCP only) | — (separate `claw-rag-service` over HTTP) | none | MCP servers | MCP | `source/claw-code/rust/crates/tools/` |
| 4 | **openclaw** | **Pull + Push** | `web-content-core` (`kind: "search" \| "fetch"`), `net-policy` | none in core | needs-API-key | native | `source/openclaw/packages/web-content-core/src/provider-runtime-shared.ts` |
| 5 | **hermes-agent** | **Pull + Push + Interact** | `web_search_tool`, `web_extract_tool`, `browser`, `browser_camofox` | headless-built-in (Chromium) **+** cloud (Browserbase/Browser Use) **+** anti-detect (Camofox) | needs-API-key / needs-external-process | native | `source/hermes-agent/tools/{web_tools.py,browser_tool.py,browser_camofox.py}` |
| 6 | **Claude (claude.ai, Opus 4.8/4.7)** | **Pull + Push + Interact** | `web_search`, `web_fetch`, `navigate`, Computer-Use, MCP Apps | server-side browser (Anthropic-hosted) | zero-config (cloud) | native + MCP | `source/system_prompts_leaks/Anthropic/claude-opus-4.8.md` |
| 7 | **Claude Code** | **Pull + Push** | `WebFetch`, `WebSearch` | none (fetch only) | zero-config (cloud) | native | `source/system_prompts_leaks/Anthropic/Claude Code/claude-code-2.1.172-opus-4.8.md` |
| 8 | **Claude in Chrome** | **Interact** | browser tools (sees viewport screenshot) | attach-to-external-browser (Chrome ext) | needs-extension | native | `source/system_prompts_leaks/Anthropic/claude-in-chrome.md` |
| 9 | **Cursor** | **Pull + Push + Interact** | `WebSearch`, `WebFetch`, `browser-use` subagent, `CallMcpTool` | external browser (via subagent) | zero-config + MCP | native + MCP | `source/system_prompts_leaks/Cursor/cursor.md` |
| 10 | **opencode** | **None native** | (relies on MCP servers) | none | MCP | MCP | `source/system_prompts_leaks/Misc/opencode.md` |
| 11 | **Devin CLI** | **Pull** | `webfetch` | none (CLI); full Devin web app = browser-as-first-class | zero-config | native | `source/system_prompts_leaks/Misc/devin-cli.md` |
| 12 | **amp-code** | **Pull + Push** | `web_search`, `web_read` | none | zero-config | native | `source/system_prompts_leaks/Misc/amp-code.md` |
| 13 | **Gemini CLI** | **Pull + Interact** | `web_fetch`, `browser_agent` subagent | headless-built-in (subagent, accessibility tree) | needs-external-process | native | `source/system_prompts_leaks/Google/gemini-cli.md` |
| 14 | **Gemini in Chrome** | **Interact + Push** | browser + Google Search tool | attach-to-external-browser (Chrome) | needs-extension | native | `source/system_prompts_leaks/Google/gemini-in-chrome.md` |
| 15 | **ChatGPT (o3/o4-mini)** | **Pull + Push** | `web` (`search()` + `open_url()`) | server-side | zero-config (cloud) | native | `source/system_prompts_leaks/OpenAI/{o3.md,tool-web-search.md}` |
| 16 | **ChatGPT Deep Research** | **Pull + Push + Interact** | `research_kickoff_tool` (`start_research_task`) | server-side (autonomous multi-step) | zero-config | native | `source/system_prompts_leaks/OpenAI/tool-deep-research.md` |
| 17 | **Codex** | **Interact** | `control-chrome` skill (Playwright `tab.playwright`) | attach-to-external-browser (Chrome ext) | needs-extension | native skill | `source/system_prompts_leaks/OpenAI/Codex/control-chrome.md` |
| 18 | **Qwen** | **Pull + Push** | `web_search`, `web_extractor`, `web_search_image` | server-side | zero-config | native | `source/system_prompts_leaks/Qwen/qwen-3.6-plus.md` |
| 19 | **Perplexity Computer** | **Pull + Push + Interact + Connectors** | browse + `list_external_tools` (hundreds) | server-side browser + MCP connectors | zero-config + MCP | native + MCP | `source/system_prompts_leaks/Perplexity/perplexity-computer.md` |
| 20 | **Copilot CLI** | **Pull + Push** (research subagent) | `web_fetch`, `web_search` (subagent only; orchestrator delegates) | none | zero-config | native | `source/system_prompts_leaks/Microsoft/copilot-cli.md` |
| 21 | **Confer** | **Pull + Push** | `web_search`, `page_fetch` (rate-limited to 3-4 rounds) | server-side | zero-config (rate-limited) | native | `source/system_prompts_leaks/Misc/confer.md` |
| 22 | **Fellou Browser** | **Interact + Pull** | `deepAction`, `webpageQa` | built-in-browser (product *is* a browser) | zero-config | native | `source/system_prompts_leaks/Misc/fellou-browser.md` |
| 23 | **Mistral Code** | **Pull + Push** | `web_fetch`, `web_search` | none (fetch only) | zero-config | native | `source/system_prompts_leaks/Mistral/mistral-code.md` |
| 24 | **Zed** | **None** (OS-open only) | `open` (launches default app for a URL) | none | zero-config | native | `source/system_prompts_leaks/Misc/zed.md` |
| 25 | **Warp 2.0 agent** | **None** (explicit) | — (states "You do not have access to a web browser") | none | — | — | `source/system_prompts_leaks/Misc/warp-2.0-agent.md` |

---

## Verified evidence (quoted tool schemas/descriptions)

### pi-coding-agent — NONE
`vendored/pi/dist/core/tools/index.js:17`:
```js
export const allToolNames = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);
```
No `web`/`fetch`/`browse`/`search` tool is exposed to the model. The only browser-adjacent code is `utils/open-browser.js` (`openBrowser(target)`) used **solely** by `modes/interactive/components/login-dialog.js:88` to open an OAuth URL in the user's platform default browser. `fetch` matches in the dist are internal HTTP calls (version check at `interactive-mode.js:750`, GitHub release API at `utils/tools-manager.js:97`, `git fetch` in `package-manager.js`). **Verdict: pi core ships zero web-lookup tools** — consistent with its minimal-core philosophy (everything is an installable package).

### oh-my-pi — most sophisticated in the set
- **`web_search`** (`web/search/`): 20 swappable providers — `anthropic, brave, codex, duckduckgo, exa, firecrawl, gemini, jina, kagi, kimi, parallel, perplexity, searxng, tavily, tinyfish, xai, zai` (`source/oh-my-pi/packages/coding-agent/src/web/search/providers/`). One tool, N backends.
- **`fetch`** (`tools/fetch.ts`): HTTP pull with HTML→markdown (`htmlToMarkdown` from `pi-natives`), document conversion (PDF/DOCX/PPTX/XLSX/EPUB via `markit`), 75+ site-specific scrapers under `web/scrapers/` (arxiv, github, npm, pypi, stackoverflow, wikipedia, …).
- **`browser`** (`tools/browser.ts`): full Interact tool. Schema (`browserSchema`): `action: 'open'|'close'|'run'`, supports `cdp_url` (attach to existing CDP endpoint), `app.path` (spawn a binary), `viewport`, `wait_until` (`load|domcontentloaded|networkidle0|networkidle2`), `dialogs`, `code` (JS body to run in tab). Drives Chrome via the **`cmux`** (Chrome DevTools multiplexer) socket client; percepts via Aria accessibility snapshots (`browser/aria/aria-snapshot.ts`).

### claw-code — NONE native
`source/claw-code/rust/crates/tools/src/lib.rs` tools: only `lane_completion.rs`, `pdf_extract.rs`, `path_scope_enforcement.rs`. FS/bash tools only. Web retrieval, if any, comes from configured **MCP servers** or the separate `claw-rag-service` HTTP service (`retrieve_context` over HTTP). `.learned/claw-code.md` confirms "FS-only tools, MCP, plugin host runtime."

### openclaw — Pull + Push, no native browser
`source/openclaw/packages/web-content-core/src/provider-runtime-shared.ts:125`: `kind: "search" | "fetch"` — a unified web-content abstraction supporting both search and fetch modes. `net-policy` package = SSRF/domain egress policy as core. `.learned/openclaw.md`: "web-content-core (Web fetch/extract)" + "net-policy (Network egress policy as core)." No headless browser in core packages.

### hermes-agent — full Pull + Push + Interact
`source/hermes-agent/tools/web_tools.py` docstring: "Provides generic web tools … `web_search_tool` (Search the web) … `web_extract_tool` (Extract content from URLs). Backends: **Exa, Firecrawl, Parallel, Tavily**. Uses OpenRouter/Gemini 3 Flash for content summarization."
`source/hermes-agent/tools/browser_tool.py` docstring: "Browser automation tools using **agent-browser** CLI. Backends: **Browser Use** (cloud), **Browserbase** (cloud), **local Chromium** (headless, zero-cost). Uses accessibility tree (`ariaSnapshot`) for text-based page representation … element interaction via ref selectors (`@e1`, `@e2`)."
Plus `browser_camofox.py`: "Camofox browser backend — local **anti-detection** browser via REST API (Camoufox/Firefox)."

### Claude (claude.ai) — web_search + web_fetch + navigate + Computer-Use
`source/system_prompts_leaks/Anthropic/claude-opus-4.8.md` `<search_first>`: "Claude has the **web_search** tool. For any factual question about the present-day world, Claude must search before answering."
`claude-opus-4.7.md:1065`: "Claude has web_search and other info-retrieval tools. web_search uses a search engine and returns the top 10 results."`; `:1098` "Tool priority: (1) internal tools, (2) web_search/web_fetch for external info"; `:2942` `web_fetch` "can only fetch EXACT URLs that have been provided directly by the user or have been returned in results from web_search/web_fetch."
`claude-opus-4.8.md` MCP App flow: on a connector miss → "call **navigate** with the best URL" — i.e. a server-side browser. Plus `<computer_use>` (Linux Ubuntu 24 computer).

### Claude Code — WebFetch + WebSearch
`source/system_prompts_leaks/Anthropic/Claude Code/claude-code-2.1.172-opus-4.8.md:1487`:
> **`WebFetch`** — "Fetches a URL, converts the page to markdown, and answers `prompt` against it using a small fast model. … Responses are cached for 15 minutes per URL."
> **`WebSearch`** — "Search the web. Returns result blocks with titles and URLs. US-only. `allowed_domains`/`blocked_domains` filter results."

### Cursor — WebSearch + WebFetch + browser-use subagent + MCP
`source/system_prompts_leaks/Cursor/cursor.md` Available Tools lists: `WebSearch` ("Search the web for real-time information"), `WebFetch` ("Fetch content from a specified URL … readable markdown format"), plus a `browser-use` subagent type ("Perform browser-based testing and web automation"), and `CallMcpTool` for MCP. (Contrary to the task's hypothesis, Cursor **does** have native web tools.)

### opencode — NONE native (MCP-only)
`source/system_prompts_leaks/Misc/opencode.md`: tool set is `read`, `write`, `edit`, `grep`, `glob`, `bash`. No web tool declared. Web lookup would come from user-configured MCP servers.

### Devin CLI — webfetch
`source/system_prompts_leaks/Misc/devin-cli.md:104`: "When **webfetch** returns a redirect, immediately follow it with a new request." The CLI ships a Pull fetch tool; the full Devin *web product* treats the browser as first-class (not captured in this CLI prompt).

### amp-code — web_search + web_read
`source/system_prompts_leaks/Misc/amp-code.md:731` tool-name mapping table: `${Vq}` → `web_search`, `${mu}` → `web_read`. (`:419` "uses web_search and web_read to find and read the library documentation.")

### Gemini CLI — web_fetch + browser_agent subagent
`source/system_prompts_leaks/Google/gemini-cli.md:107-108`:
> `<name>`**browser_agent**`</name>` — "Specialized autonomous agent for interactive web browser automation requiring real browser rendering. Delegate tasks that require clicking, form-filling, navigating multi-step flows … Do NOT delegate … for simply reading, summarizing, or extracting content from URLs — use the **web_fetch** tool or other available tools for that instead."

### Gemini in Chrome — attach-to-Chrome browser
`source/system_prompts_leaks/Google/gemini-in-chrome.md:38,44`: "You are currently assisting a user in the Chrome Browser … receiving information from the user's shared web pages, including their text content and a screenshot of the current viewport." Plus a Google Search tool for fresh info.

### ChatGPT (o3/o4-mini) — web tool (search + open_url)
`source/system_prompts_leaks/OpenAI/tool-web-search.md`: "The **`web`** tool has the following commands: `search()` (Issues a new query to a search engine) … `open_url(url)` (Opens the given URL and displays it)." Deprecated: the old `browser` tool ("Do not attempt to use the old `browser` tool … deprecated or disabled"). `o3.md:8`: "You *must* browse the web for *any* query that could benefit from up-to-date information."

### ChatGPT Deep Research — research_kickoff_tool
`source/system_prompts_leaks/OpenAI/tool-deep-research.md`: "Your primary purpose is to help users with tasks that require extensive online research using the **research_kickoff_tool**'s `clarify_with_text`, and `start_research_task` methods … able to do extensive online research and carry out data analysis."

### Codex — control-chrome skill (Playwright)
`source/system_prompts_leaks/OpenAI/Codex/control-chrome.md`: "Control the user's Chrome browser for tasks that depend on existing Chrome state: tabs, logged-in sessions, cookies, or extensions … using the `chrome` backend." Uses `tab.playwright` API; routes through a Chrome Extension (`agent.browsers.get("extension")`).

### Qwen — web_search + web_extractor + web_search_image
`source/system_prompts_leaks/Qwen/qwen-3.6-plus.md`:
> `web_search` — "Search for information from the internet." (`queries` array)
> `web_extractor` — "Crawl webpage content, and if given a goal, further summarize the relevant content of the webpage(s)."

### Perplexity Computer — browse + external connectors
`source/system_prompts_leaks/Perplexity/perplexity-computer.md`: "I run parallel agents across 20+ AI models, **browse the web for you**, plug into your favorite apps … You have access to hundreds of external connectors (Slack, email, calendars, analytics, databases) via `list_external_tools` — always call it before saying you can't access something."

### Copilot CLI — web_fetch + web_search (research subagent)
`source/system_prompts_leaks/Microsoft/copilot-cli.md`: the orchestrator forbids web tools ("X `web_fetch`, `web_search` — forbidden (delegate to subagent)") but the **research subagent** (the `task` agent_type:"research") lists them under "# Web and local tools: `web_fetch`, `web_search`" (`:1112-1113`). So web lookup exists but is delegated to a subagent.

### Confer — web_search + page_fetch (rate-limited)
`source/system_prompts_leaks/Misc/confer.md`: "You have access to **web_search** and **page_fetch** tools, but tool calls are limited. Be efficient … Do not exceed 3-4 total rounds of tool calls per response." `page_fetch` = "Fetch and extract the full content from one or more webpage URLs (max 20)."

### Fellou Browser — deepAction + webpageQa
`source/system_prompts_leaks/Misc/fellou-browser.md`: the product is itself a browser. `deepAction` = "Delegate tasks to a Javis AI assistant … full control over … browser agent … browse the internet to query information, write code, perform direct operations." `webpageQa` = read-only content extraction from a tab ("does not interact with or operate web pages").

### Mistral Code — web_fetch + web_search
`source/system_prompts_leaks/Mistral/mistral-code.md:251,281`:
> `web_fetch` — "Fetch content from a URL. Converts HTML to markdown for readability."
> `web_search` — "Search the web for current information."

### Zed — OS-open only (not a lookup tool)
`source/system_prompts_leaks/Misc/zed.md`: `open` — "opens a file or URL with the default application … can open a web browser with a URL." Not a fetch/search tool (no content returned to the model).

### Warp 2.0 agent — explicit none
`source/system_prompts_leaks/Misc/warp-2.0-agent.md:3`: "you do not have access to a web browser."

---

## Notable patterns

1. **"Search-then-fetch" is the dominant minimum viable pair.** Nearly every harness that offers web capability ships two complementary native tools: a **Push** search (`web_search`/`WebSearch`) and a **Pull** fetch (`web_fetch`/`WebFetch`/`web_extract`/`web_read`/`page_fetch`). This pair recurs verbatim across Claude, Claude Code, Cursor, ChatGPT, Qwen, Mistral Code, amp-code, Confer, Copilot CLI, hermes, oh-my-pi. The search tool discovers candidates; the fetch tool reads the chosen URL. (Anthropic even hard-codes the ordering: web_search before web_fetch, and web_fetch "can only fetch URLs returned by web_search or given by the user.")

2. **Three distinct browser architectures, cleanly separable:**
   - **Server-side / cloud-hosted browser** (Claude's `navigate`, ChatGPT, Perplexity, Gemini-in-Chrome) — zero local config, the vendor runs the browser.
   - **Attach to the user's real browser via extension/CDP** (Claude in Chrome, Codex `control-chrome`, Gemini in Chrome) — inherits the user's logged-in sessions/cookies.
   - **Headless browser built into the agent process** (oh-my-pi `cmux`/CDP, hermes `agent-browser`+local Chromium, Gemini CLI `browser_agent`) — needs local Chromium install or bundled binary, but no cloud dependency.

3. **"No web tool at all" is a deliberate, recurring stance for terminal coding agents.** pi-coding-agent, claw-code, opencode, Zed, and Warp 2.0 all ship **zero** native web-lookup. Two rationales emerge: (a) **minimal-core philosophy** (pi — "ship a tiny core, everything is a package"; opencode — defer to MCP servers), and (b) **terminal-purity** (Warp: "you do not have access to a web browser"). This validates that web access is an *opt-in capability*, not a baseline, for code-centric agents.

4. **Interact (full browser automation) is the differentiator, not Pull/Push.** Pull+Push is now table stakes; the real sophistication gap is whether the agent can *drive* a browser. The agents with true Interact: oh-my-pi, hermes-agent, Claude (claude.ai + Claude-in-Chrome), Cursor (browser-use subagent), Gemini CLI (browser_agent), Gemini-in-Chrome, Codex (control-chrome), Perplexity, Fellou. Everyone else stops at fetch.

5. **Delegation/as-subagent is a common browser pattern.** Cursor, Gemini CLI, and Copilot CLI all isolate the heavyweight browser/research capability in a **subagent** rather than the main loop — keeping the main context lean and letting the subagent burn many turns in isolation. Cursor's `browser-use`, Gemini's `browser_agent`, and Copilot's research subagent (which holds `web_fetch`/`web_search` while the orchestrator is forbidden from using them) all follow this.

6. **Provider-agnostic search backends are the self-hostable agents' lever.** oh-my-pi (20 search providers) and hermes (4 backends: Exa/Firecrawl/Parallel/Tavily) both abstract "search" behind a swappable backend so the operator picks free (DuckDuckGo/SearXNG) vs paid-quality (Tavily/Exa/Kagi). Cloud products (Claude, ChatGPT) bake one search engine in.

7. **Structured site-specific scrapers > generic fetch for code/docs.** oh-my-pi ships 75+ domain scrapers (arxiv, github, npm, pypi, stackoverflow, mdn, docs.rs, …) that extract structured content rather than generic HTML→markdown. This is the highest-fidelity Pull strategy in the set and a notable competitive moat for a coding agent.

8. **Anti-detection browsers appear only in the maximalist self-hosted agents.** hermes-agent's `browser_camofox` (Camoufox/Firefox anti-fingerprinting) is unique — cloud products don't need it (they use their own server-side farm), and minimal agents don't have a browser at all. This signals a "research/spidering at scale" use case.

9. **Egress/network policy as a first-class concern (self-hosted only).** openclaw (`net-policy` core package) and oh-my-pi treat domain allow/deny + SSRF as core, because they run *locally* and hit arbitrary user-supplied URLs. Cloud products don't expose this — the vendor's infra handles it. hermes's `website_policy.py` is the same idea.

10. **MCP is the "bring your own web tool" escape hatch for the no-native-tool agents.** opencode, claw-code, Cursor (`CallMcpTool`), Perplexity (`list_external_tools`), and Claude (MCP Apps) all let web/search capability arrive via MCP servers rather than built-in. This is how a minimal-core agent gains web access without compiling it in.

---

## Approaches ranked by sophistication

**Tier 1 — Full Pull + Push + Interact, self-hostable, multi-backend (most sophisticated):**
1. **oh-my-pi** — 20-provider `web_search` + `fetch` with 75+ structured scrapers + `browser` (CDP attach + headless, Aria snapshots). Deepest, most configurable.
2. **hermes-agent** — `web_search`/`web_extract` (4 backends) + `browser` (3 backends: local Chromium/Browserbase/Browser Use) + Camofox anti-detection.

**Tier 1 — Full Pull + Push + Interact, cloud-integrated:**
3. **Claude (claude.ai)** — `web_search` + `web_fetch` + server-side `navigate` browser + Computer-Use + MCP Apps. Broadest surface, zero local config.
4. **Perplexity Computer** — browse + hundreds of external connectors (MCP-style) + parallel multi-model research.

**Tier 2 — Pull + Push + Interact via subagent:**
5. **Cursor** — `WebSearch`/`WebFetch` + `browser-use` subagent + MCP.
6. **Gemini CLI** — `web_fetch` + `browser_agent` subagent (accessibility-tree interaction).
7. **Copilot CLI** — research subagent owns `web_fetch`/`web_search`; orchestrator delegates.

**Tier 2 — Pull + Push + Interact, single browser surface:**
8. **Codex** — `control-chrome` (Playwright over user's Chrome via extension).
9. **Claude in Chrome** / **Gemini in Chrome** — attach-to-browser, viewport-screenshot driven.
10. **ChatGPT Deep Research** — autonomous multi-step `research_kickoff_tool`.
11. **Fellou** — product *is* a browser; `deepAction` + `webpageQa`.

**Tier 3 — Pull + Push only (no browser automation):**
12. **Claude Code** — `WebFetch` + `WebSearch`.
13. **ChatGPT (o3/o4)** — `web` tool (`search` + `open_url`).
14. **Qwen** — `web_search` + `web_extractor` + `web_search_image`.
15. **Mistral Code** — `web_fetch` + `web_search`.
16. **amp-code** — `web_search` + `web_read`.
17. **Confer** — `web_search` + `page_fetch` (rate-limited).
18. **Devin CLI** — `webfetch` (Pull only).
19. **openclaw** — `web-content-core` (`search` + `fetch` kinds) + `net-policy`.

**Tier 4 — None native (MCP/extension brings web access):**
20. **opencode** — MCP-only.
21. **claw-code** — MCP + separate RAG-over-HTTP service.

**Tier 5 — None (explicit, by design):**
22. **pi-coding-agent** — minimal core; web tools are installable packages.
23. **Zed** — only `open` (OS default app; no content returned).
24. **Warp 2.0** — explicitly no browser.

---

## Key takeaways for a harness designer

- **Ship the search+fetch pair as a single swappable abstraction** (oh-my-pi/hermes model): one `web_search` tool, N pluggable backends, paired with a `fetch` that does HTML→markdown + document conversion.
- **Treat full-browser Interact as a separate, optional subagent** (Cursor/Gemini/Copilot pattern) — don't pollute the main loop's context; let the browser subagent run many isolated turns.
- **For a local/self-hosted agent, add `net-policy` (SSRF/allow-deny) as core** (openclaw) — you will hit arbitrary user URLs.
- **Domain-specific structured scrapers beat generic fetch for coding/docs** (oh-my-pi's 75+) — high-fidelity Pull is a real differentiator.
- **The minimal-core agents prove web access is optional, not baseline** — pi, opencode, claw-code, Warp, Zed all ship without it, validating that web lookup belongs in an opt-in package/extension rather than the core loop.

---

## Round 2 — full `source/` scan (corrections & additions)

> The first pass sampled ~25 systems. A systematic `grep` of the full `source/system_prompts_leaks/` corpus (~120 files) plus the ~33 cloned repos under `source/` surfaced **10 more web-relevant systems** and corrected two claims. All paths below are under `/home/bom/source/my-agent/source/`.

### Newly examined systems

| System | Mode | Tool names | Note | Source |
|---|---|---|---|---|
| **pi-computer-use** (origin of mya `browser_action`) | Interact (CDP) | `launch_browser`, **`navigate_browser`**, `evaluate_browser` + `act_ui`/`observe_ui`/`read_text`/`wait_for` (11 tools total) | mya's port dropped the first 3 → can't navigate/launch | `pi-computer-use/extensions/computer-use.ts` |
| **Jules** (Google coding agent) | Pull + Push + KB | `google_search`, `view_text_website`, `view_image`, `knowledgebase_lookup` | Clean search→fetch pair + offline KB fallback for npm/django | `system_prompts_leaks/Google/jules.md` |
| **Claude Cowork Dispatch** | Pull + Push + Interact (3-tier) | dedicated-MCP → `mcp__Claude_in_Chrome__*` (DOM) → `computer-use` (pixel) | Tool-tiering doctrine; **"never click web links with computer-use"**; `ToolSearch` bulk-load (`{query:"chrome",max_results:20}`); per-app `request_access` | `system_prompts_leaks/Anthropic/claude-cowork-dispatch.md` |
| **Codex in-app-browser** | Interact | `iab` browser skill (open/navigate/click/type/screenshot) | **Background by default**; only show when user wants to watch; "presence of Computer-Use tools ≠ Computer-Use is preferred" | `system_prompts_leaks/OpenAI/Codex/control-in-app-browser.md` |
| **Perplexity Comet** | Interact + Pull | `control_browser`, `use_current_page`, page review | Browser-native agent (like Fellou); review-then-act loop | `system_prompts_leaks/Perplexity/comet-browser-assistant.md` |
| **ChatGPT agent mode** | Interact + Pull + Push | browser + computer tools | **Visual-browser-first** doctrine: use browser when search-summary insufficient (live price, JS-render, reservations, visual signals) | `system_prompts_leaks/OpenAI/chatgpt-gpt-5-agent-mode.md` |
| **grok-build** (xAI coding) | MCP | `search_tool` (lazy schema) + `use_tool` | Tools arrive via connected MCP servers; **`search_tool` to fetch schema before EVERY first use**; persistent memory | `system_prompts_leaks/xAI/grok-build.md` |
| **vscode-copilot-agent** | Pull (scoped) | `fetch_copilot_cli_documentation` | Scoped-to-own-docs pull; tool preference order code-intelligence > glob > grep > bash | `system_prompts_leaks/Microsoft/vscode-copilot-agent.md` |
| **MyAgents** (personal desktop agent) | Pull + Interact (MCP) | `curl`, `fetch`, `mcp__playwright__browser_snapshot` | Desktop personal agent; browser via **Playwright MCP** | `source/MyAgents/` |
| **gbrain** | Pull + Synthesis + Graph | `gbrain search` (hybrid: vector+keyword+RRF+source-tier+reranker) → synthesized cited answer + gap analysis + self-wiring entity graph | "Search finds pages, the brain writes the answer"; plugs into Claude Code/Codex as retrieval layer | `source/gbrain/` |

### New patterns surfaced in Round 2

11. **Browser-tool tiering is a real doctrine (Claude Cowork).** Three layers with a strict routing rule: (1) dedicated app MCP → (2) browser/DOM MCP (`Claude in Chrome`) → (3) Computer Use (pixel). Hard rule: **never `left_click` a web link via computer-use — route it to the browser MCP instead.** Browsers get a "read" tier (screenshots OK, clicks blocked) vs an "interact" tier. This is more disciplined than any single-tool approach.

12. **Deferred-tool bulk-load (ToolSearch) is how big toolkits stay cheap.** Claude Cowork loads an entire toolkit in ONE query (`{query:"chrome",max_results:20}`) instead of N round-trips. grok's `search_tool`-before-`use_tool` is the same idea (lazy schema). mya registers everything up front — relevant if the tool surface grows.

13. **"Background browser by default" (Codex iab).** Show the browser only when the user explicitly wants to watch; keep it headless otherwise. Reduces UI noise and matches the "browser as means, not end" principle.

14. **Visual-browser-first vs search-summary-first is a real decision (ChatGPT agent-mode).** Search summaries fail for: live prices, JS-rendered content, reservations/availability, tabular/interactive layouts, visual UI signals. The prompt encodes *when* to escalate from search to full browser.

15. **Search-vs-synthesis is the frontier (gbrain).** The jump from "10 chunks that mention your query" to "a cited answer + explicit note on what's unknown (gap analysis)" is the differentiator. Hybrid scoring (vector + keyword + RRF + source-tier + reranker) + self-wiring entity graph (no-LLM edge extraction). mya's `semantic_search` is the chunk level; gbrain shows the synthesis level.

16. **Playwright-as-MCP is the pragmatic browser-on-ramp (MyAgents).** Rather than build a CDP client (mya/pi-computer-use) or bundle Chromium, delegate browser automation to the **Playwright MCP server**. Zero custom browser code; one MCP server config.

### Corrections to Round 1

- **mya-v1 did NOT have a real `web_search`.** The `web_search` string in `source/mya-v1/crates/mya-providers/src/compatible.rs` is a **placeholder tool name in provider-compat TEST FIXTURES** (mock tool-calls testing how MiniMax/xAI parse tool messages), not an implementation. mya has never had native web lookup.
- **`browser_*` is headless-only** (confirmed in mya audit) — the richer toolset in `packages/tools/src/browser.ts` is not wired into the TUI.
- **Most "web" hits in cloned repos are false positives**: `openpi` = Electron workbench wrapping Pi (HTTP clients for the bridge, not agent web tools); `pptx` skill uses `playwright` for html→pptx rendering; `headroom`/`context-mode`/`agentmemory`/`graphify` = context/memory systems, not web lookup.

### Revised tier placement

Adding to the ranking:
- **Tier 1 (full + disciplined routing):** Claude Cowork Dispatch (3-tier + access control).
- **Tier 2 (Pull+Push+Interact, single browser / via MCP):** Jules, grok-build (MCP), MyAgents (Playwright MCP), Codex in-app-browser, Perplexity Comet, ChatGPT agent-mode.
- **Tier 3 (synthesis over search — new category):** gbrain (answer+citations+gap-analysis, plugs into existing agents).
- **Tier 3 (Pull scoped):** vscode-copilot-agent.

mya remains at the **Tier 4/5 boundary** (TUI effectively has no zero-config web tool), but now with a concrete, low-effort upgrade path: **re-port the 3 dropped pi-computer-use browser tools** + add a Playwright-MCP server entry to the (already-fixed) MCP lifecycle.
