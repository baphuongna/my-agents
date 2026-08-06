# Hướng GT: Multi-Agent Communication — message passing, event-driven, blackboard, pub-sub

> **Nguồn gốc:** Confluent "Four Design Patterns for Event-Driven, Multi-Agent Systems" (orchestrator-worker, hierarchical agent, blackboard, market-based — trên nền Kafka); zylos.ai "Event-Driven Architecture for AI Agent Systems" (pub/sub là pattern giao tiếp chủ đạo — AutoGen v0.4 actor model, event sourcing, "point-to-point REST does not scale under LLM latency variance"); Particula "AI Agent Communication Patterns" (orchestrator, pub-sub, blackboard, direct request-response); Tetrate "Multi-Agent Systems: Design Patterns and Orchestration" (message-based communication — metadata sender/receiver/timestamp; pub-sub broadcast)
> **Coupling:** 🟡 — chạm mọi agent (giao thức chung)
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (module liên agent + message bus nội bộ; chưa chuẩn hóa giao thức)
> **Effort:** 3-6 tuần

## Nguồn gốc

Communication: **cách các agent trao đổi thông tin — từ gọi trực tiếp đến event bus — quyết định coupling, khả năng mở rộng, debug** — Particula: 4 pattern chính: (1) *orchestrator* — điều phối trung tâm, dễ debug nhưng một điểm nghẽn; (2) *pub-sub* — event-driven, publisher không biết subscriber ("adding a new agent requires zero changes to existing"), cần broker (Kafka/RabbitMQ/Redis Streams) + schema versioning + correlation ID để debug; (3) *blackboard* — shared workspace, agent đọc/ghi theo trạng thái — hợp iterative refinement, dễ race condition, khó xác định "done"; (4) *direct* — chỉ hợp 2-3 agent, tăng lên thì quá coupling. Confluent: biến 4 pattern cổ điển thành event-driven trên Kafka — orchestrator qua partitions/consumer groups, hierarchical đệ quy từng subtree, blackboard thành topic, market-based qua bid/ask. zylos EDA: event sourcing (AgentDecision, ToolCalled, ResultEmitted thành immutable events), catch-up processing, hybrid — sync ở biên, event nội bộ. Tetrate: message-based giảm coupling — agent chỉ hiểu format message, metadata sender/receiver/type/timestamp.

## Kiến trúc

```
   EVENT BUS (Kafka/Redis Streams) ── chủ lỗ giao tiếp (zylos: REST không mở rộng)
        │  topics: tasks / results / decisions / errors
        │
  ┌─────┴──────┬──────────┬───────────┐
  ORCHESTRATOR  WORKER     SPECIALIST   MONITOR (subscribe hết — thu log)
  (key partition) (event-source) (blackboard reader)
        │
  └──► AUDIT LOG (187) · correlation ID (debug pub-sub) · schema registry
```

```
mya: giao tiếp liên agent nội bộ — thống nhất giao thức, thêm event sourcing
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 24 tuple-space — shared state giữa nhiều agent (gần blackboard)
// ✅ 141 multi-tenant — cô lập agent, không tranh chấp bus
// ✅ 172 multi-agent config — cấu hình các agent giao nhau
// ✅ 186 ensemble — phối hợp nhiều agent (dạng cùng shared)

// ❌ THIẾU: event bus chuẩn hoá (Kafka — replay, catch-up, ordering)
// ❌ THIẾU: correlation ID xuyên agent (debug pub-sub — zylos)
// ❌ THIẾU: schema registry cho message (subscriber không vỡ khi đổi format)
// ❌ THIẾU: cơ chế nhận biết "done" ở blackboard (tránh loop không dừng)
```

## Implementation

```typescript
// packages/comm/src/bus.ts (NEW)
export class AgentBus {
  async publish(event: AgentEvent): Promise<void> {
    await defineSchema(event.type, event.uid);   // schema versioned (zylos)
    await kafka.produce({ topic: event.type, value: event, key: event.id }); // partition
  }
  async publishResponse(from: string, to: string): Promise<void> {
    // orchestrator: topic per key phân phối; worker đọc theo partition
  }
}
export class Correlation {
  // header chạy qua mọi event — theo dấu chuỗi pub-sub lạc
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent độc lập hoàn toàn — mở rộng không sửa agent cũ | ❌ Debug khó — cần correlation ID + log tập trung |
| ✅ Hợp pipeline luồng (ingest→classify→summarize) | ❌ Consistent cuối — downstream đọc event trước khi nguồn xong |
| ✅ Xử lý được LLM latency biến động (async) | ❌ Ordering cần cấu trúc thủ công — bus không đảm bảo |
| ✅ Xây trên 24/141/172/186 | ❌ Đơn giản mà pub-sub → đánh đổi không cần thiết |

## Khác các hướng gần

| | 24 Tuple-space | 172 Team-config | UUUUUUUU: Communication |
|---|---|---|---|
| Mục | Chia sẻ bộ tuple | Nối agent theo cấu hình | **Chuẩn hóa cách trao đổi — event/blackboard** |
| Hướng | Bộ nhớ chung | Định nghĩa | **Chuyển hóa dữ liệu** |
| Quan hệ | Nền | Nền | **Bao bọc cả hai — quyết định scaling + debug** |

## Khi nào chọn

- Nhiều agent chạy pipeline luôn (media, monitoring) — thêm agent không sửa cũ
- Đã có orchestrator nhưng số agent tăng nhanh
- Chat/blackboard hợp cho iterative như code review
- Trên 3-4 agent, REST trực tiếp bắt đầu nghẹn (zylos: latency variance)