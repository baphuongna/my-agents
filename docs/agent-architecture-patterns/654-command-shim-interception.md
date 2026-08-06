# Hướng YD: Command Shim Interception — uv.ts + intercepted-commands: shell shims cho pip/pip3/poetry/python chặn lệnh non-uv và nudge agent về uv — steer hành vi agent qua shim thay vì prompt (README.md, extensions/uv.ts)

> **Nguồn gốc:** agent-stuff (README.md, extensions/uv.ts) | **Coupling:** 🟡 — shim nằm ngoài core, intercept command shell | **Agent-agnostic:** ⚠️ (Python ecosystem-specific) | **Code sẵn:** ⚠️ (có codeexec + permission — chưa có command shim) | **Effort:** 2-3 tuần

## Nguồn gốc

**agent-stuff** muốn agent dùng **uv** thay vì pip/poetry — nhưng không nhắc lại trong prompt (dễ quên, dễ bỏ qua). Thay vào đó: cài **shell shims** cho `pip`, `pip3`, `poetry`, `python` — mỗi shim là script nhỏ chặn lệnh, nếu lệnh non-uv → in nudge "hãy dùng uv" + chạy lệnh tương đương qua uv. **Steer hành vi agent qua shim thay vì prompt**: hành vi đúng được ép ở tầng shell, không phụ thuộc model có nghe lời prompt hay không. `intercepted-commands` là danh sách lệnh bị chặn/nudge.

## Mô tả

mya áp dụng command-shim-interception: với các lệnh agent hay gõ sai (pip install, python -m venv...), tạo shim đứng trước PATH. Shim kiểm tra: lệnh có thuộc dạng non-uv không? → nếu có: (1) log interception; (2) in nudge (đề xuất lệnh uv tương đương); (3) chạy thay bằng uv (hoặc chạy lệnh gốc nếu uv không hỗ trợ). Nếu lệnh đã dùng uv → pass-through không nhiễu. Shim nằm trong config của mya (ví dụ `~/.mya/shims/` được prepend PATH khi agent chạy). mya có sẵn codeexec (chạy lệnh), permission (kiểm tra lệnh trước khi chạy), approval (approve/deny) — YD thêm **shim generator** + **interception policy** + **nudge message**.

## Kiến trúc

```
  PATH: ~/.mya/shims  (prepend)  →  /usr/bin  →  ...

  Agent gõ:  pip install requests
       │
       ▼
  ~/.mya/shims/pip (shim script)
       │
       ├─ lệnh non-uv? ──► log interception
       │        │
       │        ▼
       │   in nudge: "💡 pip → uv: chạy `uv pip install requests`"
       │        │
       │        ▼
       │   chạy thay: uv pip install requests (hoặc gốc nếu uv không hỗ trợ)
       │
       └─ đã dùng uv? ──► pass-through (không nhiễu)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/tools codeexec.ts — chạy lệnh shell (nền — YD chạy shim/uv)
// ✅ packages/tools permission.ts — kiểm tra lệnh trước chạy (nền — YD policy check)
// ✅ packages/tools approval.ts — approve/deny lệnh (nền — YD chặn lệnh nguy hiểm)
// ✅ packages/core threat-scan.ts — quét lệnh/input (nền — YD shim không vượt scan)

// ❌ THIẾU: shim generator (script per lệnh bị chặn)
// ❌ THIẾU: interception policy (lệnh nào nudge, lệnh nào block)
// ❌ THIẾU: nudge message + log interception (telemetry)
```

## Implementation (TS)

```typescript
// packages/tools/src/command-shim.ts (MỚI)
import { writeFile, mkdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface ShimPolicy {
  command: string;       // "pip"
  replacement: string;   // "uv pip"
  always: boolean;       // true: luôn chặn; false: chỉ chặn khi uv tồn tại
}

const POLICIES: ShimPolicy[] = [
  { command: "pip", replacement: "uv pip", always: true },
  { command: "pip3", replacement: "uv pip", always: true },
  { command: "poetry", replacement: "uv", always: false },
  { command: "python", replacement: "uv run", always: false },
];

export class CommandShimInstaller {
  private shimDir = join(homedir(), ".mya", "shims");

  async install(): Promise<string[]> {
    await mkdir(this.shimDir, { recursive: true });
    const created: string[] = [];
    for (const p of POLICIES) {
      const path = join(this.shimDir, p.command);
      const script = `#!/usr/bin/env bash
# shim cho ${p.command} — chặn lệnh non-uv, nudge agent về uv
if command -v uv >/dev/null 2>&1 || ${p.always}; then
  echo "💡 ${p.command} → ${p.replacement}: chạy \`${p.replacement} $@\`" >&2
  echo "[intercepted] ${p.command} $*" >> "$HOME/.mya/shims/interceptions.log"
  exec ${p.replacement} "$@"
else
  exec ${p.command} "$@"
fi
`;
      await writeFile(path, script, { mode: 0o755 });
      await chmod(path, 0o755);
      created.push(path);
    }
    return created;
  }

  pathEnv(): string {
    return `${this.shimDir}:${process.env.PATH ?? ""}`;
  }
}

// Usage:
// const installer = new CommandShimInstaller();
// await installer.install();                       // tạo shims cho pip/pip3/poetry/python
// spawn("mya", { env: { ...process.env, PATH: installer.pathEnv() } });
// → agent gõ `pip install x` → shim nudge + chạy uv thay
```

## Được

- ✅ Steer qua shim, không phụ thuộc prompt — model quên cũng đúng
- ✅ Nudge kèm log — interception trace được (telemetry/audit)
- ✅ Pass-through thông minh — đã dùng uv thì không nhiễu
- ✅ Cài đặt deterministic — sinh script từ policy, gỡ được

## Mất

- ❌ Ecosystem-specific — policy pip/poetry chỉ hợp Python (mya đa ecosystem)
- ❌ Shim bypass — agent gõ đường dẫn tuyệt đối /usr/bin/pip là qua mặt

## Khác các hướng gần

| | Prompt instruction | Hook pre-exec (codeexec) | YD: Command Shim |
|---|---|---|---|
| Cưỡng chế | model tự nhớ | code chặn trước | **shell chặn trước** |
| Bypass | dễ | code chặn | **đường dẫn tuyệt đối** |
| Visibility | không log | log ở code | **interceptions.log** |

## Khi nào chọn

- Muốn ép agent dùng công cụ chuẩn (uv, pnpm) mà không phụ thuộc prompt
- Cần log mọi lệnh bị nudge (telemetry/audit)
- Có codeexec + permission + approval sẵn — YD thêm shim layer
- Nối packages/tools codeexec.ts (chạy lệnh thật) + permission.ts (policy lệnh) + audit (log interception); guard shim-bypass (đường dẫn tuyệt đối — scan lệnh trong codeexec), policy-sync (shim regenerate khi policy đổi — hash check), và nudge-fatigue (không nudge lặp quá N lần — silent pass sau đó); YD = command shim, kết hợp 653 YC throttled-repo-cache (cache + shim đều là lớp ngoài) + 70-llm-gateway (steer hành vi ở tầng trung gian)
