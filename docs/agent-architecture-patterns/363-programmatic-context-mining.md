# Hướng MY: Programmatic Context Mining — think-in-code: sandbox chạy script chỉ lấy stdout (1 script thay 47 Reads)

> **Nguồn gốc:** "Think in code"; sandbox script execution; code interpreter (OpenAI); "agentic search via code"; `jq`/`grep`/`awk` as context filter; "compute don't read"; one-shot data extraction
> **Coupling:** 🟡 — thêm sandbox script tool + stdout-only capture vào agent
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (133 agent-sandbox + 179 agent-testing-sandbox sẵn — chưa có context-mining script tool)
> **Effort:** 2-2.5 tuần

## Nguồn gốc

**Anti-pattern phổ biến**: agent muốn 1 số liệu (VD "tổng dòng code trong src/") → gọi tool Read **47 lần** (mỗi file 1 lần) → 47 block context đầy → tràn window. **Think-in-code**: thay vì Read từng file, agent **viết 1 script** (`find src -name '*.ts' | xargs wc -l`) → chạy trong sandbox → chỉ lấy **stdout** (1 số: "12,340 lines") → context window chỉ +1 dòng. **Code interpreter** (OpenAI): model viết code để xử lý data thay vì đọc raw. Nguyên tắc: **đừng mang data vào context — hãy compute nó**: agent viết script, sandbox chạy, chỉ stdout vào context. 1 script = 47 Reads về mặt thông tin nhưng chỉ 1 block token. Khác **133 EC agent-sandbox** (sandbox chạy code sinh side-effect) — MY **read-only context mining**; khác **250 IP context-prefetching** (preload) — MY **compute trên demand**.

## Mô tả

mya programmatic context mining: agent có tool **`mine(script)`** — chạy script (jq/grep/sql/ts) trong sandbox read-only, chỉ trả **stdout** (stderr bị type-check/report riêng). Khi cần tổng hợp data (đếm, lọc, aggregate) → agent viết 1 script thay vì Read từng file. stdout (1 dòng/số) vào context; raw data KHÔNG vào. Kết quả: context window gọn (chỉ kết quả), agent vẫn có thông tin. Nối 133 EC sandbox (chạy code) — MY là **context-mining policy**.

## Kiến trúc

```
  Agent cần: "tổng dòng code TypeScript trong packages/"
  │
  ├─ ❌ ANTI-PATTERN (47 Reads):
  │    Read packages/agent/src/x.ts  → 200 lines vào context
  │    Read packages/agent/src/y.ts  → 150 lines vào context
  │    ... (×47) → window tràn
  │
  └─ ✅ THINK-IN-CODE (1 script):
       mine(`find packages -name '*.ts' | xargs wc -l | tail -1`)
            │
            ▼
       ┌─── SANDBOX (read-only, no network) ────┐
       │  chạy script                            │
       │  stdout: "12340 total"                  │
       │  stderr: (bỏ / report riêng)            │
       └────────────┬────────────────────────────┘
                    ▼
       CONTEXT chỉ nhận: "12340 total"  (1 dòng)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 133 EC agent-sandbox — sandbox runtime (nền — MY read-only mining)
// ✅ 179 FW agent-testing-sandbox — sandbox test (nền)
// ✅ 208 GZ parallel-tool-calls — chạy song song (nền)
// ✅ 218 HJ tool-output-compression — output giảm (nền — MY giảm hơn nữa)

// ❌ THIẾU: mine(script) tool (stdout-only capture)
// ❌ THIẾU: read-only sandbox policy (no write/network — an toàn)
// ❌ THIẾU: script result cache (cùng query → trả cache)
```

## Implementation

```typescript
// packages/agent/src/context-mining.ts (NEW)
import { spawn } from 'node:child_process';

interface MineResult { stdout: string; stderr: string; exitCode: number; truncated: boolean; }

class ContextMiner {
  constructor(
    private cwd: string,
    private maxOutputBytes = 4096,   // stdout giới hạn — không tràn context
    private timeoutMs = 5000,
  ) {}

  // mine — chạy script read-only, chỉ trả stdout (type-safe)
  async mine(script: string): Promise<MineResult> {
    return new Promise((resolve) => {
      // shell bị hạn chế: không network, read-only FS mount (133 EC sandbox)
      const proc = spawn('sh', ['-c', script], {
        cwd: this.cwd,
        env: { ...process.env, NO_NETWORK: '1' },
        timeout: this.timeoutMs,
      });
      let stdout = '', stderr = '', truncated = false;
      proc.stdout.on('data', (d: Buffer) => {
        if (stdout.length + d.length > this.maxOutputBytes) { truncated = true; proc.kill(); return; }
        stdout += d;
      });
      proc.stderr.on('data', (d: Buffer) => { stderr += d; });
      proc.on('close', (code) => resolve({
        stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? -1, truncated,
      }));
    });
  }
}

// Tool definition (agent gọi):
// const mineTool = {
//   meta: { name: 'mine', description: 'Run read-only script, returns stdout only' },
//   run: async (args: { script: string }) => {
//     const r = await miner.mine(args.script);
//     return { ok: r.exitCode === 0, output: r.stdout || r.stderr }; // chỉ stdout vào context
//   },
// };
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ 1 script thay 47 Reads (context gọn cực) | ❌ Script sai → kết quả sai (debug khó) |
| ✅ stdout giới hạn byte (không tràn window) | ❌ Sandbox setup (read-only mount) phức tạp |
| ✅ Aggregate mạnh (jq/grep/sql/awk) | ❌ Timeout — script treo → bỏ |
| ✅ Nối 133 EC sandbox + 208 GZ parallel | ❌ Model phải biết viết script đúng |

## Khác các hướng gần

| | 133 Agent Sandbox | 218 Tool-Output Compress | 250 Context Prefetching | MY: Programmatic Mining |
|---|---|---|---|---|
| Cái gì | Chạy code (side-effect) | Nén output | Preload | **Compute, chỉ stdout vào** |
| Read-only | ❌ | n/a | ✅ | ✅ |
| stdout-only | ❌ | ❌ | ❌ | ✅ |
| Thay N Reads | ❌ | ❌ | ❌ | ✅ |

## Khi nào chọn

- Agent hay Read nhiều file chỉ để tổng hợp (đếm/lọc/aggregate)
- Context window thường đầy do raw data
- Có sandbox read-only (133 EC) sẵn
- Kết hợp 133 EC (sandbox) + MY (mine tool) + 208 GZ (parallel scripts); guard script correctness (type-check stdout) + truncation (giới hạn byte)
