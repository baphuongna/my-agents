# Hướng BBBBBB: Agent Watchdog — giám sát sức khỏe agent liên tục, can thiệp khi lệch

> **Nguồn gốc:** Datadog Watchdog AI; os.moda "Run AI Agent 24/7 — Supervision & Recovery" 2026; Zylos "Process Supervision & Health Monitoring for Long-Running AI Agents" 2026; UptimeRobot Agent Monitoring 2026
> **Coupling:** 🟢 — lớp ngoài quan sát, runtime không đổi
> **Agent-agnostic:** ✅ (giám sát từ ngoài — shell/MCP/D-Bus)
> **Code sẵn:** ⚠️ (heartbeat/healthcheck ECS sẵn + audit VV; thiếu watchdog loop + recovery)
> **Effort:** 1-2 tuần

## Nguồn gốc

Watchdog: **proactively uncovers and alerts performance issues** (Datadog) — nhiệm vụ là "thấy cái bạn không nghĩ tới" (Deep Reasoning + Monitoring); os.moda 2026: "a watchdog goes deeper: actively checks whether the agent is functioning correctly by sending health-check requests and validating responses"; Zylos 2026: PM2/systemd watchdogs, container health checks — giám sát process sống sót trong production; UptimeRobot: "catch silent failures early". Điểm khác **GGG gateway** (route request) và **VV audit** (ghi lại sự kiện) — BBBBBB *chủ động kiểm tra*: định kỳ gửi probe/health-check cho agent, validate response (trả lời đúng dạng không, kẹt không, cost quá cao không), lệch → can thiệp (restart/rollback/escalate). Không chỉ alert — còn *recovery*. Nối ECS (healthcheck/restart policy), VV (audit sự kiện), YYYY (metric sức khỏe), QQ (circuit breaker).

## Mô tả

mya watchdog loop: (1) **probe** — định kỳ (mỗi N giây) gửi health-check (ping, task-test ngắn, sample MCP call); (2) **validate** — response có hợp lệ không: latency, kết quả đúng dạng, không hang (timeout), không vòng lặp (retry lặp — $), token dùng quá mức (XXXXX); (3) **phân loại** — OK / degrading / dead / stuck (kẹt await event — TT); (4) **can thiệp** theo mức — restart process (ECS restart policy), rollback config (ZZZZ shadow keep last-good), thông báo/người lên (UU escalation tree), cô lập agent (QQ breaker); (5) **giảm nhiễu** — cảnh báo chỉ khi lệch *liên tục* (tự đánh norm, tránh false alert); (6) **mọi agent agnostic** — hoạt động từ ngoài qua shell/MCP, không cần sửa agent.

## Kiến trúc

```
  PROBE (mỗi Ns: ping · task-test · sample MCP call)
        │
        ▼
  VALIDATE — latency · dạng kết quả · hang · vòng lặp · cost (XXXXX)
        │
    OK ────► (tiếp tục)
  DEGRADE ──► throttle (RR) + alert (UU escalate)
  STUCK ────► can thiệp: restart / rollback (ZZZZ last-good) / cô lập (QQ)
  DEAD ─────► restart (ECS policy) + alert
        │
        ▼
  AUDIT VV — mọi probe/action ghi log (bằng chứng)
```

```
mya: ECS healthcheck + VV audit SẸN — thiếu: watchdog probe loop + recovery actions
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ ECS — healthcheck/restart policy (nền tảng restart)
// ✅ VV audit — ghi sự kiện (bằng chứng probe/action)
// ✅ YYYY agent-observability — metric (nguồn validate)
// ✅ QQ circuit breaker — cô lập agent lỗi (can thiệp)

// ❌ THIẾU: watchdog loop (probe định kỳ + validate)
// ❌ THIẾU: recovery actions (trừ restart — ECS)
// ❌ THIẾU: bộ phát hiện kẹt (awaited event — TT)
// ❌ THIẾU: giảm nhiễu (threshold theo norm tự học)
```

## Implementation

```typescript
// packages/ops/src/watchdog.ts (NEW)
export class Watchdog {
  constructor(private agents: AgentRegistry) {}

  async tick(): Promise<void> {
    for (const a of this.agents.all()) {
      const p = await this.probe(a);            // ping + task-test ngắn
      const s = this.classify(p);               // OK|DEGRADE|STUCK|DEAD
      if (s !== "OK") await this.act(a, s);     // restart/rollback/isolate
      audit.log("watchdog", { agent: a.id, s, p }); // VV — bằng chứng
    }
  }

  private classify(p: Probe) {
    if (p.timeout || p.loopDetected) return "STUCK";   // kẹt await TT
    if (p.latency > this.norm.latency * 3 || p.cost.pct > 0.9) return "DEGRADE";
    if (p.unresponsive > 3) return "DEAD";
    return "OK";
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Bắt lỗi im lặng (agent xấu nhưng không crash) | ❌ Probe tốn chi phí/tài nguyên định kỳ |
| ✅ Tự can thiệp (restart/rollback) — không cần người | ❐ Nguy cơ false alert / hành động sai |
| ✅ Agent-agnostic (từ ngoài — shell/MCP) | ❌ Kẹt await-sự kiện khó phát hiện (TT) |
| ✅ Nhẹ, nối ngay ECS + VV | ❌ Không bắt lỗi logic (chỉ bắt lỗi vận hành) |

## Khác các hướng gần

| | QQ Breaker | GGG Gateway | BBBBBB: Watchdog |
|---|---|---|---|
| Thời điểm | Lúc request | Lúc request | **Liên tục (probe)** |
| Hành động | Chặn luồng | Route/retry | **Probe + can thiệp (restart/rollback)** |
| Phạm vi | 1 provider | Luồng vào | **Toàn bộ agent** |

## Khi nào chọn

- Agent chạy 24/7 — cần bắt hỏng im lặng sớm
- Muốn tự phục hồi (restart/rollback) không cần người canh
- Đã có ECS + VV + YYYY — thêm probe loop + recovery
- Agent nhiều/da dạng — giám sát tập trung từ ngoài