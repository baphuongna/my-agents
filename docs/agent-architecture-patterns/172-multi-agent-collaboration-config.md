# Hướng FP: Multi-Agent Collaboration Config — team agent có cấu hình phối hợp khai báo

> **Nguồn gốc:** AWS Bedrock "Multi-Agent Collaboration" (supervisor agent + collaboration agents — plan & solve complex tasks); IBM "What is Multi-Agent Collaboration?" (cooperate via established communication protocols — exchange state, assign responsibilities); Oracle ADK (supervisor invokes collaborator's run as tool); Vertex AI "Agent Engine" (managed runtime — built-in testing, release)
> **Coupling:** 🟡 — runtime phải hỗ trợ supervisor/subagent theo khai báo
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (subagent orchestration + agent registry sẵn; thiếu team profile)
> **Effort:** 1-3 tuần

## Nguồn gốc

Multi-agent config: **định nghĩa team agent bằng cấu hình — ai là supervisor, ai là collaborator, giao tiếp thế nào** — AWS Bedrock: "Multi-agent collaboration enables multiple agents to collaboratively plan and solve complex tasks — configure and customize queries and responses"; IBM: "agents cooperate by using established communication protocols to exchange state information, assign responsibilities and delegate"; Oracle ADK: "supervisor agent can invoke collaborator agent's run method as tool — receives run response"; Vertex: "Agent Engine — fully managed runtime, deploy custom agents with built-in testing, release". Điểm khác **B orchestration** (điều phối động do LLM) và **144 fleet** (quản lý nhiều agent vận hành) — QQQQQQQ *khai báo cấu trúc team*: (1) team profile — file config: supervisor (chủ trì, chia việc), collaborators (chuyên gia — đúng miền), relationship (ai gọi ai — IBM exchange/assign); (2) giao tiếp chuẩn — supervisor → collaborator = gọi như tool (Oracle run-as-tool — ngữ nghĩa rõ, kết quả có cấu trúc); (3) kết quả — collaborator trả run response (state — IBM), supervisor tổng hợp; (4) test/release — team profile có version (FFFF), test mỗi cấu hình (Vertex Agent Engine testing + PP); (5) so cấu hình — team A vs team B cùng task (AAAAAA arena) — chọn cấu hình tốt; (6) chuyển đổi — độ khó task tăng → thêm collaborator (PPPPPPP curriculum team).

## Kiến trúc

```
  TEAM PROFILE (khai báo — YAML/TS): supervisor + collaborators + relations
        │
        ▼
  SUPERVISOR (AWS Bedrock): chia task · plan · tổng hợp kết quả
        │  gọi collaborator NHƯ TOOL (Oracle: run() as tool)
        ▼
  COLLABORATOR (chuyên gia miền): nhận subtask → run response có state
        │  trao đổi state + trách nhiệm (IBM protocols)
        ▼
  TEST/RELEASE: version profile (FFFF) · test per config (Vertex Agent Engine)
   · so team A vs B trên cùng task (AAAAAA — arena)
   · task khó hơn → thêm collaborator (PPPPPPP curriculum)
```

```
mya: subagent orchestration + registry SẴN — thiếu: team profile + run-as-tool
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ subagent orchestration — supervisor/subagent (nền)
// ✅ NNN agent registry — đăng ký agent (nguồn team)
// ✅ FFFFFF versioning — version profile
// ✅ PP eval — test per config
// ✅ AAAAAA arena — so cấu hình team
// ✅ WWWWWW intent — supervisor hiểu yêu cầu chia việc

// ❌ THIẾU: team profile (cấu hình khai báo — ai gọi ai)
// ❌ THIẾU: collaborator run-as-tool contract (Oracle ADK)
// ❌ THIẾU: run response state structure (IBM state exchange)
```

## Implementation

```typescript
// packages/teams/src/profile.ts (NEW)
export const team = defineTeam({
  supervisor: "planning-agent",
  collaborators: ["research-agent", "write-agent", "review-agent"], // Bedrock
  relations: [["supervisor", "calls-as-tool", "research-agent"]],   // Oracle ADK
});
export class TeamRunner {
  async run(task: Task): Promise<Out> {
    const subtasks = await supervisor.plan(task);       // chia việc
    const results = await Promise.all(subtasks.map(t =>
      collaborator.runAsTool(t)));                       // run() như tool (ADK)
    return supervisor.synthesize(results);               // tổng hợp + state
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Cấu hình rõ — team nào, ai gọi ai, test được (Vertex) | ❌ Kém linh hoạt — team khai báo cố định vs agent tự do |
| ✅ Giao tiếp chuẩn — collaborator như tool, kết quả có cấu trúc (ADK) | ❐ Config team nhiều → chi phí duy trì |
| ✅ A/B được — so team cấu hình này vs kia (arena) | ❌ Supervisor có thể chia sai subtask |
| ✅ Xây trên subagent + registry + FFFF | ❌ Overhead — agent đơn giản không cần team |

## Khác các hướng gần

| | B Orchestration | 144 Fleet | QQQQQQQ: Team Config |
|---|---|---|---|
| Cấu trúc | Động (LLM quyết) | Vận hành nhiều agent | **Khai báo trước (profile)** |
| Mục đích | Chạy task | Quản lý | **Định nghĩa team + quan hệ** |
| Quan hệ | Chạy team | Giám sát team | **Lớp cấu hình team** |

## Khi nào chọn

- Công việc lặp lại với team agent ổn định (research→write→review)
- Muốn giao tiếp giữa agent có cấu trúc rõ (run-as-tool — ADK)
- Cần so sánh/tune cấu hình team (arena + version — Vertex)
- Đã có subagent + registry + PP — thêm team profile