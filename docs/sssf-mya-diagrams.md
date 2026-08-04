# Diagrams: "Agent Proposes, Code Disposes" cho mya

---

## 1. Nguyên tắc: Principle Mapping

```
          SSSF (CI Pipeline Tool)                     mya (Personal Assistant)
          ════════════════════════                    ═══════════════════════

  ┌─────────────────────────────┐              ┌─────────────────────────────┐
  │     ADW Script (Python)      │              │     CronJob + Shell         │
  │     "Code owns sequencing"   │    ══════►   │     "Code owns scheduling"   │
  │                              │              │     (ĐÃ CÓ — jobType:shell)  │
  │  plan → build → test →       │              │                              │
  │  review → document           │              │  cron expr → fire → deliver  │
  └─────────────────────────────┘              └─────────────────────────────┘

  ┌─────────────────────────────┐              ┌─────────────────────────────┐
  │     Typed Envelope           │              │     delegate_task            │
  │     "Agent output = JSON"    │    ══════►   │     + outputFormat           │
  │     (Pydantic model)         │              │     (JSON extraction)        │
  │                              │              │                              │
  │  status: success             │              │  goal + "return JSON with    │
  │  artifacts: [paths]          │              │   fields: X, Y, Z"           │
  │  changed_files: [...]        │              │  → extractJson(output)       │
  └─────────────────────────────┘              └─────────────────────────────┘

  ┌─────────────────────────────┐              ┌─────────────────────────────┐
  │     Gate Functions           │              │     verify callback          │
  │     "Verify claims"          │    ══════►   │     "Verify cron success"    │
  │     (code per gate)          │              │     (declarative JSON)       │
  │                              │              │                              │
  │  gate(env, run) → violations │              │  { type: "contains",         │
  │  → re-prompt same session    │              │    value: "\"ok\":true" }    │
  └─────────────────────────────┘              └─────────────────────────────┘

  ┌─────────────────────────────┐              ┌─────────────────────────────┐
  │     Write Permission         │              │     writeScope               │
  │     "git snapshot + rollback"│    ══════►   │     "tool-level deny"        │
  │     (after-the-fact)         │              │     (before-the-fact)        │
  │                              │              │                              │
  │  snapshot BEFORE → agent →   │              │  writeScope: [] → tool DENY  │
  │  snapshot AFTER → diff →     │              │  writeScope: ["src/"] →      │
  │  rollback breaches           │              │    path check before write   │
  └─────────────────────────────┘              └─────────────────────────────┘

  ┌─────────────────────────────┐              ┌─────────────────────────────┐
  │     Quality-as-Code          │              │     verify_work TOOL         │
  │     "Test = subprocess"      │    ══════►   │     "Agent calls tool to     │
  │     (kind="code" phase)      │              │      run quality checks"     │
  │                              │              │                              │
  │  Phase(kind="code") runs     │              │  verify_work(checks:         │
  │  bun test — no agent needed  │              │    ["test","typecheck"])     │
  │                              │              │  → structured pass/fail      │
  └─────────────────────────────┘              └─────────────────────────────┘
```

---

## 2. Tổng quan: 4 Enhancements trong mya Architecture

```
                              ┌─────────────────────────────────────┐
                              │              USER                     │
                              └────────────────┬────────────────────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────┐
                    │                          │                          │
                    ▼                          ▼                          ▼
          ┌─────────────────┐        ┌──────────────────┐      ┌──────────────────┐
          │  MODE 1         │        │  MODE 2          │      │  MODE 3          │
          │  Interactive    │        │  Role-Subagent   │      │  Cron            │
          │  Agent          │        │  Delegation      │      │  Jobs            │
          │                 │        │                  │      │                  │
          │  User ↔ Agent   │        │  Parent → Child  │      │  Schedule → Fire │
          │  (conversation) │        │  (delegate)      │      │  (automated)     │
          └───────┬─────────┘        └────────┬─────────┘      └────────┬─────────┘
                  │                           │                         │
                  │                           │                         │
         ┌────────┴───────┐          ┌────────┴────────┐       ┌───────┴────────┐
         │                │          │                  │       │                │
         ▼                │          ▼                  │       ▼                │
  ┌──────────────┐        │  ┌───────────────┐         │  ┌──────────────┐      │
  │  P0          │        │  │  P1           │         │  │  P2          │      │
  │  verify_work │        │  │  writeScope   │         │  │  verify     │      │
  │  TOOL        │        │  │  +outputFmt   │         │  │  callback   │      │
  │  (NEW)       │        │  │  (ENHANCE)    │         │  │  (ENHANCE)  │      │
  └──────┬───────┘        │  └───────┬───────┘         │  └──────┬───────┘      │
         │                │          │                  │         │              │
         │   P3           │          │   P3             │         │              │
         │   delegate_task│          │   outputFormat   │         │              │
         │   outputFormat │          │                  │         │              │
         │   (ENHANCE)    │          │                  │         │              │
         │                │          │                  │         │              │
         ▼                ▼          ▼                  ▼         ▼              ▼
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │                           mya EXISTING COMPONENTS                             │
  │                                                                                │
  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
  │  │ pi Agent │  │ RoleConfig│  │ delegate  │  │ CronJob  │  │ RunRecord      │  │
  │  │ Session  │  │ (roles/)  │  │ _task    │  │ (cron.db)│  │ (succeeded/    │  │
  │  │ + Tools  │  │           │  │ tool     │  │          │  │  failed)       │  │
  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └────────────────┘  │
  │                                                                                │
  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
  │  │ SmartRtr │  | Brain +  │  │ CostTrkr │  │ WS Push  │  | jobType:"shell"│  │
  │  │ (3 RT)   │  │ DreamCyc │  │          │  │ (real-   │  │ (ĐÃ CÓ!)       │  │
  │  │          │  │          │  │          │  │  time)   │  │                │  │
  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └────────────────┘  │
  └──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. P0 — `verify_work` Tool (Interactive Agent)

### BEFORE (hiện tại)

```
  Agent sửa code
       │
       ▼
  ┌──────────────────┐
  │ Agent claims:    │     ┌───────────────────────────────────┐
  │ "Done! I added   │     │ USER                              │
  │  the /health     │     │                                   │
  │  endpoint"       │────►│ User phải TỰ chạy:               │
  └──────────────────┘     │   $ npx vitest run               │
                           │   $ npx tsc --noEmit             │
                           │   $ npm run bundle               │
                           │                                   │
                           │ Nếu fail → user báo lại agent    │
                           │ → agent fix → user test lại      │
                           │ → LOOP (waste of user time)      │
                           └───────────────────────────────────┘

  HOẶC: Agent tự chạy qua bash:

  ┌──────────────────┐
  │ Agent calls:     │     ┌───────────────────────────────────┐
  │ bash(            │     │ PROBLEM:                          │
  │   "npx vitest    │────►│ • Tốn tokens để "type" command   │
  │    run"          │     │ • Output là raw text (dễ miss    │
  │ )                │     │   lỗi giữa hàng trăm dòng)       │
  └──────────────────┘     │ • Không structured               │
                           │ • Agent phải parse stdout        │
                           └───────────────────────────────────┘
```

### AFTER (với verify_work)

```
  Agent sửa code
       │
       ▼
  ┌──────────────────────────────────────────────────────────────┐
  │                      verify_work TOOL                        │
  │                                                              │
  │  Agent calls: verify_work({ checks: ["test","typecheck"] }) │
  │                                                              │
  │  ┌─────────────────────────────────────────────────────────┐ │
  │  │  resolveQualitySpecs(cwd)                                │ │
  │  │                                                          │ │
  │  │  1. Read ~/.mya/agent/quality.json (if exists)           │ │
  │  │     { "test": ["npx","vitest","run","--testTimeout=5000"],│ │
  │  │       "typecheck": ["npx","tsc","--noEmit"],             │ │
  │  │       "lint": ["npx","eslint","packages/"],              │ │
  │  │       "bundle": ["npm","run","bundle"] }                 │ │
  │  │                                                          │ │
  │  │  2. Fallback: parse package.json scripts                 │ │
  │  │                                                          │ │
  │  │  3. Run selected checks (child_process.execFile)         │ │
  │  └─────────────────────────────────────────────────────────┘ │
  │                      │                                       │
  │                      ▼                                       │
  │  ┌─────────────────────────────────────────────────────────┐ │
  │  │  STRUCTURED RESULT (not raw stdout)                      │ │
  │  │                                                          │ │
  │  │  ✅ test:       exit 0  (302 pass, 0 fail)              │ │
  │  │  ❌ typecheck:  exit 1  (2 errors in gateway/)          │ │
  │  │     src/index.ts(42): error TS2345                      │ │
  │  │     src/index.ts(87): error TS2304                      │ │
  │  └─────────────────────────────────────────────────────────┘ │
  │                      │                                       │
  └──────────────────────┼───────────────────────────────────────┘
                         │
                         ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  Agent thấy: "typecheck failed with 2 errors"                │
  │  → Agent tự fix lỗi                                           │
  │  → Agent gọi verify_work lần nữa                              │
  │  → All passed → Agent mới claim "done"                       │
  │                                                               │
  │  USER KHÔNG CẦN LÀM GÌ — agent tự verify trước khi report    │
  └──────────────────────────────────────────────────────────────┘
```

### Flow chi tiết

```
┌─────────┐     ┌────────────┐     ┌─────────────┐     ┌──────────────┐
│  Agent  │────►│verify_work │────►│resolveSpecs │────►│ quality.json │
│ "fix    │     │ tool       │     │             │     │ or pkg.json  │
│  bug"   │     │            │     │             │     │ scripts      │
└─────────┘     └─────┬──────┘     └─────────────┘     └──────────────┘
                      │
                     │  specs = [
                     │    {name:"test", argv:["npx","vitest","run"]},
                     │    {name:"typecheck", argv:["npx","tsc","--noEmit"]},
                     │  ]
                      ▼
                ┌─────────────────────────────────────────┐
                │         runChecks(specs, cwd)            │
                │                                         │
                │  ┌─────────────────────────────────┐    │
                │  │ execFile("npx", ["vitest","run"])│    │
                │  │   stdout: "302 passed"           │    │
                │  │   exit: 0                        │    │
                │  │   → passed: true                 │    │
                │  └─────────────────────────────────┘    │
                │                                         │
                │  ┌─────────────────────────────────┐    │
                │  │ execFile("npx", ["tsc","--noEmit"])  │
                │  │   stdout: "error TS2345..."      │    │
                │  │   exit: 1                        │    │
                │  │   → passed: false                │    │
                │  │   → outputTail: "error TS2345.." │    │
                │  └─────────────────────────────────┘    │
                └──────────────────┬──────────────────────┘
                                   │
                                   ▼
                ┌─────────────────────────────────────────┐
                │  Result → Agent                          │
                │                                         │
                │  ❌ typecheck failed:                    │
                │     error TS2345 at src/index.ts:42     │
                │                                         │
                │  Agent reads error → fixes code →        │
                │  calls verify_work again → all pass      │
                └─────────────────────────────────────────┘
```

---

## 4. P1 — `writeScope` (Role-Subagent Write Boundary)

### BEFORE (hiện tại)

```
  ┌─────────────────────────────────────────────────────────────┐
  │  reviewer.json                                              │
  │                                                             │
  │  {                                                          │
  │    "promptAppend": "Do NOT edit files — review only",  ◄── PROMPT
  │    "toolsAllowed": ["read", "grep", "find", "ls", "bash"], │
  │  }                                                          │
  │                                                             │
  │  PROBLEM: "Do NOT edit" là LỜI KHUYÊN, không phải BOUNDARY  │
  └─────────────────────────────────────────────────────────────┘
                              │
                              ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  Reviewer agent                                             │
  │                                                             │
  │  bash("git checkout -- src/index.ts")  ◄── VẪN CHẠY ĐƯỢC!  │
  │  bash("echo '' > src/config.ts")       ◄── VẪN CHẠY ĐƯỢC!  │
  │  bash("sed -i 's/foo/bar/g' src/*.ts") ◄── VẪN CHẠY ĐƯỢC!  │
  │  write("src/index.ts", "...")          ◄── VẪN CHẠY ĐƯỢC!  │
  │                                                             │
  │  toolsAllowed có "bash" → bash runs ANYTHING                │
  │  → reviewer có thể MODIFY code đang review                  │
  │  → "read-only" là lời nói dối                               │
  └─────────────────────────────────────────────────────────────┘
```

### AFTER (với writeScope)

```
  ┌─────────────────────────────────────────────────────────────┐
  │  reviewer.json (UPDATED)                                    │
  │                                                             │
  │  {                                                          │
  │    "promptAppend": "You are a code reviewer.",              │
  │    "toolsAllowed": ["read", "grep", "find", "ls", "bash"], │
  │    "writeScope": [],           ◄── ENFORCED BOUNDARY       │
  │  }                                                          │
  └─────────────────────────────────────────────────────────────┘
                              │
                              ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  Tool Registration (mya-bridge.ts)                          │
  │                                                             │
  │  if (role.writeScope !== undefined) {                       │
  │    ┌──────────────────────────────────────────────────┐     │
  │    │ registerScopedWriteTool(writeScope)               │     │
  │    │                                                    │     │
  │    │  writeScope: []                                    │     │
  │    │    → write tool ALWAYS returns DENIED              │     │
  │    │                                                    │     │
  │    │  writeScope: ["packages/core/"]                    │     │
  │    │    → write tool checks path BEFORE writing         │     │
  │    │    → DENIED if outside scope                       │     │
  │    └──────────────────────────────────────────────────┘     │
  │    ┌──────────────────────────────────────────────────┐     │
  │    │ registerScopedBashTool(writeScope)                │     │
  │    │                                                    │     │
  │    │  writeScope: []                                    │     │
  │    │    → bash checks command with regex                │     │
  │    │    → BLOCKS: > >> tee sed -i git checkout/reset    │     │
  │    │              rm mv cp mkdir touch                  │     │
  │    │    → ALLOWS: ls cat grep find git log git diff     │     │
  │    │                                                    │     │
  │    │  writeScope: ["packages/core/"]                    │     │
  │    │    → unrestricted bash (role can write in scope)   │     │
  │    └──────────────────────────────────────────────────┘     │
  │  } else {                                                   │
  │    // writeScope: undefined → register NORMAL tools         │
  │    // (backward-compat — current behavior)                  │
  │  }                                                          │
  └─────────────────────────────────────────────────────────────┘
```

### writeScope Enforcement Flow

```
                     Role loaded
                          │
                          ▼
              ┌───────────────────────┐
              │  role.writeScope?     │
              └───────┬───────┬───────┘
                      │       │
            undefined │       │ defined
                      │       │
                      ▼       ▼
          ┌────────────┐  ┌───────────────────────┐
          │ Register   │  │ Register SCOPED tools │
          │ NORMAL     │  │                       │
          │ tools      │  │  write tool:          │
          │ (current   │  │  ┌─────────────────┐  │
          │  behavior) │  │  │ write(path)     │  │
          └────────────┘  │  │   │             │  │
                          │  │   ▼             │  │
                          │  │ scope=[] ?      │  │
                          │  │ ├─YES→ DENY     │  │
                          │  │ └─NO→ check path│  │
                          │  │      ├─in→OK    │  │
                          │  │      └─out→DENY │  │
                          │  └─────────────────┘  │
                          │                       │
                          │  bash tool:           │
                          │  ┌─────────────────┐  │
                          │  │ bash(command)   │  │
                          │  │   │             │  │
                          │  │   ▼             │  │
                          │  │ scope=[] ?      │  │
                          │  │ ├─YES→ regex    │  │
                          │  │ │   check cmd   │  │
                          │  │ │   ├─mod→DENY  │  │
                          │  │ │   └─ok→RUN    │  │
                          │  │ └─NO→ RUN       │  │
                          │  └─────────────────┘  │
                          └───────────────────────┘
```

### So sánh: SSSF vs mya writeScope

```
  SSSF (git snapshot + rollback)         mya (tool-level deny)
  ══════════════════════════════         ════════════════════

  ┌──────────────┐                       ┌──────────────┐
  │ SNAPSHOT     │                       │ TOOL CALL    │
  │ git diff HEAD│                       │ write(path)  │
  │ + ls-files   │                       └──────┬───────┘
  └──────┬───────┘                              │
         │                             ┌────────▼────────┐
         ▼                             │ CHECK writeScope│
  ┌──────────────┐                     │ path in scope?  │
  │ AGENT RUNS   │                     └────┬───────┬────┘
  │ (can write   │                          │       │
  │  anything)   │                     YES  │    NO │
  └──────┬───────┘                          │       │
         │                                  ▼       ▼
         ▼                           ┌──────┐  ┌─────────┐
  ┌──────────────┐                   │ WRITE│  │  DENY   │
  │ SNAPSHOT     │                   │ FILE │  │ (before │
  │ again        │                   └──────┘  │  write) │
  └──────┬───────┘                             └─────────┘
         │                                     ✓ Simple
         ▼                                     ✓ Fail-fast
  ┌──────────────┐                             ✓ No rollback
  │ DIFF         │                             ✓ No risk to
  │ before/after │                               user's work
  └──────┬───────┘                             ✗ bash heuristic
         │                                       (not perfect)
         ▼
  ┌──────────────┐
  │ BREACHES?    │
  │ → ROLLBACK   │
  │ git checkout │
  │ + delete     │
  │   untracked  │
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐
  │ RAISE        │
  │ PermissionB. │
  └──────────────┘
  ✗ Complex
  ✗ After-the-fact
  ✗ Rollback risk
  ✓ Perfect (catches all)
```

---

## 5. P2 — Cron `verify` Callback

### BEFORE (hiện tại)

```
  CronJob fires
       │
       ▼
  ┌──────────────────────────────┐
  │  Execute job                 │
  │                              │
  │  jobType: "shell"            │
  │  → run command               │
  │  → capture stdout + exit     │
  │                              │
  │  jobType: "agent"            │
  │  → run agent turn            │
  │  → capture output + exit     │
  └──────────────┬───────────────┘
                 │
                 ▼
  ┌──────────────────────────────┐
  │  RunRecord                   │
  │  status: succeeded/failed    │
  │                              │
  │  succeeded = exit 0          │  ◄── CHỈ BIẾT EXIT CODE
  │  failed = exit ≠ 0           │      KHÔNG BIẾT "thành công" thật
  └──────────────────────────────┘

  PROBLEM: curl health endpoint → exit 0 → "succeeded"
           NHƯNG response có thể là {"error":"db disconnected"}
           → Job marked "succeeded" nhưng THỰC SỰ FAILED
```

### AFTER (với verify callback)

```
  CronJob fires
       │
       ▼
  ┌──────────────────────────────────────────────────┐
  │  Execute job                                     │
  │                                                  │
  │  jobType: "shell"                                │
  │  command: "curl -s http://127.0.0.1:3000/health" │
  │  → stdout: '{"ok":true,"db":"connected"}'       │
  │  → exit: 0                                       │
  └──────────────────────┬───────────────────────────┘
                         │
                         ▼
  ┌──────────────────────────────────────────────────┐
  │  VERIFY (NEW)                                    │
  │                                                  │
  │  job.verify = {                                  │
  │    type: "contains",                             │
  │    value: "\"ok\":true"                          │
  │  }                                               │
  │                                                  │
  │  ┌────────────────────────────────────────────┐  │
  │  │ verifyJobOutput(job, stdout, exitCode)     │  │
  │  │                                            │  │
  │  │  type: "contains"?                         │  │
  │  │  → stdout.includes('"ok":true') → true    │  │
  │  │                                            │  │
  │  │  type: "regex"?                            │  │
  │  │  → new RegExp(value).test(stdout)          │  │
  │  │                                            │  │
  │  │  type: "exit_zero"?                        │  │
  │  │  → exitCode === 0                          │  │
  │  │                                            │  │
  │  │  type: "json_path"?                        │  │
  │  │  → extract JSON, check path                │  │
  │  └────────────────────────────────────────────┘  │
  │                                                  │
  │  verify exists? ──NO──► exitCode === 0           │
  │                  │                               │
  │                 YES                               │
  │                  ▼                               │
  │            verify.type check                     │
  │                  │                               │
  │                  ▼                               │
  │            ok = match?                           │
  │            negate? → flip                        │
  └──────────────────────┬───────────────────────────┘
                         │
                         ▼
  ┌──────────────────────────────────────────────────┐
  │  RunRecord                                       │
  │                                                  │
  │  exit 0 + verify ok    → status: "succeeded"     │
  │  exit 0 + verify FAIL  → status: "failed"        │
  │                        + error: "verify: ..."    │
  │  exit ≠ 0              → status: "failed"        │
  └──────────────────────────────────────────────────┘
```

### Verify Types

```
  ┌─────────────────────────────────────────────────────────────┐
  │                    verify config types                      │
  ├─────────────────────────────────────────────────────────────┤
  │                                                             │
  │  ┌─────────────────┐  ┌─────────────────┐                  │
  │  │ "contains"      │  │ "regex"          │                  │
  │  │                 │  │                  │                  │
  │  │ stdout phải     │  │ stdout phải      │                  │
  │  │ contain string  │  │ match regex      │                  │
  │  │                 │  │                  │                  │
  │  │ value: "ok"     │  │ value: "^✅.*"   │                  │
  │  └─────────────────┘  └─────────────────┘                  │
  │                                                             │
  │  ┌─────────────────┐  ┌─────────────────┐                  │
  │  │ "exit_zero"     │  │ "json_path"     │                  │
  │  │                 │  │                  │                  │
  │  │ exit code = 0   │  │ stdout là JSON,  │                  │
  │  │ (redundant with │  │ extract path,    │                  │
  │  │  default, but   │  │ check value      │                  │
  │  │  explicit)      │  │                  │                  │
  │  │                 │  │ value: "$.ok"    │                  │
  │  └─────────────────┘  └─────────────────┘                  │
  │                                                             │
  │  ALL types support:                                         │
  │    negate: true → flip result (succeed if NOT matched)      │
  │                                                             │
  └─────────────────────────────────────────────────────────────┘
```

---

## 6. P3 — `delegate_task` outputFormat

### BEFORE vs AFTER

```
  BEFORE (hiện tại)                    AFTER (với outputFormat)
  ══════════════════                   ════════════════════════

  ┌────────────────┐                   ┌────────────────────────┐
  │ delegate_task( │                   │ delegate_task(         │
  │   goal: "scan  │                   │   goal: "scan security │
  │   security     │                   │     of auth module",   │
  │   of auth",    │                   │   output_format: {     │
  │   role:        │                   │     fields: [          │
  │     "reviewer" │                   │       { name:"summary",│
  │ )              │                   │         type:"string"},│
  └───────┬────────┘                   │       { name:"findings",│
          │                            │         type:"array"},  │
          ▼                            │       { name:"severity",│
  ┌────────────────┐                   │         type:"string"}, │
  │ Subagent runs  │                   │     ],                  │
  │ → returns TEXT │                   │     example: {          │
  │                │                   │       summary:"...",    │
  │ "I found some  │                   │       findings:[...],   │
  │  issues. The   │                   │       severity:"high"   │
  │  auth module   │                   │     }                   │
  │  has SQL       │                   │   }                     │
  │  injection..." │                   │ )                       │
  └───────┬────────┘                   └───────────┬────────────┘
          │                                        │
          ▼                                        ▼
  ┌────────────────┐                   ┌────────────────────────┐
  │ Parent agent   │                   │ Subagent prompt gets:  │
  │ receives RAW   │                   │                        │
  │ TEXT           │                   │ "...Return ONLY valid  │
  │                │                   │  JSON with fields:     │
  │ Parent must    │                   │  - summary: string     │
  │ PARSE text     │                   │  - findings: array     │
  │ manually       │                   │  - severity: string    │
  │ → error-prone  │                   │  Example: {...}"       │
  │ → inconsistent │                   └───────────┬────────────┘
  └────────────────┘                               │
                                                   ▼
                                       ┌────────────────────────┐
                                       │ Subagent returns TEXT  │
                                       │ (contains JSON)        │
                                       │                        │
                                       │ {"summary":"3 issues", │
                                       │  "findings":[...],     │
                                       │  "severity":"high"}    │
                                       └───────────┬────────────┘
                                                   │
                                                   ▼
                                       ┌────────────────────────┐
                                       │ extractJson(output)    │
                                       │                        │
                                       │ Handle:                │
                                       │ • bare JSON            │
                                       │ • ```json blocks       │
                                       │ • prose-wrapped JSON   │
                                       │                        │
                                       │ Parse fail?            │
                                       │ → return raw text      │
                                       │   + warning            │
                                       │ (graceful degradation) │
                                       └───────────┬────────────┘
                                                   │
                                                   ▼
                                       ┌────────────────────────┐
                                       │ Parent agent receives  │
                                       │ PARSED JSON            │
                                       │                        │
                                       │ {                      │
                                       │   "summary":"3 issues",│
                                       │   "findings":[...],    │
                                       │   "severity":"high"    │
                                       │ }                      │
                                       │                        │
                                       │ Structured! Type-safe! │
                                       └────────────────────────┘
```

---

## 7. Toàn cảnh: mya với 4 Enhancements

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                                    USER                                          │
│                              (browser / CLI / TUI)                               │
└────────┬─────────────────────────────┬──────────────────────────┬────────────────┘
         │                             │                          │
         ▼                             ▼                          ▼
┌─────────────────┐          ┌──────────────────┐       ┌──────────────────┐
│  INTERACTIVE    │          │  ROLE-SUBAGENT    │       │  CRON            │
│  MODE           │          │  MODE             │       │  SCHEDULER       │
│                 │          │                   │       │                  │
│  User ↔ Agent   │          │  Parent delegates │       │  Schedule fires  │
│  (conversation) │          │  to child agent   │       │  jobs            │
└────────┬────────┘          └────────┬──────────┘       └────────┬─────────┘
         │                            │                          │
         │  ┌──────────────────┐      │   ┌─────────────────┐    │  ┌──────────────┐
         │  │  ★ P0 verify_work│      │   │ ★ P1 writeScope │    │  │ ★ P2 verify  │
         │  │                  │      │   │                 │    │  │   callback   │
         │  │  Agent calls     │      │   │ Tool-level      │    │  │              │
         │  │  tool → code     │      │   │ write boundary  │    │  │ Declarative  │
         │  │  runs quality    │      │   │ (deny BEFORE)   │    │  │ success      │
         │  │  checks          │      │   │                 │    │  │ criteria     │
         │  │                  │      │   │ writeScope: []  │    │  │              │
         │  │  Returns:        │      │   │ → read-only     │    │  │ verify: {    │
         │  │  ✅ test          │      │   │ writeScope:     │    │  │   type:      │
         │  │  ❌ typecheck     │      │   │   ["src/"]      │    │  │    "contains"│
         │  │  (structured)    │      │   │ → scoped write  │    │  │   value:     │
         │  └────────┬─────────┘      │   └────────┬────────┘    │  │    "ok"      │
         │           │                │            │              │  │ }            │
         │           │           ┌────┴────────────┴──┐          │  └──────┬───────┘
         │           │           │  ★ P3 outputFormat │          │         │
         │           │           │                    │          │         │
         │           │           │  delegate_task +   │          │         │
         │           │           │  outputFormat →    │          │         │
         │           │           │  child returns     │          │         │
         │           │           │  STRUCTURED JSON   │          │         │
         │           │           │  (not raw text)    │          │         │
         │           │           └────────────────────┘          │         │
         │           │                                           │         │
         ▼           ▼                                           ▼         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                           mya CORE INFRASTRUCTURE                                │
│                                                                                  │
│  ┌────────────┐ ┌───────────┐ ┌──────────┐ ┌─────────┐ ┌───────┐ ┌────────────┐ │
│  │ PiInProcess│ │ RoleRegist│ │ RuntimePool│ │SmartRtr│ │ Brain │ │ CostTracker│ │
│  │ Runtime    │ │ ry        │ │           │ │        │ │+Dream │ │            │ │
│  │            │ │           │ │           │ │ 3 RTs  │ │ Cycle │ │            │ │
│  │ Tools:     │ │ Roles:    │ │ Sessions  │ │ pi     │ │       │ │            │ │
│  │ read       │ │ coder     │ │ acquire/  │ │ claude │ │ SQLite│ │ tokens     │ │
│  │ write      │ │ reviewer  │ │ prompt/   │ │ native │ │ WAL   │ │ cost       │ │
│  │ edit       │ │ research  │ │ release   │ │        │ │       │ │            │ │
│  │ bash       │ │ default   │ │           │ │        │ │       │ │            │ │
│  │ ★verify_  │ │           │ │           │ │        │ │       │ │            │ │
│  │  work      │ │ ★write   │ │           │ │        │ │       │ │            │ │
│  │ ★scoped   │ │  Scope   │ │           │ │        │ │       │ │            │ │
│  │  write/bash│ │  field   │ │           │ │        │ │       │ │            │ │
│  └────────────┘ └───────────┘ └──────────┘ └────────┘ └───────┘ └────────────┘ │
│                                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │                              OBSERVABILITY                                 │  │
│  │                                                                            │  │
│  │  WS Push (real-time)  │  CronJob + RunRecord  │  Dashboard (38 pages)    │  │
│  │  (pi-web-shape)       │  ★ verify callback    │                          │  │
│  │                       │    on status           │                          │  │
│  └────────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────┘

  ★ = NEW / ENHANCED component (4 total)
    Everything else = EXISTING mya infrastructure (unchanged)
```

---

## 8. Implementation Timeline

```
  Week 1
  ══════
  ┌──────────────────────────────────────────────────────────────┐
  │ P0: verify_work tool                              1-2 days  │
  │                                                              │
  │  Day 1:                                                      │
  │  ├── verify-work.ts (runChecks + resolveQualitySpecs)       │
  │  ├── verify-work.test.ts                                    │
  │  └── mya-bridge.ts (register tool)                          │
  │                                                              │
  │  Day 2:                                                      │
  │  ├── quality.json spec loading + package.json fallback      │
  │  ├── Review round 1 → fix → Review round 2 → clean          │
  │  └── Commit + push                                          │
  └──────────────────────────────────────────────────────────────┘
                              │
                              ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ P1: writeScope                                    2-3 days  │
  │                                                              │
  │  Day 3:                                                      │
  │  ├── roles.ts (add writeScope?: string[])                   │
  │  └── scoped-tools.ts (scoped write + bash guards)           │
  │                                                              │
  │  Day 4:                                                      │
  │  ├── scoped-tools.test.ts                                   │
  │  ├── mya-bridge.ts (conditional tool registration)          │
  │  └── reviewer.json update (writeScope: [])                  │
  │                                                              │
  │  Day 5:                                                      │
  │  ├── bash regex edge cases (test evasion attempts)          │
  │  ├── Review round 1 → fix → Review round 2 → clean          │
  │  └── Commit + push                                          │
  └──────────────────────────────────────────────────────────────┘

  Week 2
  ══════
  ┌──────────────────────────────────────────────────────────────┐
  │ P2: Cron verify callback                          1 day     │
  │                                                              │
  │  Day 6:                                                      │
  │  ├── cron/index.ts (add verify?: JobVerify to CronJob)      │
  │  ├── cron/verify.ts (verifyJobOutput function)              │
  │  ├── cron/verify.test.ts                                    │
  │  ├── cron/scan.ts (call verify on job completion)           │
  │  └── Review → commit                                        │
  └──────────────────────────────────────────────────────────────┘
                              │
                              ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ P3: delegate_task outputFormat                    1 day     │
  │                                                              │
  │  Day 7:                                                      │
  │  ├── extract-json.ts (bare JSON + code block extraction)    │
  │  ├── extract-json.test.ts                                   │
  │  ├── mya-bridge.ts (add outputFormat param + JSON parse)    │
  │  └── Review → commit                                        │
  └──────────────────────────────────────────────────────────────┘

  Total: 7 working days
  New files:     6  (+ 6 test files)
  Edited files: 5
  Risk: LOW (all backward-compat, no architecture changes)
```
