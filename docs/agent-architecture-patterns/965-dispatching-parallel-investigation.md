# Hướng AKC: Dispatching Parallel Investigation — khi nhiều failure độc lập, dispatch một agent per problem domain để investigate song song, mỗi agent nhận context được craft riêng, không shared state

> **Nguồn gốc:** superpowers (skills/dispatching-parallel-agents/SKILL.md) | **Coupling:** 🟡 — dispatch orchestration + subagent | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có spawnSubagent + workflow parallel; thiếu per-domain dispatch) | **Effort:** 2 tuần

## Nguồn gốc

**superpowers** (skills/dispatching-parallel-agents/SKILL.md) **dispatch một agent per problem domain** khi có **nhiều failure độc lập** (test files khác nhau, subsystems khác nhau): (1) **mỗi agent investigate song song** — không tuần tự, không gộp vào một agent; (2) **context được craft riêng** — mỗi agent nhận đúng domain của nó (file path, subsystem, lỗi liên quan) — không phải copy toàn bộ context; (3) **không shared state giữa các investigation** — mỗi investigation độc lập, không ghi chồng lên nhau; (4) **chỉ gộp kết quả ở cuối** — parent tổng hợp findings, không can thiệp giữa chừng.

Giá trị: (1) **song song = nhanh** — N failure độc lập → N agent chạy cùng lúc thay vì tuần tự; (2) **context tập trung** — mỗi agent chỉ thấy domain của nó — ít noise, ít sai; (3) **không đụng state** — investigation độc lập không làm hỏng nhau; (4) **tổng hợp có cấu trúc** — parent nhận findings theo domain, dễ gộp.

## Mô tả

Với mya, pattern = **per-domain parallel investigation**: (1) **failure clustering** — parent phân nhóm failures theo problem domain (test file, subsystem, error signature) — heuristic từ output (nối AET test parser); (2) **dispatch** — mỗi cluster → một `spawnSubagent` (đã có `packages/agent` — subagent.test.ts) với context craft riêng (chỉ cluster files + lỗi liên quan); (3) **isolation** — mỗi subagent chạy độc lập (agent pool — `packages/agent/src/pool.ts` có per-agent concurrency); không shared state — kết quả trả về qua return value; (4) **collect** — parent `Promise.all` (mẫu `parallel` trong `packages/workflows/src/runner.ts`) gom findings; (5) **merge** — findings theo domain, conflicts (hai agent đụng cùng file) → nêu rõ, không tự resolve; (6) nơi gắn — workflow: skill body hướng dẫn dispatch, runner thực thi. Đây là pattern **parallelism by domain isolation**: song song an toàn vì mỗi agent có biên giới rõ, không chạm nhau.

## Kiến trúc (ASCII)

```
  NHIỀU FAILURE (test files khác nhau / subsystems khác nhau)
    │
    ▼ FAILURE CLUSTERING (theo problem domain — heuristic từ output)
  ├─ cluster A: test/api.test.ts (3 fail)
  ├─ cluster B: test/ui.test.ts (2 fail)
  └─ cluster C: subsystem sync (1 fail)
    │
    ▼ DISPATCH — 1 agent per cluster (song song — spawnSubagent)
  ├─ agent-A ──► context: api.test.ts + 3 lỗi      (isolation — không shared state)
  ├─ agent-B ──► context: ui.test.ts + 2 lỗi
  └─ agent-C ──► context: sync subsystem + 1 lỗi
    │
    ▼ COLLECT (Promise.all — parent gom findings)
    ▼ MERGE theo domain — conflict (2 agent đụng file) → nêu rõ, không tự resolve
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/agent/src/subagent.test.ts — spawnSubagent (nền — 1 agent per domain)
// ✅ packages/agent/src/pool.ts — AgentPool (per-agent concurrency — chạy song song)
// ✅ packages/workflows/src/runner.ts — parallel() (nền — Promise.all collect)
// ✅ packages/tools/src/lsp-cascade.ts — diagnostics (nền — nguồn failure)
// ✅ packages/eval/src/harness.ts — test harness (nền — failure output)
// ❌ THIẾU: failure clustering theo problem domain
// ❌ THIẾU: context crafting per domain (không copy toàn bộ context)
// ❌ THIẾU: conflict detection khi merge findings (2 agent đụng file)
```

## Implementation

```typescript
// packages/agent/src/parallel-investigate.ts (NEW)
export interface FailureCluster {
  domain: string;              // problem domain: file / subsystem / error signature
  failures: string[];          // failure lines trong cluster
  files: string[];             // files liên quan — context cho agent
}
export interface InvestigationFinding {
  domain: string;
  rootCauses: string[];
  filesTouched: string[];      // để parent detect conflict khi merge
}

/** Failure clustering — gom failures theo problem domain (heuristic). */
export function clusterFailures(failures: Array<{ file: string; message: string }>): FailureCluster[] {
  const byFile = new Map<string, FailureCluster>();
  for (const f of failures) {
    const domain = f.file.split("/").slice(-2).join("/");     // "test/api.test.ts"
    const existing = byFile.get(domain) ?? { domain, failures: [], files: [] };
    existing.failures.push(f.message);
    if (!existing.files.includes(f.file)) existing.files.push(f.file);
    byFile.set(domain, existing);
  }
  return [...byFile.values()];
}

/** Dispatch — 1 agent per cluster, context craft riêng (chỉ domain của nó). */
export async function dispatchParallelInvestigation(clusters: FailureCluster[], spawn: (goal: string, opts: { allowedTools?: string[] }) => Promise<string>): Promise<InvestigationFinding[]> {
  return Promise.all(
    clusters.map(async (c) => {
      const goal = [
        `Investigate domain "${c.domain}" (isolation — không đụng domain khác).`,
        `Files: ${c.files.join(", ")}`,
        `Failures:\n${c.failures.map((f) => `- ${f}`).join("\n")}`,
        `Trả về: root causes + files bạn đã chạm (để parent detect conflict).`,
      ].join("\n");
      const output = await spawn(goal, { allowedTools: ["read", "grep", "find"] });
      return { domain: c.domain, rootCauses: [output], filesTouched: c.files };
    }),
  );
}

/** Conflict detection khi merge — 2 agent chạm cùng file → nêu rõ, không tự resolve. */
export function detectMergeConflicts(findings: InvestigationFinding[]): string[] {
  const touched = new Map<string, string[]>();
  for (const f of findings) {
    for (const file of f.filesTouched) {
      const owners = touched.get(file) ?? [];
      owners.push(f.domain);
      touched.set(file, owners);
    }
  }
  return [...touched.entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(([file, owners]) => `file ${file} bị chạm bởi ${owners.join(", ")} — cần sequencing`);
}
// Nối workflows: skill body hướng dẫn cluster → dispatch → collect → merge
// Nối pool: spawn qua AgentPool (per-agent concurrency — song song an toàn)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Song song — N failure độc lập chạy cùng lúc | ❌ Clustering heuristic lệch → agent nhận domain sai |
| ✅ Context craft riêng — ít noise, ít sai | ❐ Nhiều subagent cùng lúc tốn token/budget |
| ✅ Không shared state — investigation không đụng nhau | ❌ Conflict vẫn có thể xảy ra — cần detect + escalate |
| ✅ Merge có cấu trúc theo domain | ❌ Agent trả output dài — cần nén (nối ZY) |

## Khác các hướng gần

| | AKC Parallel Investigation | 701 Compressed Subagent | 685 Deterministic Parallel |
|---|---|---|---|
| Trọng tâm | 1 agent per problem domain | Nén output subagent | Song song giữ deterministic |
| Cơ chế | Cluster + dispatch + merge | Output contract nén | ctx.parallel.map |
| Quan hệ | Sinh output cần nén (701) | Tiêu thụ output của AKC | Khác miền (workflow) |

## Khi nào chọn

- Test suite fail nhiều chỗ độc lập — muốn investigate song song thay vì tuần tự
- Subsystems tách biệt — mỗi domain một agent, context tập trung
- Đã có spawnSubagent + pool + parallel — thêm clustering là rẻ
- Guard: cluster theo domain thật, context craft riêng, isolation, conflict escalate không tự resolve