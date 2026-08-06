# Hướng FW: Agent Testing Sandbox — CI/CD cho agent: chạy trong môi trường an toàn trước khi deploy

> **Nguồn gốc:** Modal "Best Sandboxes for AI CI/CD and Test Automation 2026" (serverless sandbox platforms — 7 platforms); Confident AI "Best CI/CD Tools for Testing AI Agents" (agent testing → reviewable release workflow); datagrid "4 Testing Frameworks for Non-Deterministic AI Agents" (Simulation-Based — validate trong synthetic environments); Straiker (Embedding Autonomous Attack Simulation into CI/CD — test + harden trước deploy); bunnyshell (Docker, Firecracker microVMs, K8s, cloud sandboxes)
> **Coupling:** 🟢 — lớp test ngoài runtime, không đổi lõi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (PP eval + smoke test sẵn; thiếu sandbox + release gate)
> **Effort:** 2-4 tuần

## Nguồn gốc

Agent sandbox: **chạy agent trong môi trường cô lập (Docker/microVM/serverless) — test đủ điều kiện giống production trước khi deploy, chặn lỗi ở CI** — Confident AI: "turns agent testing into a reviewable release workflow"; datagrid: "simulation-based testing validates agent behavior in synthetic environments before production — also run A/B, chaos, and interaction tests"; Modal: sandbox platforms cho test automation (isolated compute); starknet: "embedding autonomous attack simulation into CI/CD — test and harden agent behavior before deployment"; bunnyshell: Docker vs Firecracker microVM vs K8s — mức cô lập khác nhau. Điểm khác **PP eval** (đo chất lượng trên dataset) và **LLL regression?** (chạy test) — XXXXXXX *môi trường + release gate*: (1) sandbox runtime — chạy agent trong container/microVM cô lập (bunnyshell — ảnh hưởng thực sự không lan ra); (2) giả lập dependency — mock tool/MCP bên ngoài (datagrid simulation: giả các API để test luồng, không phụ thuộc dịch vụ thật); (3) test suites — unit agent + integration (tool/tool call) + scenario (150) + non-determinism (chạy nhiều lần — đảm bảo ổn định); (4) security test — attack simulation (starknet — prompt injection, lạm quyền), quarantine nếu hỏng; (5) release gate — pass CI → build artifact → deploy (Confident workflow — review trước phát hành); (6) version — CI đánh version mới (FFFF), ghi nhận kết quả (YYYY log).

## Kiến trúc

```
  CI/CD PIPELINE (Confident — reviewable release workflow)
   │
   ├── 1. BUILD sandbox (Modal/serverless) — cô lập (bunnyshell Docker/microVM)
   ├── 2. SIMULATION: giả lập API/MCP/DB (datagrid — behavior trước production)
   ├── 3. TEST: unit · integration · scenario · chạy nhiều lần (non-determinism)
   ├── 4. SECURITY: attack simulation (starknet — injection/tool-abuse)
   ├── 5. GATE: pass → release (review + RRR log) · fail → block
   └── 6. DEPLOY: artifact → agent registry / version mới (FFFF)
```

```
mya: smoke + PP eval SẴN — thiếu: sandbox runtime + simulated deps + release gate
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ smoke test + unit test — cơ bản trong repo
// ✅ PP eval — dataset eval (nền 1 step)
// ✅ 163 scenario tests? — nếu có
// ✅ RRRR? — log kết quả CI
// ✅ FFFFFF version + ICI registry — artifact deploy
// ✅ NNN registry — cất agent (đã có cơ chế publish)

// ❌ THIẾU: sandbox runtime (container/microVM — chạy cô lập thật)
// ❌ THIẾU: simulation deps (giả API/MCP/DB trong CI)
// ❌ THIẾU: release gate (pass → publish, fail → block)
// ❌ THIẾU: non-determinism test (chạy nhiều lần)
```

## Implementation

```typescript
// packages/cicd/src/sandbox.ts (NEW)
export async function testAgent(agent: Agent) {
  const sbx = await sandbox.spawn({ image: agent.image, isolate: "microvm" }); // bunnyshell/microVM
  const sim = await sb.mock({ apis: agent.deps, mcp: mcpMock });             // databrig simulation
  const results = await Promise.all([...nonDet(unit(sbx)), ...integration(sbx)]);
  const security = await attackSimulation(sbx);  // starknet — prompt injection
  return gate(results) ? publish(agent) : block(agent); // Confident release workflow
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Lỗi bị chặn trước production — agent không phá môi trường thật | ❌ Sandbox cần tái lập được môi trường — tốn setup |
| ✅ Test non-determinism — chạy nhiều lần ổn định | ❐ CI chạy agent tốn cost/token (bản full) |
| ✅ Security test tự động (starknet AAS) | ❌ Simulation chỉ xấp xỉ production |
| ✅ Xây trên test suite + FFFF + NNN | ❌ Agent lại phụ thuộc nhiều deps — mock khó |

## Khác các hướng gần

| | PP Eval | Smoke Test | XXXXXXX: Sandbox+CI |
|---|---|---|---|
| Phạm vi | Dataset chất lượng | Module load | **Cả luồng release** |
| Môi trường | Static | — | **Cô lập + mô phỏng** |
| Quan hệ | Đo output | Khởi tạo | **Chạy agent + gate trước publish** |

## Khi nào chọn

- Agent sẽ chạy production — lỗi tốn tiền (CI/CD cần X stack bảo)
- Agent gọi nhiều deps (MCP/tool/API) — cần mô phỏng khi test
- Muốn vòng sau khiếm lỗi nhanh — cập nhanj bảo lãnh chất lượng
- Đã có test+NNN — thêm sandbox + release gate