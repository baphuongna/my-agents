# Phase 1: Move pi-intercom into `packages/intercom/` as a mya Package

> Depends on: (none — foundation phase)
> Estimated: 2h
> Spec reference: §4 (Broker), §2.1 (PiInProcessRuntime — extension registration), IC3, IC9

## Objective

Move the pi-intercom extension from `source/pi-intercom/` (standalone npm package,
`pi install npm:pi-intercom`) into `packages/intercom/` as a proper `@my-agent/intercom`
workspace package. The package's default export becomes a loadable **extension factory**
that PiInProcessRuntime registers alongside `mya-bridge` in Phase 4.

**Why before everything else:** PiInProcessRuntime (Phase 4) and RuntimePool messaging
(Phase 11) both depend on `@my-agent/intercom` being importable as `import piIntercomFactory from "@my-agent/intercom"`.
This phase makes that import work.

**IC3 decision (decided, final):** pi-intercom is the **second extension** alongside
mya-bridge. No `MYA_BROKER_SOCKET` environment variable. No `BrokerClientFactory`.
Pi-intercom **self-manages** its broker lifecycle via `PI_CODING_AGENT_DIR`, which mya
sets to `~/.mya/agent` at startup. The broker socket, PID, config, and all runtime
files live under `$PI_CODING_AGENT_DIR/intercom/`.

## Deliverables

- `packages/intercom/package.json` — workspace package `@my-agent/intercom`
- `packages/intercom/tsconfig.json` — extends `../../tsconfig.base.json`
- `packages/intercom/src/index.ts` — re-exports the default extension factory
- `packages/intercom/src/` — moved source files from `source/pi-intercom/`
- `packages/intercom/src/types.ts` — protocol types (moved verbatim)
- `packages/intercom/src/config.ts` — config loading (moved verbatim)
- `packages/intercom/src/cwd.ts` — cwd comparison helper (moved verbatim)
- `packages/intercom/src/extension-api.ts` — extension channel API (moved verbatim)
- `packages/intercom/src/format-context.ts` — context formatting (moved verbatim)
- `packages/intercom/src/reply-tracker.ts` — reply tracking (moved verbatim)
- `packages/intercom/src/broker/` — broker + client + framing + paths + spawn (moved verbatim)
- `packages/intercom/src/ui/` — TUI overlays (moved verbatim)
- `packages/intercom/src/skills/pi-intercom/SKILL.md` — bundled skill (moved verbatim)
- `packages/print/src/intercom-extension.test.ts` — `[smoke]` test
- `packages/intercom/README.md` — adapted README (mya context)

## Implementation Steps

### Step 1 — Create `packages/intercom/package.json`

```jsonc
// packages/intercom/package.json
{
  "name": "@my-agent/intercom",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts"
    },
    "./types": {
      "types": "./src/types.ts",
      "import": "./src/types.ts"
    },
    "./extension-api": {
      "types": "./src/extension-api.ts",
      "import": "./src/extension-api.ts"
    },
    "./broker/client": {
      "types": "./src/broker/client.ts",
      "import": "./src/broker/client.ts"
    },
    "./broker/paths": {
      "types": "./src/broker/paths.ts",
      "import": "./src/broker/paths.ts"
    }
  },
  "scripts": {
    "test": "tsx --test src/**/*.test.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {},
  "peerDependencies": {
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
    "typebox": "*"
  }
}
```

> **Note on `main`/`types`:** Since this is a `private: true` workspace package
> consumed by `@my-agent/print` (which also runs via `tsx` without building to
> dist), we point `main` and `types` at `./src/index.ts` directly. If a dist build
> is later needed for packaging, update to `./dist/index.js` + `./dist/index.d.ts`
> and add a `build` script.

### Step 2 — Create `packages/intercom/tsconfig.json`

```jsonc
// packages/intercom/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true
  },
  "include": ["src/**/*.ts"]
}
```

### Step 3 — Move source files (IC9)

Copy every `.ts` file from `source/pi-intercom/` into `packages/intercom/src/`,
preserving the directory structure. The move is mechanical — no code changes to
the intercom logic itself.

```
source/pi-intercom/index.ts              → packages/intercom/src/index.ts
source/pi-intercom/types.ts              → packages/intercom/src/types.ts
source/pi-intercom/config.ts             → packages/intercom/src/config.ts
source/pi-intercom/cwd.ts                → packages/intercom/src/cwd.ts
source/pi-intercom/extension-api.ts      → packages/intercom/src/extension-api.ts
source/pi-intercom/format-context.ts     → packages/intercom/src/format-context.ts
source/pi-intercom/reply-tracker.ts      → packages/intercom/src/reply-tracker.ts
source/pi-intercom/reply-tracker.test.ts → packages/intercom/src/reply-tracker.test.ts
source/pi-intercom/config.test.ts        → packages/intercom/src/config.test.ts
source/pi-intercom/cwd.test.ts           → packages/intercom/src/cwd.test.ts
source/pi-intercom/format-context.test.ts→ packages/intercom/src/format-context.test.ts
source/pi-intercom/broker/*              → packages/intercom/src/broker/*
source/pi-intercom/broker/*.test.ts      → packages/intercom/src/broker/*.test.ts
source/pi-intercom/ui/*                  → packages/intercom/src/ui/*
source/pi-intercom/skills/*              → packages/intercom/src/skills/*
```

> **Do NOT delete** `source/pi-intercom/` in this phase. The standalone npm
> package remains publishable and functional for pi users who install via
> `pi install npm:pi-intercom`. The move is a **copy**, not a migration.
> A future cleanup phase can remove the standalone version if desired.

### Step 4 — Create `packages/intercom/src/index.ts`

The existing `source/pi-intercom/index.ts` IS the extension factory — its default
export is `piIntercomExtension(pi: ExtensionAPI) => void`. We create a new barrel
`src/index.ts` that re-exports it cleanly:

```typescript
// packages/intercom/src/index.ts

/**
 * @my-agent/intercom — pi-intercom extension factory for the mya platform.
 *
 * Default export: an ExtensionFactory function `(pi: ExtensionAPI) => void`
 * that registers the intercom tool, UI overlays, broker client, and skills.
 *
 * Registered as the SECOND extension alongside mya-bridge in PiInProcessRuntime.
 *
 * IC3 decision: No MYA_BROKER_SOCKET. The broker self-manages via
 * PI_CODING_AGENT_DIR (set to ~/.mya/agent by mya). Runtime files live at
 * $PI_CODING_AGENT_DIR/intercom/ (broker.sock, broker.pid, config.json, etc.).
 */

// The actual extension entry point — all the tool registration, broker client
// connection, UI overlay wiring, and skill loading happens inside here.
export { default } from "./intercom.js";

// Re-export public types for consumers (Phase 4, Phase 11)
export type {
  SessionInfo,
  Message,
  Attachment,
  MessageReceiptStatus,
  MessageReceipt,
  MessageControl,
  ExtensionCapability,
  SessionRegistration,
  ClientMessage,
  BrokerMessage,
} from "./types.js";

export type { IntercomConfig, InboundTriggerPolicy } from "./config.js";
export type { IntercomExtensionChannel, IntercomExtensionRegistration } from "./extension-api.js";

// Re-export the IntercomClient class for Phase 11 (inter-agent messaging)
export { IntercomClient } from "./broker/client.js";
```

> **Rename note:** The moved `source/pi-intercom/index.ts` is renamed to
> `packages/intercom/src/intercom.ts` (the actual extension implementation).
> The new `src/index.ts` is a thin re-export barrel. This avoids confusion
> between "the package entry point" and "the extension function."

### Step 5 — Fix internal import paths (`.ts` → `.js`)

The original pi-intercom uses `.ts` extensions in imports (e.g.,
`import { IntercomClient } from "./broker/client.ts"`). Under mya's TypeScript
ESM config (`tsconfig.base.json` with `moduleResolution: "bundler"` or
`"node16"`), imports must use `.js` extensions for compiled output compatibility.

**Search-and-replace within `packages/intercom/src/`:**
- `from "./broker/client.ts"` → `from "./broker/client.js"`
- `from "./broker/paths.ts"` → `from "./broker/paths.js"`
- `from "./broker/spawn.ts"` → `from "./broker/spawn.js"`
- `from "./broker/framing.ts"` → `from "./broker/framing.js"`
- `from "./types.ts"` → `from "./types.js"`
- `from "./config.ts"` → `from "./config.js"`
- `from "./cwd.ts"` → `from "./cwd.js"`
- `from "./extension-api.ts"` → `from "./extension-api.js"`
- `from "./format-context.ts"` → `from "./format-context.js"`
- `from "./reply-tracker.ts"` → `from "./reply-tracker.js"`
- `from "../types.ts"` → `from "../types.js"`
- `from "../config.ts"` → `from "../config.js"`
- All `./ui/*.ts` → `./ui/*.js`

> **Verify:** After the rename, run `grep -rn '\.ts"' packages/intercom/src/`
> and confirm zero hits (every import should end in `.js`).

### Step 6 — Register in workspace

Add `@my-agent/intercom` to the root `package.json` workspace list and to
`@my-agent/print`'s dependencies.

```jsonc
// package.json (root) — add to "workspaces"
{
  "workspaces": [
    "packages/intercom",   // ← add
    "packages/core",
    "packages/print",
    // ... existing entries
  ]
}
```

```jsonc
// packages/print/package.json — add to dependencies
{
  "dependencies": {
    "@my-agent/intercom": "*",  // ← add
    "@my-agent/core": "*",
    // ... existing
  }
}
```

### Step 7 — Verify PI_CODING_AGENT_DIR wiring

The broker path resolution (`getAgentDirPath()` in `broker/paths.ts`) already
checks `process.env.PI_CODING_AGENT_DIR`. No code change needed in intercom.

**However**, confirm that mya sets this env var when starting pi sessions.
In Phase 4's `buildAgentEnv()` (spec §5.3):

```typescript
env.PI_CODING_AGENT_DIR = join(homedir(), ".mya/agent");
```

This means the broker socket resolves to `~/.mya/agent/intercom/broker.sock`
on macOS/Linux, which is correct for mya's context.

### Step 8 — Create the smoke test

```typescript
// packages/print/src/intercom-extension.test.ts
import { describe, it, expect } from "vitest";

describe("[smoke] pi-intercom extension", () => {
  it("loads as an extension factory (default export is a function)", async () => {
    const mod = await import("@my-agent/intercom");
    expect(typeof mod.default).toBe("function");
  });

  it("factory does not throw when called with a mock ExtensionAPI", async () => {
    const { default: piIntercomFactory } = await import("@my-agent/intercom");
    const mockPi = {
      getSessionName: () => "test-session",
      sendMessage: () => {},
      appendEntry: () => {},
      on: () => {},
      events: { emit: () => {}, on: () => {} },
    };
    // The factory should not throw during synchronous registration.
    // It may schedule async work (broker connect) that we don't await here.
    expect(() => piIntercomFactory(mockPi as never)).not.toThrow();
  });

  it("IntercomClient is exported for inter-agent messaging", async () => {
    const { IntercomClient } = await import("@my-agent/intercom");
    expect(typeof IntercomClient).toBe("function");
    expect(IntercomClient.name).toBe("IntercomClient");
  });

  it("protocol types are exported", async () => {
    const mod = await import("@my-agent/intercom");
    // Type-only exports don't appear at runtime, but the module must
    // load without error when types are imported.
    expect(mod).toBeDefined();
  });
});
```

> **Test tier:** `[smoke]` — verifies the package loads and exports have the
> correct shape. Does NOT start a real broker or create a real pi session
> (that requires `MYA_BIN` and is covered by `[real]`/`[system]` tests).

## Code Skeletons

### Extension registration in PiInProcessRuntime (Phase 4 preview)

This is what Phase 4 will write. Included here to show **how** the package is consumed:

```typescript
// packages/print/src/runtimes/pi-in-process.ts (Phase 4 — NOT in this phase)

// IC3: pi-intercom as second extension
const piIntercomFactory = (await import("@my-agent/intercom")).default;

const resourceLoader = new DefaultResourceLoader({
  cwd: opts.cwd,
  agentDir: opts.agentDir,
  extensionFactories: [
    { name: "mya-bridge", factory: myaBridge },
    { name: "pi-intercom", factory: piIntercomFactory },  // ← second extension
  ],
});
await resourceLoader.reload();
```

### Broker self-management (IC3 — no env var needed)

```
┌─────────────────────────────────────────────────────┐
│  PiInProcessRuntime.start()                         │
│                                                     │
│  env.PI_CODING_AGENT_DIR = "~/.mya/agent"           │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │  pi-intercom extension loads                │    │
│  │  ┌───────────────────────────────────────┐  │    │
│  │  │  loadConfig()                         │  │    │
│  │  │  → reads $PI_CODING_AGENT_DIR/        │  │    │
│  │  │    intercom/config.json              │  │    │
│  │  └───────────────────────────────────────┘  │    │
│  │  ┌───────────────────────────────────────┐  │    │
│  │  │  spawnBrokerIfNeeded()                 │  │    │
│  │  │  → socket: $PI_CODING_AGENT_DIR/       │  │    │
│  │  │    intercom/broker.sock              │  │    │
│  │  │  → pid: $PI_CODING_AGENT_DIR/         │  │    │
│  │  │    intercom/broker.pid               │  │    │
│  │  └───────────────────────────────────────┘  │    │
│  │  ┌───────────────────────────────────────┐  │    │
│  │  │  IntercomClient.connect()              │  │    │
│  │  │  → auto-registers with broker          │  │    │
│  │  │  → intercom tool available to agent    │  │    │
│  │  └───────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  No MYA_BROKER_SOCKET needed. Broker is fully       │
│  self-managed by pi-intercom.                       │
└─────────────────────────────────────────────────────┘
```

## Test Plan

- **File:** `packages/print/src/intercom-extension.test.ts`
- **Tier:** `[smoke]`
- **Cases:**
  1. Default export is a function (extension factory)
  2. Factory does not throw with mock ExtensionAPI
  3. `IntercomClient` class is exported (for Phase 11)
  4. Module loads without error (all types resolve)

- **Existing intercom tests (moved):**
  - `packages/intercom/src/reply-tracker.test.ts` — `[unit]`
  - `packages/intercom/src/config.test.ts` — `[unit]`
  - `packages/intercom/src/cwd.test.ts` — `[unit]`
  - `packages/intercom/src/format-context.test.ts` — `[unit]`
  - `packages/intercom/src/broker/framing.test.ts` — `[unit]`
  - `packages/intercom/src/broker/paths.test.ts` — `[unit]`
  - `packages/intercom/src/broker/spawn.test.ts` — `[unit]`

  > These run via `npx vitest run packages/intercom/` and verify the package
  > move didn't break any existing logic.

## Acceptance Criteria

- [ ] `packages/intercom/package.json` exists with name `@my-agent/intercom`
- [ ] `packages/intercom/tsconfig.json` extends `../../tsconfig.base.json`
- [ ] All source files copied from `source/pi-intercom/` to `packages/intercom/src/`
- [ ] Internal imports changed from `.ts` to `.js` extensions
- [ ] `import("@my-agent/intercom")` resolves without error from `@my-agent/print`
- [ ] `@my-agent/intercom` default export is a function (extension factory)
- [ ] `IntercomClient` exported from `@my-agent/intercom`
- [ ] `intercom-extension.test.ts` passes: `npx vitest run packages/print/src/intercom-extension.test.ts`
- [ ] Moved intercom unit tests pass: `npx vitest run packages/intercom/`
- [ ] `source/pi-intercom/` still intact (not deleted — copy, not migration)
- [ ] No `MYA_BROKER_SOCKET` env var introduced anywhere (IC3)
- [ ] `npx tsc --noEmit` in `packages/intercom/` passes

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `.ts`→`.js` import rename misses an edge case (dynamic import, string path) | Run `grep -rn '\.ts"' packages/intercom/src/` after rename; zero hits required |
| pi-intercom uses `typebox` and `@earendil-works/pi-tui` — peer deps not in workspace | Add to `peerDependencies` (already done). These resolve from the root `node_modules` at runtime via pi packages |
| Broker spawn fails in test environment (no tsx/permission) | Smoke test does NOT start broker. It only verifies the module loads and exports have correct shape |
| Duplicate intercom packages (source/ + packages/) cause confusion | Document clearly: `source/pi-intercom/` is the standalone npm package; `packages/intercom/` is the mya workspace package. Different consumers |
| `composite: true` requires `rootDir`/`outDir` — mismatch with `.ts` source imports | `tsconfig.base.json` already handles this pattern (same as other packages) |
| Extension factory expects specific pi API methods not available in test | Mock API in smoke test only includes `getSessionName`, `sendMessage`, `appendEntry`, `on`, `events` — enough for synchronous registration |

## Rollback

1. Delete `packages/intercom/` directory entirely
2. Remove `@my-agent/intercom` from root `package.json` workspaces
3. Remove `@my-agent/intercom` from `packages/print/package.json` dependencies
4. Delete `packages/print/src/intercom-extension.test.ts`
5. Run `npm install` to update workspace links

No changes to `source/pi-intercom/` were made (it was a copy), so no rollback
needed there. No runtime code in `packages/print/src/` depends on the package yet
(Phase 4 will add the import — not this phase).
