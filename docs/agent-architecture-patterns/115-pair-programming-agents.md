# Hướng DK: Pair Programming Agents — Navigator lập kế hoạch, Driver thực thi

> **Nguồn gốc:** PairCoder (ACM 2024, 56 cites; ACL 2026 findings); arXiv 2604.10300 "LLM Agents for Pair Programming"
> **Coupling:** 🟢 — 2 agent tách vai, không đổi runtime khác
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (subagents sẵn; thiếu 2-role orchestration)
> **Effort:** 1 tuần

## Nguồn gốc

Pair programming: **2 agent hợp tác** — **Navigator** (lập kế hoạch cao cấp, review) + **Driver** (cài đặt cụ thể) — PairCoder (56 cites): "Navigator agent for high-level planning and a Driver agent for specific implementation"; ACL 2026 findings: "first method to instantiate the Driver/Navigator as a fully autonomous two-LLM system"; arXiv 2604.10300: "driver-and-navigator setup to quantify when multi-agent collaboration improves reliability relative to single agent". Khác **GG supervisor-worker** (phân cấp quyền lực) — LLLLL là *vai bình đẳng chuyên môn* (review liên tục, không cấp trên/cấp dưới); khác **DDD ensemble/debate** (nhiều agent cho cùng output rồi so) — LLLLL chia *2 vai bổ sung* (plan vs code) trong 1 luồng; khác **56 reflexion** (agent tự review mình) — review *chủ quan tiếng nói riêng* (agent khác nhìn khác góc).

## Mô tả

mya coding task (subagent): chạy **2-role loop**: (1) **Navigator** — đọc task/spec (KKKKK) → đưa hướng triển khai (files, API, test plan, risk) — *không viết code chính*; (2) **Driver** — nhận hướng → viết code + tests (cụ thể); (3) **review pass** — Navigator xem lại code Driver: đúng hướng? lỗi tiềm ẩn? (independent glance — không cùng bias); (4) **iteration** — sai → chốt lại hướng (đừng để Driver loop mù); (5) **verify** — vitest + criteria (KKKKK) → kết quả (53). Ưu điểm khác single agent: cross-check giảm lỗi, "trust signals", phát hiện bias (arXiv 2604.10300); nhược: 2× cost tokens (PPPPP cân — Navigator dùng model rẻ). Mô hình này nối LLLLL vào KKKKK (spec → navigator → driver).

## Kiến trúc

```
  TASK + SPEC (KKKKK)
        │
        ▼
  NAVIGATOR (model rẻ PPPP · planning · review — KHÔNG viết chính)
    ├─ hướng triển khai: files/API/test plan/risk
    └─ review lại code Driver (independent glance — khác 56)
        │
        ▼
  DRIVER (model mạnh · implementation)
    ├─ viết code + tests theo hướng Navigator
    └─ nhận review → sửa (iteration có giới hạn RRRR budget)
        │
        ▼
  VERIFY: vitest + criteria (KKKKK · 53) — pass → merge (SSSS)
  đo: cross-check giảm lỗi vs single (43/QQQQ) · chi phí 2× (PPPPP bù)
```

```
mya: subagent spawn (XX) SẸN — thiếu: 2-role orchestration (navigator/driver)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ package/print role-subagent-spawn + XX — spawn subagent (nền)
// ✅ KKKKK spec + vitest + 53 — contract + verify
// ✅ RRRR budget — iteration giới hạn
// ✅ PPPP local — Navigator model rẻ (giảm chi phí 2×)
// ✅ QQQQ trace + JJJ — đo hiệu quả cross-check
// ✅ GG supervisor — điều phối vai (supervisor giao luồng)

// ❌ THIẾU: 2-role loop chuẩn (navigator→driver→review→iterate)
// ❌ THIẾU: phân công model theo vai (rẻ/mạnh)
// ❌ THIẾU: metric cải thiện vs single agent (A/B)
```

## Implementation

```typescript
// packages/print/src/pair-loop.ts (NEW)
async function pairProgram(task: CodingTask, spec: Spec): Promise<PairResult> {
  const navigator = spawnNavigator({ model: "local" });    // rẻ PPPP
  const direction = await navigator.plan(spec);            // high-level
  let code: Code | null = null;
  for (let i = 0; i < budget.maxIterations; i++) {         // RRRR
    code = await spawnDriver({ model: "frontier" }).implement(direction, spec);
    const review = await navigator.review(code, direction); // independent
    if (review.pass) break;                                 // chốt hướng
    direction = await navigator.rePlan(review.feedback);    // không loop mù
  }
  return { code, verify: runVitest(code, spec.criteria) }; // KKKKK/53
}
// cross-check ≠ self-reflection (56): người khác nhìn khác góc
// đồ thị: reliable hơn single? đo USS trace A/B (arXiv 2604.10300)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Revisions chất lượng hơn single agent (cross-check) | ❌ 2× token (PPPPP Navigator rẻ giảm) |
| ✅ Navigator giữ hướng — Driver không loop mù | ❐ Bất đồng vai cần cơ chế quyết (spec thắng) |
| ✅ Independent reviewer chống bias cá nhân (2604.10300) | ❌ Không phải task nào cũng cần pair (task nhỏ thừa) |
| ✅ Nối KKKKK spec + vitest verify | ❌ Đo "thực sự tốt hơn" cần A/B (QQQQ) |

## Khác các hướng gần

| | 56 Reflexion | GG Supervisor-Worker | LLLLL: Pair Roles |
|---|---|---|---|
| Quan hệ | Tự phản ánh | Cấp trên/dưới | **Đồng chuyên môn bổ sung** |
| Review | Chính mình | Kiểm kết quả | **Agent khác independent** |
| Cấu trúc | 1 agent | Phân cấp | **2 vai: plan vs code** |

## Khi nào chọn

- Coding task phức tạp, single agent hay lệch hướng
- Muốn independent review (không cùng bias)
- Đã có subagent spawn + spec + vitest — thêm 2-role loop
- Chấp nhận 2× cost (Navigator rẻ PPPP) cho task đáng