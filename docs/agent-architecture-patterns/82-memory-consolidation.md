# Hướng CD: Memory Consolidation — "ngủ" để sắp xếp trí nhớ

> **Nguồn gốc:** arXiv 2604.20943 "SleepCycle" (2026); Anthropic "Dreaming for Agent Memory" (2026); Born et al. 2011 (system consolidation)
> **Coupling:** 🟢 — phase offline, không đụng runtime
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (memory 3 tầng sẵn; thiếu consolidation job)
> **Effort:** 1-2 tuần

## Nguồn gốc

Memory consolidation — mượn neuroscience (Born 2011: sleep = "active system consolidation"): **phase offline** chuyển episodic (trải nghiệm cụ thể) → semantic (tri thức tổng quát), nén, liên kết, **chủ động quên** (forgetting) những thứ không còn giá trị. Với LLM agents 2026: SleepCycle (arXiv 2604.20943) — offline phases **NREM consolidation, REM dreaming, intentional forgetting**; Anthropic "Dreaming for Agent Memory" (2026) — **batch agents phân tích transcript lịch sử** offline để rút tri thức. Khác **MM Memory Mgmt** (lưu trữ 3 tầng *tại runtime* — ghi/đọc) — consolidation là **phase riêng biệt ngoài runtime**: chuyển tầng, tổng hợp, dọn rác, liên kết chéo.

## Mô tả

mya chạy **consolidation job** định kỳ (cron, khi agent nghỉ — nối PPP serverless/giờ thấp điểm): quét **episodic** (session transcripts, tool logs) → batch agent (hoặc LLM tier nhỏ) phân tích: rút **semantic** (bài học chung — nối YY: compile thành skills), nén **summary chéo** (các session cùng chủ đề gộp lại), liên kết chéo (session A liên quan B — theo W DAG), **forgetting** (episodic cũ quá ngưỡng → xóa hoặc hạ cấp, giữ semantic). Output: memory mới cập nhật vào MM 3 tầng; refresh index (GGG Agentic RAG khi có). Lưu ý: Anthropic cảnh báo — consolidation bằng LLM có thể **bóp méo tri thức** (hallucinate khi tổng hợp) → giữ provenance + verify bằng eval (PP).

## Kiến trúc

```
  (runtime: MM episodic ghi liên tục)
       │
  CONSOLIDATION JOB (cron — offline, giờ thấp điểm)
  ├─ NREM: episodic → semantic (batch agent: bài học chung, verify PP)
  ├─ nén: summary chéo các session cùng chủ đề
  ├─ liên kết: session↔session (W DAG / tags)
  └─ forgetting: episodic cũ hạ cấp/xóa; giữ semantic + provenance
       │
       ▼
  MM 3 tầng cập nhật + index refresh (GGG)
  (Anthropic: batch agents phân tích transcript — provenance bắt buộc)
```

```
mya: packages/memory (3 tầng sẵn) + cron + skills (YY) sẵn
     thiếu: consolidation job + chính sách chuyển tầng/forgetting + provenance
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/memory — 3 tầng (episodic/semantic/procedural) — đối tượng consolidation
// ✅ packages/cron — chạy job định kỳ
// ✅ packages/skills — semantic → compile skill (YY nối sẵn)
// ✅ packages/ai/src/model-routing.ts — tier nhỏ cho batch agent (rẻ)
// ✅ packages/eval — verify tri thức tổng hợp (chống méo)

// ❌ THIẾU: consolidation job (NREM/summary/link/forget) — hiện chỉ ghi, không dọn
// ❌ THIẾU: chính sách forgetting (ngưỡng tuổi/giá trị)
// ❌ THIẾU: provenance trên tri thức tổng hợp (nguồn session nào)
```

## Implementation

```typescript
// packages/memory/src/consolidate.ts (NEW)
async function consolidate(opts: { maxAgeEpisodic: number }): Promise<Report> {
  const episodes = await episodic.olderThan(opts.maxAgeEpisodic);   // MM tầng 2
  for (const group of clusterByTopic(episodes)) {                    // nhóm chủ đề
    const insight = await batchAgent({                               // tier nhỏ (RR)
      task: "rút bài học chung + nguồn cụ thể",                      // verify PP sau
      transcripts: group,
    });
    if (await verify(insight)) {                                     // chống méo
      await semantic.save({ ...insight, provenance: group.map(id) });
    }
    await linkCross(group);                                          // session↔session
  }
  await forgetting.run({                                             // hạ cấp/xóa
    episodes: episodes.filter((e) => e.value < threshold),
  });
  return { consolidated: episodes.length, forgotten: n };
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Episodic không phình vô hạn (forgetting có chính sách) | ❌ LLM tổng hợp có thể **bóp méo** tri thức (Anthropic) |
| ✅ Semantic tích lũy → task sau tốt hơn (YY) | ❌ Batch agent chạy LLM (cost — chạy giờ thấp điểm) |
| ✅ Nối MM + YY + cron sẵn — thêm job | ❌ Forgetting nhầm tri thức còn giá trị |
| ✅ Provenance + verify (PP) chống méo | ❌ Tần suất consolidation phải tune |
| ✅ Nguồn 2026 mạnh (SleepCycle, Anthropic Dreaming) | |

## Khác các hướng gần

| | MM Memory Mgmt | YY Knowledge Compilation | EEEE: Consolidation |
|---|---|---|---|
| Khi nào | Runtime (ghi/đọc) | Khi compile | **Offline định kỳ** |
| Việc gì | Lưu 3 tầng | Skill từ tri thức | **Chuyển tầng + nén + quên** |
| Mối quan hệ | Đối tượng | Đầu ra semantic | Thúc đẩy cả hai |

## Khi nào chọn

- Episodic phình (session dài, nhiều task) — agent không tìm thấy cái cũ
- Muốn tri thức tích lũy tự động (không chỉ ghi log)
- Có giờ thấp điểm / worker rảnh (PPP)
- Đã có memory 3 tầng + cron — thêm job là chính