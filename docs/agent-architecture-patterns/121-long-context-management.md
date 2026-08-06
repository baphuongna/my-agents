# Hướng RRRRR: Long-Context Management — chống suy giảm trí tuệ khi context dài

> **Nguồn gốc:** "Intelligence Degradation in Long-Context LLMs" (arXiv 2601.15300, 2026); Google Chain-of-Agents; langchain Deep Agents 2025
> **Coupling:** 🟡 — chiến lược context, agent loop đổi nhẹ
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (CC/MMMM sẵn; thiếu chiến lược tổng)
> **Effort:** 2 tuần

## Nguồn gốc

Long-context degradation: **model xử lý tệ hơn khi context dài** — lost-in-the-middle (thông tin giữa prompt bị quên) — arXiv 2601.15300: "unified framework for understanding why degradation occurs" (nguyên nhân: positional bias, distraction, noise); langchain Deep Agents: "context crosses threshold → offload → summarization"; zylos 2026 context window analysis; getmaxim: selective context injection. Giải pháp: (1) **offload** — chuyển content cũ ra ngoài (file/memory — CC); (2) **summarization** — tóm khi hết chỗ (WWWW/MMMM nền); (3) **selective injection** — chỉ nạp phần quan trọng (VVVV/XXXX); (4) **Chain-of-Agents** (Google Research 2024-2026): "training-free, task-agnostic, interpretable — LLM collaboration for long-context tasks" — nhiều worker đọc từng đoạn → chain tổng hợp — giữ được thông tin xa (lost-in-middle giảm). Khác **CC context saver** (lưu/thu hồi file — 1 cơ chế) — RRRRR *chiến lược tổng* theo ngưỡng + degradation-aware.

## Mô tả

mya context management pipeline (packages/ai + prompts): (1) **đo** — context size + vị trí thông tin quan trọng (đánh dấu section critical — XXXX/G); (2) **thang hành động theo ngưỡng** — dưới ngưỡng: giữ nguyên; trung: **offload** lịch sử cũ → file (CC) + đánh dấu retrievable; cao: **summarize** lịch sử (WWWW/MMMM); quá cao: **Chain-of-Agents** — worker đọc từng đoạn (song song) → chain rút gọn → coordinator (giữ thông tin xa — lost-in-middle); (3) **positional defense** — thông tin critical đặt đầu/cuối (lost-in-middle), nhắc "đọc lại phần X nếu cần" (grounding); (4) **đo hiệu quả** — accuracy theo độ dài (GGGGG/PPPPP — phát hiện degradation → kích hoạt sớm hơn); (5) nối: MMMM cache (prefix ổn định) + WWWW (nén giữ lại).

## Kiến trúc

```
  CONTEXT SIZE ──► MEASURE (tokens + critical section vị trí)
        │
  ┌─────┼──────────────────────────────────┐
  < ngưỡng    trung                     quá cao
  giữ nguyên  OFFLOAD (CC — file)     CHAIN-OF-AGENTS (Google)
              SUMMARIZE (WWWW)          worker đọc từng đoạn (song song)
                                       │ chain rút gọn │ coordinator
        │                                   │
  POSITIONAL DEFENSE: critical đầu/cuối (lost-in-middle 2601.15300)
        │
  ĐO: accuracy theo độ dài (GGGGG/PPPPP) → chỉnh ngưỡng sớm hơn
  phối: MMMM prefix cache · WWWW nén · VVVV/XXXX nạp ít
```

```
mya: CC saver + WWWW/MMMM SẸN — thiếu: pipeline ngưỡng + Chain-of-Agents
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ CC context saver — offload (file)
// ✅ WWWW compression + MMMM cache — tóm/giữ rẻ
// ✅ VVVV disclosure + XXXX select — nạp ít hơn
// ✅ GGGGG process + PPPPP — đo degradation sớm
// ✅ memory MM — nơi offload lịch sử

// ❌ THIẾU: pipeline ngưỡng (đo → offload/summarize/CoA)
// ❌ THIẾU: Chain-of-Agents (worker chain — Google)
// ❌ THIẾU: positional defense (critical đầu/cuối)
```

## Implementation

```typescript
// packages/ai/src/long-context.ts (NEW)
type Strategy = "keep" | "offload" | "summarize" | "chain-agents";

function strategyFor(tokens: number, thresholds: Thresholds): Strategy {
  if (tokens < thresholds.mid) return "keep";
  if (tokens < thresholds.high) return "offload";      // CC file
  return tokens < thresholds.max ? "summarize" : "chain-agents"; // WWWW / CoA
}

async function chainOfAgents(doc: Doc, workers: WorkerPool, coord: Router) {
  // Google CoA: worker đọc từng phần → summaries → chain → coordinator
  // giữ thông tin xa — lost-in-middle giảm (training-free)
  const parts = chunk(doc);
  const summaries = await Promise.all(parts.map((p) => worker.read(p)));
  return coord.synthesize(chainSummaries(summaries));   // task-agnostic
}
// positional: critical section đầu/cuối + grounding "đọc lại X" (15)
// đo accuracy theo độ dài (GGGGG) → ngưỡng chỉnh sớm
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chống lost-in-middle (2601.15300 framework) | ❌ Pipeline nhiều nhánh — phức tạp hơn CC |
| ✅ CoA giữ thông tin xa (Google, interpretable) | ❐ CoA tốn nhiều calls (workers — PPPP rẻ) |
| ✅ Offload→summarize→CoA theo ngưỡng (langchain) | ❌ Chọn strategy sai → vẫn degrade |
| ✅ Nối WWWW/VVVV/MMMM thành hệ đầy đủ | ❌ Đo accuracy cần golden (ZZZZ/SSSS) |

## Khác các hướng gần

| | CC Context Saver | WWWW Compression | RRRRR: Long-Context |
|---|---|---|---|
| Phạm vi | Lưu/thu hồi | Nén token | **Chiến lược tổng theo ngưỡng** |
| Cơ chế | File | Prune | **Offload/Sum/CoA + positional** |
| Mối quan hệ | 1 bước | 1 bước | **Điều phối tất cả** |

## Khi nào chọn

- Task dài (nhiều lượt/doc lớn) — degradation rõ (GGGGG đo)
- Đã có CC + WWWW — thêm pipeline + CoA
- Quan trọng: thông tin giữa context bị quên (lost-in-middle)
- Chấp nhận workers rẻ (PPPP) khi quá ngưỡng