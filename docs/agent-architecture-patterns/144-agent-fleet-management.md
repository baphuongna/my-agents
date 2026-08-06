# Hướng EN: Agent Fleet Management — vận hành hàng trăm agent như hạm đội

> **Nguồn gốc:** Fast.io "AI Agent Fleet Management: Complete Scaling Guide" (6 operational pillars); Zylos "Fleet Management & Multi-Instance Orchestration" 2026 (45% nhanh hơn / 60% chính xác hơn); Tyk "AI agent orchestration enterprise guide" 2026; Okteto "Run AI Agents at Scale"
> **Coupling:** 🟡 — thêm lớp điều phối/vận hành nhiều instance
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (supervisor + watchdog + registry sẵn; thiếu fleet layer)
> **Effort:** 2-4 tuần

## Nguồn gốc

Agent fleet: **vận hành nhiều agent instance như hạm đội — deploy, monitor, scale** — Fast.io: "Deploy, monitor, and scale AI agent fleets... six operational pillars and architectural patterns for managing hundreds of autonomous agents"; Zylos 2026: "Multi-agent architectures have demonstrated 45% faster problem resolution and 60% more accurate outcomes than single-agent"; Tyk: "coordinate, govern, and scale autonomous AI agents — including MCP and A2A"; Reddit: "like microservices architecture — each agent is a service". Điểm khác **GG supervisor** (1 parent giám sát vài child — hệ phân cấp) và **BBBBBB watchdog** (giám sát sức khỏe) — OOOOOO *quy mô hàng trăm*: provisioning, version fleet (đồng bộ config cả hạm đội — FFFFFF), scale theo tải, canary deploy từng nhóm, monitor tổng (YYYY), budget fleet (XXXXX), thu hồi agent chết. Nối GG (phân cấp trong hạm đội), BBBBBB (watchdog mỗi agent), FFFFFF (version đồng bộ), XXXXX (budget), YYYY (dashboard fleet).

## Mô tả

mya fleet: (1) **provision** — khởi tạo agent instance theo template (config, tools, memory) — Okteto: "dedicated environment per agent"; (2) **scale** — scale theo tải (event-driven — serverless ZZ; nhiều task → thêm instance); (3) **fleet versioning** — config/prompt mới phổ toàn fleet theo wave (canary: 10% → 50% → 100% — FFFFFF + ZZZZZ shadow); (4) **health tổng** — dashboard fleet: agent nào khỏe, đang làm gì, cost (YYYY + XXXXX); (5) **govern** — policy áp cả hạm đội (WW — 1 lần cho tất cả), audit từng agent (VV); (6) **thu hồi/điều chuyển** — agent ít việc → scale-to-zero (ZZ), agent hỏng → restart/rollback (BBBBBB + FFFFFF); (7) **phân hạm đội** — nhóm agent theo vai trò (nhóm theo task/phe/tenant — LLLLLL) — vận hành theo nhóm.

## Kiến trúc

```
  FLEET LAYER: provision · scale · version · budget · monitor (hàng trăm agents)
        │
  ┌─────┼──────────────┬─────────────────┐
  ▼     ▼              ▼                 ▼
 AGENT AGENT ...    NHÓM (vai trò)    POOL (scale-to-zero ZZ)
  │     │            canary version    tải cao → thêm
  ▼     ▼            (FFFF+ZZZZZ)      tải thấp → thu hồi
 WATCHDOG (BBBBBB) — sức khỏe mỗi agent → restart/rollback
        │
  ┌─────┴──────────────┐
  ▼                    ▼
 DASHBOARD FLEET      GOVERN
 (YYYY + XXXXX)       (WW 1 lần cho cả hạm đội · VV audit)
```

```
mya: GG + BBBBBB + registry SẸN — thiếu: fleet layer (provision/scale/version-batch)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ GG supervisor — phân cấp (nền hạm đội)
// ✅ BBBBBB watchdog — sức khỏe từng agent
// ✅ FFFFFF versioning — version config (canary wave)
// ✅ XXXXX finops — budget tổng (fleet)
// ✅ YYYY observability — dashboard (fleet view)
// ✅ WW policy — áp cho cả hạm đội

// ❌ THIẾU: fleet provisioner (instance từ template)
// ❌ THIẾU: auto-scale (event-driven)
// ❌ THIẾU: canary wave cho cả fleet (FFFF x ZZZZZ)
// ❌ THIẾU: thu hồi/scale-to-zero (ZZ)
```

## Implementation

```typescript
// packages/fleet/src/fleet.ts (NEW)
export class Fleet {
  async deploy(template: AgentTemplate, count: number): Promise<AgentId[]> {
    return Promise.all(
      range(count).map(() => this.provision(template)), // Okteto: env riêng/agent
    );
  }
  async rollout(cfg: Version, strategy: Canary) {   // canary 10→50→100%
    for (const wave of strategy.waves) {
      await this.applyWave(cfg, wave);              // FFFF + ZZZZZ shadow check
      await this.healthCheck(wave);                 // BBBBBB — xấu → rollback
    }
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Xử lý song song khối lượng lớn (45% nhanh — Zylos) | ❌ Vận hành phức tạp — cần fleet layer riêng |
| ✅ Deploy config 1 lần cho cả hạm đội (canary) | ❐ Cost tổng lớn (XXXXX bắt buộc) |
| ✅ Scale theo tải — rẻ khi ít việc (ZZ) | ❌ Debug trong fleet khó (cần TTD GGGGGG + YYYY) |
| ✅ Xây trên GG + BBBBBB + FFFFFF | ❌ 1 máy 1 người — không cần hạm đội |

## Khác các hướng gần

| | GG Supervisor | BBBBBB Watchdog | OOOOOO: Fleet |
|---|---|---|---|
| Quy mô | Vài child | 1 agent | **Hàng trăm agents** |
| Mục đích | Phân cấp crash-isolation | Sức khỏe | **Provision/scale/version batching** |
| Quan hệ | Thành phần | Thành phần | **Bao trùm + thêm fleet layer** |

## Khi nào chọn

- Nhiều task độc lập cùng lúc — cần nhiều agent chạy song song
- Nhiều người dùng/tenant (LLLLLL) — mỗi tenant nhóm agent riêng
- Đã có GG + BBBBBB + FFFFFF + XXXXX — thêm fleet layer
- Cần canary deploy config toàn hệ thống