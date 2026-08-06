# Hướng AAA: Gossip / Epidemic Protocol — phối hợp phân tán peer-to-peer

> **Nguồn gốc:** Gossip protocols (Demers et al., 1987); "Revisiting Gossip Protocols for Emergent Coordination in Agentic MAS" (arXiv:2508.01531)
> **Coupling:** 🟢 — không điểm trung tâm, chỉ truyền lân cận
> **Agent-agnostic:** ✅ — agent chỉ biết truyền/nhận message
> **Code sẵn:** ⚠️ (1 phần — packages/intercom làm substrate; thiếu anti-entropy)
> **Effort:** 2 tuần

## Nguồn gốc

Gossip protocol (Demers 1987, gốc từ distributed databases): mỗi node định kỳ chọn 1 vài node **lân cận ngẫu nhiên** để trao đổi state — thông tin lan tỏa theo cấp số nhân, chống chịu node chết, không cần center. arXiv:2508.01531 (2025) hồi sinh cho agentic systems: khi các agent vượt quá role cố định + toolchain tĩnh, gossip cho **emergent, decentralized coordination** và collective cognition. Khác message broker (L — hub tập trung) và stigmergy (T — qua artifact tĩnh): gossip truyền *trực tiếp lân cận + hội tụ state qua anti-entropy*.

## Mô tả

Mỗi agent mya giữ 1 view con của state chung (task đang chạy, quyết định đã chốt, "ai đang làm gì"). Định kỳ (tick), agent chọn K lân cận random, trao đổi "tin mới nhất" → cập nhật view. **Anti-entropy**: 2 node gặp nhau so sánh state, node cũ hơn được bổ sung → cả hệ hội tụ về cùng sự thật mà không cần DB trung tâm. Dùng khi agents trên máy/tiến trình khác nhau không nối thẳng DB, hoặc muốn 1 lớp phát hiện tin thay thế file-watcher polling.

## Kiến trúc

```
┌────────────────────────────────────────────────────────────┐
│            GOSSIP NETWORK (mya)                            │
│                                                            │
│        ┌─────────┐          ┌─────────┐                    │
│        │ agent A │◄────────►│ agent B │                    │
│        │  view_A │ gossip   │  view_B │                    │
│        └────┬────┘          └────┬────┘                    │
│             │  anti-entropy      │                         │
│             ▼   (so sánh + bù)   ▼                         │
│        ┌─────────┐          ┌─────────┐                    │
│        │ agent C │◄────────►│ agent D │                    │
│        │  view_C │          │  view_D │                    │
│        └─────────┘          └─────────┘                    │
│                                                            │
│  mỗi tick: chọn K lân cận random → đổi "tin mới nh"         │
│  anti-entropy: node lsôn hội tụ về state mới nhất           │
│  chịu chết node: không center → mất node không mất hệ       │
└────────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/intercom/src/intercom.ts — agent↔agent messaging (reply/broadcast)
// ✅ packages/channels — kênh push/retry (base-adapter)
// ✅ packages/rpc — kênh giữa tiến trình (substrate cho peer exchange)
// ✅ packages/tools/src/kanban-sqlite.ts — KV lưu orientation set

// ❌ THIẾU: vòng gossip tick + anti-entropy reconciliation.
//    Intercom hiện point-to-point — chưa có random-neighbor + version compare.
```

## Implementation

```typescript
// packages/intercom/src/gossip.ts (NEW)
interface GossipMessage {
  id: string;          // content-addressed (W): hash nội dung
  version: number;     // Lamport clock
  payload: unknown;    // "taskX stage=code" | "decision=use-napi"
}

class GossipNode {
  private known = new Map<string, GossipMessage>();   // view cục bộ
  private reSentPendings = new Map<string, unknown>();

  constructor(private tickMs = 30_000, private fanout = 3) {}

  async run(peers: Peer[]): Promise<void> {
    // bcast lũy tiến: event mới → fanout random K lân cận
    for (const p of this.pickRandom(peers, this.fanout)) {
      await this.exchange(p);   // gửi tin chưa thấy + nhận tin lạ
    }
    setTimeout(() => this.run(peers), this.tickMs);
  }

  private async exchange(peer: Peer): Promise<void> {
    const mine = this.recent(this.known, 50);
    const theirs = await peer.reconcile(mine);      // anti-entropy
    for (const msg of theirs) {
      if (!this.known.has(msg.id) || msg.version > this.known.get(msg.id)!.version) {
        this.known.set(msg.id, msg);
        this.apply(msg);                            // cập nhật view
      }
    }
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không center — chết node không sập cả hệ | ❌ Sự thật *cuối cùng* hội tụ, không real-time |
| ✅ Tin lan tỏa cấp số nhân (nhanh) | ❌ Đảo ngược tin / conflict cần version (Lamport) |
| ✅ Chống phân mảnh thông tin nhiều node | ❌ Overhead tick × fanout |
| ✅ Kết hợp W (content-addressed) tự nhiên | ❌ Với 2-3 agents nội bộ thì hơi thừa |
| ✅ Intercom + rpc sẵn làm substrate | |

## Khi nào chọn

- Nhiều agent/lỗi cả tiến trình riêng không nối thẳng DB
- Muốn chịu lỗi node (không single point)
- Muốn lớp phát hiện thay file-watcher polling
- < 4 agents nội bộ thì cân nhắc lại (overhead > lợi)