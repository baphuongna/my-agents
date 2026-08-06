# Hướng NC: Designated Scratchpad — thư mục scratch riêng agent tùy ý

> **Nguồn gốc:** "Scratchpad"; "agent workspace"; temp directory; intermediate artifacts; Codex scratchpad; "thinking on disk"; scratchpad reasoning; "agent-controlled temp space"
> **Coupling:** 🟢 — thêm scratch dir policy + scratch tool vào agent
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (133 agent-sandbox + filesystem tool sẵn — chưa có designated scratch dir)
> **Effort:** 0.5-1 tuần

## Nguồn gốc

**Scratchpad**: vùng nhớ tạm agent dùng tự do — ghi note trung gian, draft, partial output, reasoning thô — **không phải output chính thức**. **Vấn đề**: nếu agent ghi scratch vào **context window** (note trong reasoning) → chiếm token. **Giải pháp**: **thư mục scratch trên disk** (`.mya/scratch/` hoặc tmpdir) — agent ghi file tự do, đọc lại khi cần, **không vào context** trừ khi chủ động load. Nguyên tắc: **offload intermediate state ra disk** — context chỉ giữ "current focus", scratch giữ "working memory on disk". Khác **363 MY programmatic-mining** (compute stdout) — NC **store artifacts**; khác **362 MX event-sourced** (bất biến log) — NC **ephemeral, agent xóa/sửa tự do**; khác **133 EC sandbox** (chạy code) — NC **scratch storage**.

## Mô tả

mya designated scratchpad: agent có **thư mục scratch riêng** (VD `os.tmpdir()/mya-scratch/<session>/`) + tool `scratch.write`/`scratch.read`/`scratch.list`. Agent ghi note/draft/partial tự do (giải phương trình, draft refactor plan, log debug). Scratch **không tự vào context** — agent load khi cần. Sau session → cleanup (hoặc giữ để resume). Kết quả: reasoning thô không tốn context token, agent vẫn có "bản nháp".

## Kiến trúc

```
  AGENT làm việc
   · giải bài toán dài → ghi note trung gian
   · draft refactor plan
   · log debug từng bước
        │
        ├──► scratch.write('plan.md', 'step 1: extract...')
        ├──► scratch.write('calc.tmp', 'x=42, y=...')
        │         │
        │         ▼
        │    DESIGNATED SCRATCH DIR (.mya/scratch/<session>/)
        │     ├── plan.md
        │     ├── calc.tmp
        │     └── debug.log
        │     (KHÔNG tự vào context window ✅)
        │
        ├──► cần lại? scratch.read('plan.md') → load 1 file vào context
        └──► xong? scratch.clear() hoặc giữ để resume
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 133 EC agent-sandbox — filesystem access (nền — NC designated dir)
// ✅ 363 MY programmatic-mining — compute (nền — NC store artifacts)
// ✅ 366 NB seamless-compaction — work state (nền — NC lưu scratch cho resume)
// ✅ filesystem tool (read/write) — sẵn (nền — NC policy + path)

// ❌ THIẾU: designated scratch dir policy (path + isolation per session)
// ❌ THIẾU: scratch tool (write/read/list/clear — scoped to scratch only)
// ❌ THIẾU: lifecycle (cleanup on session end / keep for resume)
```

## Implementation

```typescript
// packages/agent/src/scratchpad.ts (NEW)
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

class Scratchpad {
  private dir: string;
  constructor(sessionId: string) {
    this.dir = mkdtempSync(join(tmpdir(), `mya-scratch-${sessionId}-`));
  }

  write(name: string, content: string): string {
    const path = join(this.dir, name);
    writeFileSync(path, content);
    return path;
  }

  read(name: string): string {
    return readFileSync(join(this.dir, name), 'utf8');
  }

  list(): string[] {
    return existsSync(this.dir) ? readdirSync(this.dir) : [];
  }

  has(name: string): boolean {
    return existsSync(join(this.dir, name));
  }

  // Cleanup — xóa sau session (hoặc giữ để resume)
  cleanup(): void {
    if (existsSync(this.dir)) rmSync(this.dir, { recursive: true, force: true });
  }

  get path(): string { return this.dir; }
}

// Tools (agent gọi — scoped chỉ scratch dir, an toàn):
// const scratchTools = [
//   { meta: { name: 'scratch.write' },
//     run: (a: { name: string; content: string }) => {
//       const p = scratch.write(a.name, a.content);
//       return { ok: true, output: `wrote ${a.name} (${a.content.length} bytes)` };
//     } },
//   { meta: { name: 'scratch.read' },
//     run: (a: { name: string }) => {
//       if (!scratch.has(a.name)) return { ok: false, output: 'not found' };
//       return { ok: true, output: scratch.read(a.name) };
//     } },
// ];
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Reasoning thô không tốn context token | ❌ Agent phải chủ động read (không tự nhớ) |
| ✅ Agent có "bản nháp" (draft/note/debug) | ❌ Disk I/O overhead (nhẹ) |
| ✅ Scoped an toàn (chỉ scratch dir) | ❌ Cleanup quên → disk đầy |
| ✅ Resume được (giữ scratch qua session) | ❌ Scratch phình to nếu không dọn |

## Khác các hướng gần

| | 133 Agent Sandbox | 362 Event-Sourced Session | 363 Programmatic Mining | NC: Designated Scratchpad |
|---|---|---|---|---|
| Cái gì | Chạy code (side-effect) | Log event bất biến | Compute stdout | **Store intermediate artifacts** |
| Ephemeral | ❌ | ❌ (bất biến) | ✅ | ✅ (agent xóa/sửa) |
| Offload context | ❌ | ✅ (index) | ✅ (stdout) | ✅ (file) |
| Free-form | ❌ | ❌ | ❌ | ✅ (agent tùy ý) |

## Khi nào chọn

- Agent cần ghi note/draft/partial (reasoning dài) — không tốn context
- Muốn offload intermediate state ra disk
- Cần resume (giữ scratch qua session)
- Kết hợp 133 EC (sandbox FS) + NC (designated dir) + 366 NB (work state có thể dùng scratch); guard cleanup (lifecycle) + disk growth (size cap)
