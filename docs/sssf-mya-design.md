# Thiết kế: "Agent Proposes, Code Disposes" cho mya

> Adapt SSSF's **principles** (không phải implementation) vào mya's **existing components**.
> Mỗi adaptation là một enhancement nhỏ, không phải subsystem mới.

---

## Nguyên tắc adaptation

```
SSSF says:   "Port my ADW scripts, envelopes, gates, trace tables"
             ↓ NHẤT QUÁN SAI
mya says:    "Take the PRINCIPLE, apply to MY components"

SSSF principle              →  mya component
─────────────────              ─────────────
"Known commands = code"     →  verify_work TOOL (interactive agent)
"Typed output"              →  delegate_task + outputFormat (role-subagent)  
"Write boundary"            →  writeScope trên RoleConfig (tool-level)
"Pipeline verification"     →  verify callback trên CronJob (cron.db)
"Code owns sequencing"      →  jobType:"shell" (ĐÃ CÓ — chỉ cần dùng)
```

---

## 3 Chế độ của mya → 3 Adaptation

### Mode 1: Interactive Agent → `verify_work` tool

**Vấn đề thực**: Agent sửa code, nói "xong rồi". User phải tự chạy test/typecheck để verify. Hoặc agent chạy `bash npx vitest run` và parse output (dễ sai, tốn tokens).

**SSSF principle**: "A known command is not a judgement call — it belongs in code."

**Adaptation**: Thêm `verify_work` tool — agent gọi tool, code chạy checks, trả structured result.

```typescript
// packages/print/src/mya-bridge.ts (enhancement)

pi.registerTool({
  name: "verify_work",
  label: "Verify Work",
  description:
    "Run the project's quality checks (test, typecheck, lint, bundle). " +
    "Returns structured pass/fail per check. ALWAYS call this after code " +
    "changes — do not claim 'done' without verifying.",
  parameters: {
    type: "object",
    properties: {
      checks: {
        type: "array",
        items: { type: "string", enum: ["test", "typecheck", "lint", "bundle"] },
        description: "Which checks to run. Omit = run all.",
      },
    },
  },
  async execute(_callId, params) {
    const specs = resolveQualitySpecs(process.cwd());
    // specs loaded from package.json scripts or ~/.mya/agent/quality.json:
    // { test: ["npx", "vitest", "run", "--testTimeout=5000"],
    //   typecheck: ["npx", "tsc", "--noEmit"],
    //   lint: ["npx", "eslint", "packages/"],
    //   bundle: ["npm", "run", "bundle"] }
    const selected = params.checks 
      ? specs.filter(s => params.checks!.includes(s.name))
      : specs;
    const results = await runChecks(selected, process.cwd());
    
    const lines = results.map(r => 
      `${r.passed ? "✅" : "❌"} ${r.name}: exit ${r.returncode}` +
      (r.passed ? "" : `\n${r.outputTail.slice(0, 2000)}`)
    );
    const allPassed = results.every(r => r.passed);
    
    return {
      content: [{
        type: "text",
        text: `${allPassed ? "All checks passed" : "Some checks failed"}:\n${lines.join("\n")}`,
      }],
      // Agent sees pass/fail per check — không cần parse stdout
    };
  },
});
```

**Tại sao FIT mya**:
- Là TOOL (mya là tool-based), không phải "phase" hay "subsystem"
- Agent gọi добровольно, giống `bash` — không ép architecture change
- Quality specs configurable (`~/.mya/agent/quality.json`) — không hardcode
- Structured output → agent biết chính xác check nào fail
- Đọc từ package.json scripts nếu không có config → zero-setup

**Implementation**:
```
packages/print/src/verify-work.ts     (NEW — runChecks + resolveQualitySpecs)
packages/print/src/verify-work.test.ts (NEW)
packages/print/src/mya-bridge.ts       (EDIT — register tool)
```

**Risk**: Thấp. Pure helper + tool registration.

---

### Mode 2: Role-Subagent → Structured delegation + writeScope

#### 2a. Structured delegation (`delegate_task` enhancement)

**Vấn đề thực**: `delegate_task` trả về raw text. Parent agent phải tự parse. Không có contract.

**Adaptation**: Thêm `outputFormat` parameter — child agent được prompt trả JSON.

```typescript
// packages/print/src/mya-bridge.ts (enhancement to existing delegate_task)

async execute(_callId, params) {
  const goal = params.output_format
    ? `${params.goal}\n\n--- OUTPUT CONTRACT ---\n` +
      `Return ONLY valid JSON with these fields:\n` +
      params.output_format.fields.map(f => `  - ${f.name}: ${f.type} — ${f.description}`).join("\n") +
      `\nExample: ${JSON.stringify(params.output_format.example, null, 2)}`
    : params.goal;

  const sub = await spawnSubagent(parentSessionId, {
    goal,
    cwd: params.cwd ?? process.cwd(),
    allowedTools: params.allowed_tools,
    parentDepth: params.parent_depth ?? 0,
  });
  trackSubagent(parentSessionId, sub);
  
  if (params.wait !== false) {
    let output = ((await sub.wait()) || "").replace(/<DONE>/g, "").trim();
    
    // Nếu có outputFormat, thử parse JSON
    if (params.output_format) {
      const parsed = extractJson(output);  // handle ```json blocks, bare JSON
      if (parsed) {
        output = JSON.stringify(parsed, null, 2);
      }
      // Parse fail → return raw text + warning (không crash)
    }
    
    return { content: [{ type: "text", text: `[Subagent ${sub.id}]\n${output}` }] };
  }
  // ... fire-and-forget path
}
```

```typescript
// New parameter on delegate_task:
output_format?: {
  fields: { name: string; type: "string" | "number" | "boolean" | "array" | "object"; description: string }[];
  example: Record<string, unknown>;
}
```

**Tại sao FIT mya**:
- Không đổi spawn interface — chỉ thêm prompt engineering
- `extractJson` = same logic as SSSF's `_extract_json` (handle code blocks + bare JSON)
- Parse fail → fallback to raw text (graceful degradation, không crash)
- Parent agent tự quyết định có dùng structured hay không

**Risk**: Thấp. Enhancement trên existing tool.

#### 2b. `writeScope` trên RoleConfig (tool-level enforcement)

**Vấn đề thực**: `reviewer.json` nói "Do NOT edit files" trong `promptAppend`, nhưng:
- `bash` vẫn chạy `git checkout`, `echo > file`, `sed -i`
- `write` tool vẫn reaches any path
- Prompt instruction KHÔNG phải boundary

SSSF dùng git tree snapshot + rollback — **quá phức tạp, risk cao, trái trust model**.

**Adaptation đơn giản hơn**: `writeScope` enforced ở TOOL level, BEFORE write.

```typescript
// packages/core/src/roles.ts (enhancement)
export interface RoleConfig {
  // ... existing fields ...
  /**
   * Paths this role may modify (relative to cwd). 
   * [] = read-only (no file modifications at all).
   * undefined = unrestricted (default, backward-compat).
   * ["packages/core/"] = only this directory.
   */
  writeScope?: string[];
}
```

```typescript
// packages/print/src/mya-bridge.ts — scoped tool registration

function registerScopedWriteTool(writeScope: string[] | undefined) {
  if (writeScope === undefined) {
    return; // unrestricted — register normal write tool
  }
  
  pi.registerTool({
    name: "write",
    // ... same params as normal write ...
    async execute(callId, params) {
      if (writeScope.length === 0) {
        return { content: [{ type: "text", text: 
          "[write] DENIED: this role is read-only (writeScope: [])" }] };
      }
      const resolved = resolve(process.cwd(), params.file_path);
      if (!isWithinScope(resolved, process.cwd(), writeScope)) {
        return { content: [{ type: "text", text: 
          `[write] DENIED: ${params.file_path} is outside writeScope (${writeScope.join(", ")})` }] };
      }
      // ... normal write logic ...
    },
  });
}

function registerScopedBashTool(writeScope: string[] | undefined) {
  if (writeScope === undefined) return;
  
  pi.registerTool({
    name: "bash",
    async execute(callId, params) {
      if (writeScope.length === 0) {
        // Read-only mode: block commands that modify files
        const blocked = /\b(>|>>|tee|sed\s+-i|git\s+(checkout|reset|clean)|rm\s|mv\s|cp\s|mkdir\s|touch\s)/;
        if (blocked.test(params.command)) {
          return { content: [{ type: "text", text:
            `[bash] DENIED: command may modify files (read-only role)` }] };
        }
      }
      // ... normal bash execution ...
    },
  });
}
```

```json
// ~/.mya/roles/reviewer.json (updated)
{
  "name": "reviewer",
  "description": "Code review agent (read-only)",
  "promptAppend": "You are a code reviewer. Report findings only.",
  "toolsAllowed": ["read", "grep", "find", "ls", "bash"],
  "writeScope": [],
  "memoryScope": "global"
}
```

**Tại sao FIT mya hơn SSSF**:
- SSSF: snapshot BEFORE → agent runs → diff AFTER → rollback (phức tạp, risky)
- mya: DENY at tool call (đơn giản, fail-fast, không cần rollback)
- Fits existing tool registration pattern (pi.registerTool)
- Backward-compat: `writeScope: undefined` = current behavior
- `bash` guard là heuristic (không perfect) nhưng tốt hơn "prompt says don't"

**Trade-off honestly**:
- `bash` guard dùng regex — không perfect (agent có thể evade: `python -c "open('x','w').write('y')"`)
- Nhưng: tốt hơn nhiều so với "không có gì" (hiện tại)
- Nếu cần perfect → dùng SSSF's git snapshot approach (Phase 2, risk cao hơn)

**Implementation**:
```
packages/core/src/roles.ts               (EDIT — add writeScope?: string[])
packages/print/src/scoped-tools.ts       (NEW — scoped write/bash wrappers)
packages/print/src/scoped-tools.test.ts  (NEW)
packages/print/src/mya-bridge.ts         (EDIT — use scoped tools when role.writeScope set)
~/.mya/roles/reviewer.json               (EDIT — add writeScope: [])
```

**Risk**: Trung bình. `bash` guard là heuristic, cần test kỹ các edge cases.

---

### Mode 3: Cron Jobs → verification callback

**Vấn đề thực**: Cron job chạy → trả log text. Không biết job có "thành công" không (chỉ biết exit code).

**SSSF principle**: "Every ADW ends in `run.finish(accepted=...)` — phases passing ≠ run accepted."

**Adaptation**: `verify` callback trên CronJob.

```typescript
// packages/cron/src/index.ts (enhancement)
export interface CronJob {
  // ... existing 30+ fields ...
  
  /**
   * Optional verification: determine if the job SUCCEEDED beyond exit code.
   * For agent jobs: receives the agent's output text.
   * For shell jobs: receives stdout.
   * Returns { ok: boolean; reason?: string }.
   */
  verify?: {
    /** "contains" = output must contain this string. */
    type: "contains" | "regex" | "json_path" | "exit_zero";
    /** Value for the check type (string/regex/json-path). */
    value?: string;
    /** Negate: job succeeds if the check does NOT match. */
    negate?: boolean;
  };
}
```

```typescript
// packages/cron/src/scan.ts — when a job completes:
function verifyJobOutput(job: CronJob, output: string, exitCode: number): boolean {
  if (!job.verify) return exitCode === 0;
  
  switch (job.verify.type) {
    case "exit_zero":
      return job.verify.negate ? exitCode !== 0 : exitCode === 0;
    case "contains": {
      const found = output.includes(job.verify.value ?? "");
      return job.verify.negate ? !found : found;
    }
    case "regex": {
      const re = new RegExp(job.verify.value ?? "");
      const found = re.test(output);
      return job.verify.negate ? !found : found;
    }
    // json_path: extract value from JSON output, compare
  }
}
```

```json
// Example: cron job that checks gateway health
{
  "id": "gw-health",
  "name": "Gateway Health Check",
  "trigger": "cron",
  "schedule": "*/5 * * * *",
  "jobType": "shell",
  "command": "curl -s http://127.0.0.1:3000/health/live",
  "deliveryTarget": "lane:ops",
  "prompt": "",
  "verify": {
    "type": "contains",
    "value": "\"ok\":true"
  }
}
```

**Tại sao FIT mya**:
- mya đã có `jobType: "shell"` (SSSF's "code phase" equivalent!) — chỉ cần thêm verify
- mya đã có `RunRecord` với status (succeeded/failed) — verify chỉ đổi status logic
- Declarative config (JSON) — không cần code per job
- Fits cron.db (không thêm table, chỉ thêm logic)

**Implementation**:
```
packages/cron/src/index.ts       (EDIT — add verify?: JobVerify to CronJob)
packages/cron/src/scan.ts        (EDIT — call verifyJobOutput)
packages/cron/src/verify.test.ts (NEW)
```

**Risk**: Thấp. Declarative check, pure function, không đổi architecture.

---

## So sánh: SSSF gốc vs mya adaptation

| SSSF (gốc) | mya Adaptation | Khác biệt |
|---|---|---|
| Python ADW script (orchestrator) | CronJob + jobType:"shell" (ĐÃ CÓ) | mya đã có deterministic orchestration |
| Phase model (engineer/agent/code) | Interactive/Role-subagent/Cron (3 modes) | mya's modes ARE the phases |
| Typed Envelope (Pydantic) | delegate_task outputFormat (JSON extraction) | Đơn giản hơn — prompt + parse, không schema lib |
| Gate functions (claim verification) | verify callback trên CronJob | Declarative (JSON config), không code per gate |
| Write permission (git snapshot + rollback) | writeScope (tool-level deny) | Đơn giản hơn — deny BEFORE, không rollback AFTER |
| Quality-as-code (subprocess phase) | verify_work tool | Là tool (voluntary), không phải phase (enforced) |
| SQLite trace (7 tables) | RunRecord + CostTracker (ĐÃ CÓ) | mya đã có structured trace |
| Session resume (agent_map.json) | --session-id (ĐÃ CÓ) | Identical concept |

---

## Đề xuất thực hiện

### Priority order (theo ROI)

```
P0 — verify_work tool (1-2 ngày)
  ├── Highest ROI: agent tự verify work thay vì claim "done"
  ├── Lowest risk: pure helper + tool registration
  └── Testable in isolation (mock subprocess)

P1 — writeScope (2-3 ngày)  
  ├── Security gap thật: reviewer role không read-only thật
  ├── Tool-level enforcement (đơn giản hơn git snapshot)
  └── bash guard heuristic (không perfect, nhưng >> nothing)

P2 — Cron verify callback (1 ngày)
  ├── Shell jobs đã có → chỉ thêm declarative verify
  ├── Low effort, medium value
  └── Declarative config, no code per job

P3 — delegate_task outputFormat (1 ngày)
  ├── Nice-to-have: structured delegation
  ├── Low priority (unstructured text works fine currently)
  └── Just prompt engineering + JSON extraction
```

### Total effort: ~5-7 ngày

So với original SSSF port plan (10-14 ngày) — ít hơn ~50%, và mỗi component FIT mya's architecture thay vì ép foreign paradigm.

### Mỗi P tuân thủ
- NO TEST = NO MERGE
- 2-round clean review gate
- Backward-compat (undefined = current behavior)
- Per-package typecheck

---

## Tóm tắt

**Không port SSSF. Adapt SSSF's principle.**

SSSF's core insight — **"agent proposes, code disposes"** — có giá trị. Nhưng implementation của SSSF (ADW scripts, envelope triad, gate functions, git snapshot) là cho **CI pipeline tool**, không phải **personal assistant**.

Adaptation này lấy **principle** và apply vào **mya's existing components**:
- `verify_work` tool → code runs quality checks (interactive agent)
- `writeScope` → code enforces write boundary (role-subagent)
- `verify` callback → code verifies cron success (cron)
- `outputFormat` → structured delegation (subagent)

Mỗi component là enhancement nhỏ, không phải subsystem mới. Fit mya's tool-based, interactive, trusted-agent architecture.
