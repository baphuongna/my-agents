# Hướng JK: Speculative Task Execution — chạy trước nhánh song song có khả năng cần, bỏ kết quả thừa

> **Nguồn gốc:** Speculative execution (CPU branch prediction — chạy trước nhánh có khả năng taken); Hadoop "Speculative Execution" ("launch duplicate tasks on slow nodes — take first to finish"); Spark speculative tasks; arXiv "speculative decoding" (draft model chạy trước); 207 speculative decoding; "predictive prefetch" (browser prefetch link user có khả năng click)
> **Coupling:** 🟡 — chạm scheduler/executor
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (parallel executor chưa có — chưa có speculative branch)
> **Effort:** 2-4 tuần

## Nguồn gốc

Speculative execution (CPU branch prediction): dự đoán nhánh nào sẽ taken, chạy trước kết quả — nếu đúng thì tiết kiệm latency, sai thì bỏ + chạy lại nhánh thật. Hadoop/Spark speculative: chạy *bản sao* task trên node khác khi node chậm — lấy kết quả đầu tiên xong, bỏ còn lại ("straggler mitigation"). Predictive prefetch (browser): preload link user có khả năng click → khi click đã sẵn. Áp cho agent: khi agent gặp quyết định rẽ nhánh (vd đợi user confirm A hay B), **chạy trước cả 2 nhánh** song song — khi user quyết định, nhánh đúng đã xong/nửa xong → giảm latency cảm nhận. Khác **GY (207) speculative decoding** (draft model đề xuất *token*) — JK speculative ở mức *task/branch*; khác **GZ (208) parallel tool calls** (chạy song song các call *độc lập chắc chắn cần*) — JK chạy nhánh *có khả năng bị bỏ*; khác **DW (127) finops** (chống lãng phí) — JK *chấp nhận lãng phí có kiểm soát* để đổi latency.

## Mô tả

mya speculative execution: tại điểm rẽ nhánh (human approval 226, tool có nhiều outcome), spawn song song các nhánh *dự đoán* với xác suất. Nhánh nào khớp quyết định thật → giữ; còn lại → huỷ + report cost lãng phí. Budget kiểm soát: chỉ speculative khi predicted-value × probability > cost. mya có human-approval gate (HR) — tại đó thường đợi → đây là chỗ speculative có giá trị cao (chạy trước công việc sau cổng). Cần cancellable task (huỷ nhánh thừa).

## Kiến trúc

```
  DECISION POINT (approval gate / tool outcome)
     │   predicted: A (0.7)  B (0.3)
     ├──► SPECULATIVE A ──► (chạy trước, không commit side-effect)
     └──► SPECULATIVE B ──► (chạy trước, không commit side-effect)
            │
     ACTUAL DECISION arrives (user chọn A)
            │
     ├── A khớp ──► COMMIT A (sẵn kết quả — near-zero latency)
     └── B sai   ──► CANCEL B (bỏ — report cost lãng phí)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ HR (226) human-approval gate — điểm chờ → chỗ speculative giá trị cao
// ✅ 232 actor supervision — spawn child actor (nền)
// ✅ GU (203) retry — cancellable nền
// ✅ 199 delegation — sub-agent song song

// ❌ THIẾU: speculative spawn (chạy nhánh dự đoán không commit)
// ❌ THIẾU: expected-value gate (probability × value > cost)
// ❌ THIẾU: side-effect isolation (speculative không được commit write thật)
```

## Implementation

```typescript
// packages/speculative/src/index.ts (NEW)
async function speculativeBranches(
  decision: Decision,
  branches: { id: string; prob: number; run: Abortable<Task> }[],
) {
  // chỉ speculative nhánh có expected value dương (đổi latency cho cost)
  const viable = branches.filter(b => b.prob * valueOf(b.id) > costOf(b.run));
  const handles = viable.map(b => ({ ...b, ctrl: spawn(b.run, { commit: false }) }));
  const actual = await decision.awaitResult();           // đợi quyết định thật (gate)
  for (const h of handles) if (h.id !== actual) h.ctrl.abort();   // huỷ nhánh sai
  const hit = handles.find(h => h.id === actual);
  return hit ? hit.ctrl.materialize() : await branches.find(b => b.id === actual)!.run();
}                                                       // hit → near-zero latency
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Giảm latency cảm nhận — nhánh đúng đã sẵn (Hadoop) | ❌ Lãng phí cost/credit cho nhánh bị bỏ |
| ✅ Che giấu thời gian chờ human gate (HR) | ❌ Side-effect khó cô lập — speculative không được commit write |
| ✅ Cancellation hợp lý nhánh thừa (Spark take-first) | ❌ Dự đoán sai nhiều → tốn hơn tuần tự |
| ✅ Hợp burst I/O (fetch link user có khả năng click) | ❌ Cancellable executor phức (abort dọn dẹp) |

## Khác các hướng gần

| | GY Spec-Decoding | GZ Parallel Tools | JK: Speculative Task |
|---|---|---|---|
| Mức | Token | Tool call | **Task / branch** |
| Bỏ? | Sai token bỏ | Không bỏ (cả cần) | **Nhánh sai huỷ** |
| Rủi ro | Nhỏ (token) | Không | **Lãng phí cost có kiểm soát** |

## Khi nào chọn

- Human approval gate thường — muốn che thời gian chờ bằng cách chạy trước
- Nhánh rẽ ít (2-3), xác suất rõ (A 0.7 / B 0.3) — speculative đáng
- Speculative task side-effect-free hoặc có thể defer commit
- Không dùng khi: nhánh nhiều + xác suất đều, hoặc side-effect không thể rollback
