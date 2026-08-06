# Hướng ADZ: Skill Preamble Runtime Env — mỗi SKILL.md bắt đầu bằng preamble bash in runtime context

> **Nguồn gốc:** gstack | **Coupling:** 🟢 — convention đầu skill file, không đổi runtime | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (sẵn skill parser; thiếu preamble runner) | **Effort:** 1 tuần

## Nguồn gốc

**gstack** có autoplan skill quy định: mỗi **SKILL.md bắt đầu bằng preamble bash script** in **runtime context**: branch hiện tại, **proactive mode**, telemetry flags, upgrade availability, repo mode, learnings count. Agent chạy preamble trước khi đọc phần còn lại của skill — context runtime được nạp ngay từ đầu.

Triết lý: "**Treat the skill file as executable instructions, not reference**" — skill không phải tài liệu để đọc tham khảo mà là **instruction có thể thực thi**: phần preamble chạy được, phần thân là các bước agent phải làm. Skill được thiết kế như chương trình (program) chứ không như doc (documentation).

## Mô tả

Với mya, `packages/skills` parse SKILL.md (frontmatter + body). Pattern thêm: **preamble block** (ví dụ khối ` ```bash preamble` ở đầu body) — runner chạy script, output nạp vào context trước khi agent đọc skill. `packages/tools` codeexec có sẵn execution; `packages/prompts` assembler chèn preamble output vào prompt. Quy ước cần thêm vào `parseSkillMarkdown`: tách preamble khỏi body (không để agent đọc script thô — chạy và đọc output). An toàn: preamble chạy trong sandbox/read-only context (nối permission). Gap: parser chưa nhận diện preamble block.

## Kiến trúc (ASCII)

```
  SKILL.md
    ├─ frontmatter (name, description, triggers)
    ├─ PREAMBLE (```bash ... ```)
    │    in branch · proactive mode · telemetry flags
    │    upgrade availability · repo mode · learnings count
    └─ body (các bước agent làm)
            │
            ▼
  SKILL RUNNER (mya)
    ├─ chạy preamble (codeexec / read-only)
    ├─ output → context (agent biết runtime trước)
    └─ rồi mới đọc body — skill như EXECUTABLE instructions
  ⚠️ "Treat the skill file as executable instructions, not reference"
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/skills/src/skill.ts — parseSkillMarkdown + SkillFrontmatter
//   (nền tách preamble khỏi body)
// ✅ packages/skills/src/curator.ts — discover + load SKILL.md
// ✅ packages/tools/src/codeexec.ts — codeexec (chạy preamble an toàn)
// ✅ packages/prompts — assembler (chèn preamble output vào prompt)
// ✅ packages/core — RuntimeEvent (ghi preamble execution)

// ❌ THIẾU: preamble block nhận diện + tách khỏi body
// ❌ THIẾU: runner chạy preamble trước body, output vào context
// ❌ THIẾU: permission cho preamble (read-only theo mặc định)
```

## Implementation

```typescript
// packages/skills/src/preamble.ts (NEW)
export interface PreambleResult {
  output: string;
  ran: boolean;
}

const PREAMBLE_RE = /```(?:bash|sh)\s*\n([\s\S]*?)```/;

export function extractPreamble(body: string): { preamble?: string; rest: string } {
  const m = PREAMBLE_RE.exec(body);
  if (!m) return { rest: body };
  return { preamble: m[1], rest: body.slice((m.index ?? 0) + (m[0]?.length ?? 0)) };
}

export async function runPreamble(
  skill: Skill,
  exec: (script: string) => Promise<{ stdout: string; exitCode: number }>,
): Promise<PreambleResult> {
  const { preamble } = extractPreamble(skill.body);
  if (!preamble) return { output: "", ran: false };

  // preamble chạy read-only theo mặc định (nối permission layer)
  const r = await exec(`set -e\n${preamble}`);
  if (r.exitCode !== 0) {
    return { output: `[preamble failed: ${r.stdout}]`, ran: true };
  }
  return { output: r.stdout, ran: true };
}

// SkillStore.loadSkill — trả về { skill, preambleOutput } để assembler
// chèn output vào prompt TRƯỚC khi agent đọc body.
export function loadSkillWithEnv(store: SkillStore, name: string): { skill: Skill; env: string } {
  const skill = store.get(name);
  return { skill, env: extractPreamble(skill.body).preamble ?? "" };
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent biết runtime trước khi làm — ít đoán sai | ❌ Preamble chạy mỗi lần load — overhead nhỏ |
| ✅ Skill như executable — nhất quán | ❌ Script trong skill = rủi ro (cần permission) |
| ✅ Context runtime tự động, không hỏi lại | ❌ Preamble hỏng → skill fail (cần fallback) |
| ✅ Branch/mode/learnings nạp ngay | ❌ Parser phải tách preamble đúng cú pháp |

## Khác các hướng gần

| | ADZ Preamble Env | ADS Invocation Axis | AEB Ship Workflow |
|---|---|---|---|
| Đầu file | Script chạy in context | disable-model-invocation | — |
| Cơ chế | bash preamble | Frontmatter description | Lệnh /ship |
| Mục đích | Runtime context | Ai gọi skill | Release path |

## Khi nào chọn

- Skill phụ thuộc runtime (branch, mode, environment) — cần biết trước
- Muốn skill là executable instructions thay vì reference doc
- Đã có skill parser + codeexec — thêm preamble runner
- Chấp nhận script trong skill với permission layer