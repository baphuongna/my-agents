# Extension Model (packages)

> Part of the Unified Agent SPEC — see [00-OVERVIEW.md](00-OVERVIEW.md). Section §17.



## 17. Extension Model (packages)

*(source: [pi-coding-agent](../../pi-coding-agent/) philosophy)* **Four** extension kinds, each an installable npm/git **package**:
| Kind | What it adds | Example |
|---|---|---|
| **Extensions** | new tool(s) / commands / events / UI (Extensions subsume tools + commands + events + UI) | a `database_query` tool |
| **Skills** | progressive-disclosure knowledge | a `refactor-database` skill |
| **Prompt Templates** | system-prompt tiers / roles | a `code-reviewer` role |
| **Themes** | TUI/visual | a color theme |

> The 4 runtime modes — interactive (TUI) · print (--json flag) · rpc (stdio JSON-RPC) · sdk (embedded lib) — are **built-in**, not a package kind.

- **Core = interfaces + host; packages = implementations.** The frozen core defines *traits/interfaces* (`MemoryBackend`, `Tool`, `ChannelAdapter`, `SkillSource`, `SubagentRunner`, `Hook`) + the *host* that loads/registers/schedules them. Every concrete capability (a specific memory backend, a Telegram channel, a plan-mode) ships as a **package** that satisfies a core interface. This resolves the core-vs-package tension: the loop depends only on interfaces, so "memory is a package" and "the loop touches memory only via `MemoryManager`" are both true. *(source: [pi](../../pi-coding-agent/) core/host + [hermes](../../hermes-agent/) single-integration-point, unified.)*
- Packages register at install time; **core stays frozen**. Subagents, plan-mode, memory backends, channels = all packages, not core. *(source: [pi](../../pi-coding-agent/) "deliberate omission".)*
- Packages consume the **Rust natives** as a prebuilt napi module — no Rust compilation for package authors.

**Package manifest (round 17):**
```ts
// Every package ships an `agent-package.json` (skills use SKILL.md frontmatter) declaring its kind:
interface PackageManifest {
  name: string; version: semver;         // pinned in the user lockfile
  kind: ("extensions"|"skills"|"prompt-templates"|"themes")[];
  apiVersion: string;                    // must intersect core's supported range or refuse-load
  provides: { tools?: string[]; skills?: string[] };
  permissions?: { tools?: string[]; egress?: string[] };  // advisory intent declarations
  // R30 sandbox-removal: NO module-isolation tiers. Packages run IN-PROCESS (loaded via jiti,
  //   like pi extensions) — they are TRUSTED CODE, the same trust as any npm dependency you install.
  //   (Drops the prior in-process/worker/isolated-vm tiers + the runtime module-load allowlist.)
  // R27-12/T3: prebuilt napi binary declaration. abiStamp/napiVersion are COMPATIBILITY guards; the
  //   SECURITY gate is sigstore signature + SHA-256 content-hash pinned in the release lockfile,
//   verified BEFORE dlopen (RELEASE-BLOCKER for third-party native, [§23](11-invariants-roadmap.md) #6).
  native?: { abiStamp: string; napiVersion: number; sigstore: true; contentHash: string };
  scripts?: string[];                  // install-time scripts; run AFTER verify. No OS sandbox (R30) — trusted like any npm install script (--ignore-scripts still default)
}
// Lifecycle (R25-27): install (--ignore-scripts) → verify(apiVersion + signature) → register → (lazy) activate.
//   install runs with --ignore-scripts (npm preinstall/postinstall/prepare disabled by default —
//   arbitrary code does NOT run at install). A package requiring install-time scripts must declare
//   them in PackageManifest.scripts; they run AFTER verification — there is no OS sandbox (R30),
//   so declared scripts are trusted like any npm install script (still gated behind --ignore-scripts default-off).
//   verify(apiVersion + signature) — signature scheme = sigstore (resolves [§23](11-invariants-roadmap.md) #6; for third-party native
//   it is a RELEASE-BLOCKER per R27-12). (R25-30 widened)
// Trust model (R30 sandbox-removal — supersedes the R27-11 module-isolation tiers): packages run
//   IN-PROCESS (loaded via jiti, like pi extensions). They are TRUSTED CODE — the same trust as
//   any npm dependency you install. The static lint banning import "node:fs"/"node:child_process"/
//   "node:net" in package code is ADVISORY BEST-PRACTICE, NOT a boundary (it is bypassable via
//   eval, dynamic import, globals Bun.spawn/fetch, transitive deps — we do not pretend otherwise).
//   There is no runtime module-load allowlist and no worker/isolated-vm tier: register/activate
//   runs top-level module code IN-PROCESS, a code-execution trust accepted like `npm install`.
//   permissions.egress/permissions.tools are advisory intent declarations. The ONLY hard gate for
//   NATIVE code is the third-party napi sigstore policy below (loading a .node is arbitrary native
//   code — that gate STAYS; it is orthogonal to dropping the sandbox). deny-by-default egress remains
//   good hygiene; never another package's internals nor FS outside its data dir.
```
- **Third-party napi policy (R25-29 / R27-12):** a package MAY ship a prebuilt napi binary under `<pkg>/native/<platform>-<arch>.node` IFF it declares `native:{abiStamp,napiVersion,sigstore,contentHash}`, the host verifies the **sigstore signature + SHA-256 content-hash pinned in the release lockfile BEFORE `dlopen`** (RELEASE-BLOCKER for third-party `native`), verifies the stamp against its supported `napi_abi` range at load, and the user's config explicitly enables native packages (deny-by-default). Every napi entry wraps its body in `catch_unwind` returning `NativeResult` ([§14b Crash Resilience](08-observability-security.md)) — natives MUST NOT `abort!`/`process::exit`. Perf-critical packages that can't meet this MUST degrade to TS with a documented perf cliff.
- **Dependency rule (workspace-lint-enforced):** `core` depends on the `{ai, extensions, memory, prompts}` *interface* packages + `natives`; packages (impl) depend inward on core, never the reverse — `core` NEVER depends on `channels`/`gateway`/`skills`/`subagents`/`memory-backends` impl packages; the dependency arrow always points inward to core. *(import-direction-acyclic — madge/ESLint-enforced; core has no upward imports; SSOT-preserving.)*

---
