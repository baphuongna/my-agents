# Hướng UUUUUUU: Agent Registry & Discovery — "phone book" cho agent: đăng ký, tìm, chọn

> **Nguồn gốc:** TrueFoundry "What is AI Agent Registry" (centralized catalog of autonomous agents and capabilities — "phone book for AI agents"); Google Cloud "Agent Registry concepts" (discovery — consumption-centric capabilities, orchestrators discover registered agents); AWS Bedrock Agent Registry (fully managed — organize, curate, discover resources); Spring "Service Registration and Discovery" (Eureka — self-registration pattern)
> **Coupling:** 🟡 — mọi agent/tool phải đăng ký + tra cứu qua registry
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (NNN tool registry + registry sẵn; thiếu discovery + lifecycle)
> **Effort:** 1-2 tuần

## Nguồn gốc

Agent registry: **một nơi đăng ký agent/năng lực — agent khác tìm theo nhu cầu, không hardcode** — TrueFoundry: "centralized catalog of autonomous agents and their capabilities — a 'phone book' for AI agents"; Google Agent Registry: "Discovery focuses on consumption-centric capabilities that your AI orchestrators can use — you discover already-registered agents"; AWS: "fully managed discovery service — centralized catalog for organizing, curating, discovering resources"; Spring/Eureka: "services automatically registering themselves with a registry when they start up" (self-registration pattern). Điểm khác **NNN tool registry** (đăng ký tool — đã có) — UUUUUUU *mở rộng cho agent + discovery*: (1) register — agent/tool tự đăng ký khi start (Eureka self-registration): metadata (năng lực, model, cost, SLO, version — TrueFoundry capabilities); (2) discover — agent cần năng lực X → query registry (Google: consumption-centric — theo cái orchestrator cần) → danh sách phù hợp; (3) select — chọn agent theo ràng buộc (cost/độ chính xác/latency — GGG routing + LLLLLLL budget); (4) lifecycle — heartbeat + deregister khi chết (Eureka), version (FFFF), health (YYY); (5) curate — phân loại, đánh giá chất lượng (BBBBBBB scorecard — curated list); (6) marketplace — registry làm nền cho chợ kỹ năng (MMMMMM skill marketplace ngoài).

## Kiến trúc

```
  AGENT/TOOL ──► REGISTRY (TrueFoundry "phone book")
   · self-register khi start (Eureka) · metadata: năng lực/model/cost/version
   · heartbeat + deregister khi chết (lifecycle)
        │
        ▼
  DISCOVER (Google — consumption-centric): "cần năng lực X" ──► query
   · trả danh sách agent phù hợp (không hardcode tên)
        │
        ▼
  SELECT (theo ràng buộc): cost (LLLLLLL) · latency · độ chính xác (GGG)
   · curated/score (BBBBBBB) · version (FFFF)
        │
        ▼
  WATCH: health (YYY) · SLO (SSSSSSS) · deregister
```

```
mya: NNN tool registry SẴN — thiếu: agent discovery + lifecycle + select
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ NNN tool registry — đăng ký tool (nền — mở rộng cho agent)
// ✅ GGG routing — chọn theo nhu cầu (select)
// ✅ FFFFFF versioning — version agent/tool
// ✅ YYY health/observability — theo dõi
// ✅ BBBBBBB scorecard — đánh giá/curate
// ✅ MMMMMM marketplace — nền chợ (tương lai)

// ❌ THIẾU: discovery (query theo năng lực — Google)
// ❌ THIẾU: lifecycle (heartbeat + deregister — Eureka)
// ❌ THIẾU: self-registration (agent tự đăng ký khi start)
```

## Implementation

```typescript
// packages/registry/src/discovery.ts (NEW)
export class AgentRegistry {
  async register(a: Agent): Promise<void> {   // Eureka self-registration
    store.set(a.id, { caps: a.capabilities, model: a.model,
      cost: a.cost(), health: "up", version: a.version });
  }
  async discover(need: Capability, ctx: Query): Promise<Agent[]> {
    return store.find(need)                    // Google: consumption-centric
      .filter(a => fits(ctx, a))               // cost/latency/score (GGG+BBBBBBB)
      .filter(a => a.health === "up");         // heartbeat (Eureka)
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không hardcode agent — thêm/bớt agent không đổi code (Google) | ❌ Mọi thứ phải qua registry — thêm 1 hop |
| ✅ Chọn đúng năng lực — theo nhu cầu orchestration | ❐ Metadata sai (năng lực khai báo sai) → chọn nhầm |
| ✅ Lifecycle rõ — chết là biết (heartbeat) | ❌ Registry chết = cả hệ mù (cần HA — SSSSSSS) |
| ✅ Xây trên NNN + GGG + YYY | ❌ Curate cần đánh giá liên tục (BBBBBBB) |

## Khác các hướng gần

| | NNN Tool Registry | MMMMMM Marketplace | UUUUUUU: Agent Registry |
|---|---|---|---|
| Đối tượng | Tool | Kỹ năng bán | **Agent + năng lực + lifecycle** |
| Chức năng | Lưu tool | Trao đổi | **Đăng ký + tìm + chọn** |
| Quan hệ | Nền | Ứng dụng của registry | **Phone book + discovery** |

## Khi nào chọn

- Nhiều agent/tool — gọi nhau cần "phone book" (TrueFoundry)
- Agent tự đăng ký/deregister động (multi-tenant — mở rộng)
- Orchestration muốn chọn agent theo năng lực + cost (Google)
- Đã có NNN + GGG + YYY — thêm discovery + lifecycle