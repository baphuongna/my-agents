# Hướng AKA: Writing Skills as TDD — Writing Skills áp dụng TDD vào documentation: pressure scenario là test case, SKILL.md là production code, baseline là RED, verify là GREEN

> **Nguồn gốc:** superpowers (skills/writing-skills/SKILL.md) | **Coupling:** 🟢 — skill-authoring workflow | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có skills + eval harness; thiếu RED/GREEN loop cho skill) | **Effort:** 1-2 tuần

## Nguồn gốc

**superpowers** (skills/writing-skills/SKILL.md) áp dụng **TDD vào documentation**: (1) **pressure scenario với subagent là test case** — chọn tình huống khó (agent bị áp lực hay làm sai) làm test; (2) **SKILL.md là production code** — skill là thứ được "viết để pass test"; (3) **baseline test (agent vi phạm khi chưa có skill) là RED** — chạy subagent qua scenario chưa có skill → agent làm sai → test đỏ (bằng chứng skill cần thiết); (4) **verify agent tuân thủ sau khi thêm skill là GREEN** — thêm skill → chạy lại → agent làm đúng → test xanh; (5) **đóng loophole là refactor** — agent tìm cách lách skill → sửa skill (refactor) cho hết loophole.

Giá trị: (1) **skill có bằng chứng hiệu quả** — không phải "viết xong là tin", mà RED→GREEN chứng minh; (2) **skill chỉ viết khi cần** — không có skill thì RED mới viết (tránh skill thừa); (3) **loophole bị đóng** — refactor vòng lặp bắt lỗ hổng; (4) **tái dùng eval hạ tầng** — test case chạy qua subagent, có thể tự động hóa.

## Mô tả

Với mya, pattern = **TDD loop cho skill authoring**: (1) **scenario corpus** — mỗi skill đi kèm pressure scenario (mô tả tình huống + tiêu chí "đúng") — đặt trong `test/features/07-skills/`; (2) **RED run** — chạy scenario qua subagent (`packages/agent` spawnSubagent) chưa có skill → assert sai → RED (bằng chứng skill cần); (3) **write skill** — viết SKILL.md (packages/skills SkillStore load); (4) **GREEN run** — chạy lại → assert đúng → GREEN; (5) **loophole refactor** — nếu agent vẫn sai kiểu khác (lách skill) → sửa skill → chạy lại — loop tới GREEN; (6) **regression** — skill cũ không vỡ khi sửa skill mới (chạy toàn bộ corpus). Đây là pattern **test-driven documentation**: skill không phải văn bản hay, mà là code phải pass test.

## Kiến trúc (ASCII)

```
  PRESSURE SCENARIO (test case — tình huống khó, agent hay sai)
    │
    ▼ RED — chạy subagent CHƯA có skill
  ├─ agent vi phạm (làm sai) ──► test ĐỎ (bằng chứng skill cần thiết)
    │
    ▼ WRITE SKILL.md (production code — viết để pass test)
    ▼ GREEN — chạy lại subagent CÓ skill
  ├─ agent tuân thủ ──► test XANH
  └─ agent lách skill (loophole) ──► REFACTOR skill → chạy lại
    │
    ▼ REGRESSION — chạy toàn bộ corpus (skill cũ không vỡ)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/skills/src/curator.ts — SkillStore (load SKILL.md — production code)
// ✅ packages/agent/src/subagent.test.ts — spawnSubagent (chạy scenario)
// ✅ packages/ai/src/mock.ts — MockProvider (chạy test không network)
// ✅ packages/eval/src/harness.ts + tiers.ts — IntegrationTier (nơi chạy RED/GREEN)
// ✅ test/features/07-skills/ — thư mục skill tests (nơi đặt scenario corpus)
// ❌ THIẾU: RED run (baseline — agent vi phạm khi chưa có skill)
// ❌ THIẾU: GREEN assertion (agent tuân thủ sau khi thêm skill)
// ❌ THIẾU: loophole refactor loop (lách skill → sửa skill → re-run)
```

## Implementation

```typescript
// packages/eval/src/skill-tdd.ts (NEW)
export interface ScenarioCase {
  name: string;                // tên scenario
  prompt: string;              // pressure scenario — tình huống khó
  passWhen: (output: string) => boolean;   // tiêu chí "đúng"
}
export interface SkillTddResult {
  scenario: string;
  red: boolean;                // chưa có skill → agent vi phạm (RED)
  green: boolean;              // có skill → agent tuân thủ (GREEN)
  loopholes: string[];         // cách agent lách skill (để refactor)
}

/** RED — baseline: chạy scenario với agent KHÔNG có skill body. */
export async function runRed(run: (prompt: string, skillBody?: string) => Promise<string>, c: ScenarioCase): Promise<{ violated: boolean; output: string }> {
  const output = await run(c.prompt);          // không truyền skillBody
  return { violated: !c.passWhen(output), output };
}

/** GREEN — chạy lại với skill body trong prompt. */
export async function runGreen(run: (prompt: string, skillBody?: string) => Promise<string>, c: ScenarioCase, skillBody: string): Promise<{ compliant: boolean; output: string }> {
  const output = await run(c.prompt, skillBody);
  return { compliant: c.passWhen(output), output };
}

/** Loophole detection — output "đúng" theo passWhen nhưng vi phạm tinh thần skill. */
export function detectLoophole(c: ScenarioCase, output: string, forbidden: RegExp[]): string[] {
  return forbidden.filter((re) => re.test(output))
    .map((re) => `output khớp pattern cấm ${re} — skill cần refactor đóng loophole`);
}

/** TDD loop — RED chứng minh skill cần, GREEN chứng minh skill đủ. */
export async function skillTddLoop(run: (prompt: string, skillBody?: string) => Promise<string>, cases: ScenarioCase[], writeSkill: (body: string) => Promise<string>): Promise<SkillTddResult[]> {
  const results: SkillTddResult[] = [];
  for (const c of cases) {
    const { violated, output } = await runRed(run, c);
    if (!violated) {
      results.push({ scenario: c.name, red: false, green: true, loopholes: [] });
      continue;                                   // không có skill vẫn đúng — skill không cần
    }
    let body = "";
    let green = false;
    let loopholes: string[] = [];
    while (!green) {
      body = await writeSkill(body);              // viết/sửa skill (refactor)
      const { compliant, output: o2 } = await runGreen(run, c, body);
      loopholes = detectLoophole(c, o2, [/tôi không cần/, /theo kinh nghiệm/]);
      green = compliant && loopholes.length === 0;
    }
    results.push({ scenario: c.name, red: true, green, loopholes });
  }
  return results;
}
// Nối skills: SKILL.md là production code — writeSkill ghi vào SkillStore
// Nối eval: chạy skillTddLoop trong IntegrationTier (MockProvider — rẻ, deterministic)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Skill có bằng chứng RED→GREEN — không "viết xong là tin" | ❌ Scenario corpus tốn công duy trì |
| ✅ Chỉ viết skill khi RED — tránh skill thừa | ❌ passWhen đánh giá output thủ công — khó tự động hóa hết |
| ✅ Loophole bị đóng bằng refactor loop | ❌ Chạy subagent nhiều vòng tốn thời gian |
| ✅ Tái dùng eval hạ tầng — MockProvider rẻ | ❌ Skill thay đổi môi trường — GREEN hôm nay chưa chắc mai |

## Khác các hướng gần

| | AKA Skill TDD | AJV Explicit Requests | 837 Correction Detector |
|---|---|---|---|
| Trọng tâm | Skill viết theo RED/GREEN | Test trigger skill | Phát hiện correction |
| Cơ chế | Scenario = test case | Corpus + assertion | 2-pass filter |
| Quan hệ | Sinh skill qua bằng chứng | Kiểm tra invocation | Nguồn scenario mới |

## Khi nào chọn

- Viết skill thường xuyên — muốn bằng chứng skill có tác dụng thật
- Skill dạy hành vi (tuân thủ, tránh lỗi) — hành vi đo được bằng scenario
- Đã có skills store + eval harness + MockProvider — thêm RED/GREEN là rẻ
- Guard: RED chứng minh cần, GREEN chứng minh đủ, loophole refactor tới khi sạch, regression toàn corpus