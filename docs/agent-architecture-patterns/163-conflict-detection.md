# Hướng HHHHHHH: Conflict Detection & Overlap Prevention — tránh agent làm trùng việc

> **Nguồn gốc:** Sharon et al. "Conflict-Based Search (CBS)" (Artif. Intell. 2015, 2148 cites); tacnode "8 Coordination Patterns" (duplicate orders/race conditions); Galileo "10 Multi-Agent Coordination Strategies" (outdated context → duplicated work); NMS "Duplication of Work"
> **Coupling:** 🟡 — các agent phải báo kế hoạch qua coordinator
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (planner + consensus + stigmergy sẵn; thiếu conflict check layer)
> **Effort:** 2-4 tuần

## Nguồn gốc

Conflict detection: **phát hiện + ngăn agent làm trùng/đụng nhau trước khi xảy ra** — CBS (Sharon 2015, 2148 cites): "Conflict-Based Search — optimal multi-agent pathfinding" — phát hiện xung đột rồi ràng buộc từng agent, chia bài toán con (nền thuật toán chuẩn cho đụng độ); tacnode: "When AI agents conflict, you get duplicate orders, race conditions, and angry customers"; Galileo: "Poor information flow causes agents to act on outdated or incomplete context, creating misalignment and duplicated work"; NMS: "the same activity is carried out more than once when one instance would have been enough". Điểm khác **HH stigmergy** (phối hợp gián tiếp — bài đăng "đang làm gì" + agent tự tránh) và **EEEEEE consensus** (quyết định chung) — HHHHHHH *chủ động detect*: agent báo intent/claim (đăng ký việc mình sẽ làm — LL claim), coordinator so các claim (trùng chủ đề/đối tượng/thời gian → xung đột), giải quyết theo CBS-style (thứ tự ưu tiên, điều chỉnh kế hoạch từng agent), theo dõi race (2 agent sửa cùng tài nguyên — lock MMMM). Nối LL (nền báo cáo), EEEEEE (có conflict → quyết nhóm), MMMM (lock — race), WWWWWW (intent — biết agent định làm gì), GGGGGG (TTD — replay khi có conflict), 145 (fleet — giám sát nhiều agent).

## Mô tả

mya conflict detection: (1) **claim layer** — agent khi nhận task báo "tôi sẽ làm X (scope/đối tượng/nguồn)" (LL stigmergy — claim board); (2) **detect** — coordinator so các claim + công việc đang chạy: trùng đối tượng (2 agent ghi cùng file — MMMM lock thấy), trùng mục tiêu (2 agent cùng làm 1 task — intent WWWWWW), đụng nguồn (cùng resource — CBS); (3) **resolve** — CBS-style: agent ưu tiên giữ, agent kia đổi kế hoạch/hoãn/chuyển task (plan revision — tacnode); (4) **race watch** — theo dõi truy cập tài nguyên (MMMM lock — phát hiện race condition), cảnh báo sớm; (5) **undo** — nếu đã đụng: GGGGGG rewind về trước, replay theo kế hoạch sửa; (6) **metric** — đếm conflict (YYYY: 0 trùng việc = mục tiêu).

## Kiến trúc

```
  AGENT A nhận task ──► CLAIM (LL board): "tôi làm X" (scope/đối tượng/nguồn)
  AGENT B nhận task ──► CLAIM: "tôi làm Y"
        │
        ▼
  DETECT (coordinator): so claim + công việc chạy
   · trùng đối tượng (MMM lock thấy) · trùng mục tiêu (WWWWWW intent)
   · đụng nguồn (CBS — Sharon 2015)
        │
        ▼
  RESOLVE (CBS-style): ưu tiên giữ · agent kia đổi/hoãn/chuyển task
        │
        ▼
  RACE WATCH (MMMM) ──► đã đụng? GGGGGG rewind + replay kế hoạch sửa
        │
        ▼
  METRIC: YYYY — conflicts/duplicate tasks → giảm dần
```

```
mya: LL claim + MMMM lock + EEEEEE SẸN — thiếu: conflict detection layer
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ LL stigmergy — agent báo "đang làm gì" (nền claim board)
// ✅ MMMM lock — race condition watch (đụng tài nguyên)
// ✅ WWWWWW intent — biết agent định làm gì
// ✅ EEEEEE consensus — quyết nhóm khi conflict
// ✅ GGGGGG TTD — rewind khi đụng đã xảy ra
// ✅ YYYY observability — đếm conflict

// ❌ THIẾU: claim + conflict detection (chủ động so trước)
// ❌ THIẾU: CBS-style resolve (đổi kế hoạch từng agent)
// ❌ THIẾU: duplicate-task monitor (NMS — 1 việc 1 lần)
```

## Implementation

```typescript
// packages/conflict/src/detect.ts (NEW)
export class ConflictDetector {
  async claim(task: Task): Promise<Claim> {
    return board.post({ task, scope: task.scope() });   // LL — đăng ký việc
  }
  async detect(claims: Claim[]): Conflict[] {
    return cbs(claims);  // Sharon: so scope/đối tượng/nguồn — trùng → conflict
  }
  async resolve(c: Conflict): Promise<Plan> {
    const keep = priority(c.a, c.b);                     // ưu tiên giữ
    return plan.revise(keep.loses(c));                   // agent kia đổi kế hoạch
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Không còn trùng việc/đụng đối tượng (tacnode — duplicate orders) | ❌ Claim là chi phí — agent phải báo trước |
| ✅ Phát hiện sớm trước khi đụng (CBS — optimal) | ❐ Agent tự chủ không khai claim → detection mù |
| ✅ Tránh race condition (MMMM kết hợp) | ❌ Resolve phức tạp — nhiều agent nhiều conflict |
| ✅ Xây trên LL + MMMM + WWWWWW | ❌ Nhiều nguồn trùng do intent đánh giá sai |

## Khác các hướng gần

| | LL Stigmergy | MMMM Lock | HHHHHHH: Conflict Detect |
|---|---|---|---|
| Cách | Báo gián tiếp | Khóa tài nguyên | **So claim chủ động (CBS)** |
| Thời điểm | Khi làm | Khi truy cập | **Trước khi làm** |
| Quan hệ | Nguồn dữ liệu | Race watch | **Lớp detect + resolve trên cả 2** |

## Khi nào chọn

- Nhiều agent chạy song song trên cùng dữ liệu/nguồn
- Trùng việc gây hậu quả (đơn trùng, ghi đè, race — tacnode)
- Đã có LL + MMMM + WWWWWW — thêm detect + resolve
- Workload tự do — agent tự chọn việc, cần chặn 2 agent 1 việc