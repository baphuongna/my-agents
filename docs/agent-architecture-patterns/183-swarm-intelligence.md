# Hướng GA: Swarm Intelligence — đàn agent tự tổ chức, hành vi trồi dậy từ luật đơn giản

> **Nguồn gốc:** AWS "Enterprise Swarm Intelligence" (Swarm Agentic AI pattern — decentralized multi-agent, tự tổ chức qua local interactions); Serugendo "Self-Organisation and Emergence in MAS" (346 cites — software agents tự tổ chức, autonomy); Arboria Labs (tự tổ chức + emergence = nền tảng lý thuyết swarm intelligence); Khan "Emergent Intelligence in Multi-Agent and LLM Systems" (emerging behavior — coordination, self-learning)
> **Coupling:** 🟡 — agents phải tuân theo luật tương tác local
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (stigmergy LL + market sẵn; thiếu swarm rules)
> **Effort:** 3-5 tuần

## Nguồn gốc

Swarm intelligence: **nhiều agent đơn giản + luật tương tác local → hành vi thông minh tổng thể trồi dậy (emergence) — không cần điều phối trung tâm** — AWS: "Swarm Agentic AI pattern is a decentralized multi-agent architecture where autonomous AI agents collaborate through self-organization and local interactions"; Serugendo (346 cites): "software agents naturally play the role of autonomous entities subject to self-organise themselves"; Arboria: "self-organization and emergence — theoretical bedrock of swarm intelligence"; Nature s41598-025: "emergence — presentation of high-level intelligence features from multi-agent systems". Điểm khác **LL stigmergy** (phối hợp qua dấu vết — pheromone) và **EEEEEEE mechanism** (thiết kế incentive trung tâm) — BBBBBBBB *tổ chức tự phát*: (1) simple rules — mỗi agent quyết local (đơn giản — tự điều phối theo hàng xóm/trạng thái, không hỏi trung tâm); (2) decentralized — không supervisor (AWS — khác QQQQQQQ team config có supervisor); (3) emergence — hành vi nhóm (phủ sóng, phân chia công việc tự nhiên) xuất hiện không ai thiết kế; (4) pheromone/local signal — agent để dấu (LL — bài đăng "đã xử lý vùng này"); (5) resilience — chết vài agent không ảnh hưởng (redundancy tự nhiên — SSSSSSS); (6) monitor — quan sát emergence, chặn hành vi xấu hình thành (YYYY + guardrail MMMMMMM). Nối LL (nền — pheromone/local), EEEEEEE (ngược — thiết kế trung tâm vs tự phát), SSSSSSS (resilience), WWWWWW (intent local), HHHHHHH (conflict — đàn dễ đụng nhau).

## Kiến trúc

```
  ĐÀN AGENT (decentralized — AWS Swarm Agentic AI pattern)
   · MỖI AGENT: uật/ảnh quyết LOCAL (Serugendo autonomy)
   · tương tác qua local signal / pheromone (LL stigmergy)
        │
        ▼
  EMERGENCE (Nature): hành vi nhóm trồi dậy không ai thiết kế
   · phân chia công việc tự nhiên · phủ sóng · self-organizing
        │
        ├── PHÁT HIỆN: monitor emegence (YYYY) — chặn xấu (MMMMMMM)
        ├── XUNG ĐỘT: đàn dễ đụng → HHHHHHH claim/detect
        └── CHẾT agent → không ảnh hưởng (natural redundancy — SSSSSSS)
```

```
mya: LL + market SẴN — thiếu: swarm rules + emergence monitor
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ LL stigmergy — phối hợp qua dấu vết (nền swarm)
// ✅ market AA — phân phối việc (không trung tâm)
// ✅ SSSSSSS redundancy — chết agent không sao
// ✅ HHHHHHH conflict detect — đụng nhau (cần trong đàn)
// ✅ YYY + MMMMMMM — monitor + guardrail emergence
// ✅ WWWWWW intent — quyết local (nền)

// ❌ THIẾU: swarm rules (luật local thống nhất)
// ❌ THIẾU: emergence observation (Đo hành vi nhóm)
// ❌ THIẾU: fail-safes — chặn emergence xấu
```

## Implementation

```typescript
// packages/swarm/src/agent.ts (NEW)
export class SwarmAgent {
  async step(state: LocalState): Promise<Action> {
    const signal = readLocal(state);           // pheromone/stigmergy (LL)
    const action = rule(signal, state.neighbors); // luật local đơn giản (AWS)
    leaveTrace(action);                        // để lại dấu cho agent khác
    return action;                             // emergence qua nhiều step (Nature)
  }
}
// monitor trap: detectHazardousEmergence(yyy, guardrails) — MMMMMMM
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không cần supervisor — mở rộng tự nhiên (AWS decentralized) | ❌ Khó dự đoán — emergence có thể xấu |
| ✅ Resilience — chết node không sập đàn (redundancy tự nhiên) | ❐ Hành vi nhóm khó debug/giải thích |
| ✅ Đơn giản từng agent — luật local dễ | ❌ Kết quả không cam kết — quality mỗi lần khác |
| ✅ Xây trên LL + AA + SSSSSSS | ❌ Với task yêu cầu chính xác — swarm không bảo đảm |

## Khác các hướng gần

| | LL Stigmergy | QQQQQQQ Team | BBBBBBBB: Swarm |
|---|---|---|---|
| Điều phối | Qua dấu vết | Supervisor | **Tự tổ chức local** |
| Trung tâm | Không | Có | **Không (decentralized)** |
| Quan hệ | 1 cơ chế | Cấu trúc team | **Luật local + emergence** |

## Khi nào chọn

- Nhiều task nhỏ phân tán — mỗi task không cần chính xác tuyệt đối
- Cần scale lớn không có trung tâm điều phối
- Vấn đề phủ sóng/phân phối tự nhiên (many small jobs)
- Đã có LL + AA + HHHHHHH — thêm swarm rules + emergence guard