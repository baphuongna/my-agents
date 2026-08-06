# Hướng FZ: Conversational Memory Management — nhớ hội thoại dài: tóm tắt + giữ lượt gần

> **Nguồn gốc:** mem0 "LLM Chat History Summarization Guide" (contextual summarization — nén hội thoại định kỳ, giữ exchanges gần đầy đủ); Oracle "Which Agent Memory Approach Is Best for Long Conversations" (layered — recent context + summaries); Pinecone "Conversational Memory with LangChain" (longer conversations — summarization LLM trung gian); padme (giữ messages gần, tóm messages cũ, kiểm soát token); arXiv 2402.17753 (long-term memory benchmark — QA + event summarization)
> **Coupling:** 🟢 — lớp memory, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (conversation history + J memory sẵn; thiếu summarization pipeline)
> **Effort:** 1-2 tuần

## Nguồn gốc

Conversational memory: **hội thoại dài không thể nhét hết — giữ lượt gần nguyên vẹn, nén lượt cũ thành tóm tắt, kiểm soát token** — mem0: "contextual summarization works by periodically compressing ongoing conversations while preserving recent exchanges in full detail"; Oracle: "the best pattern for long conversation memory is a layered architecture — recent context keeps the current exchange coherent, summaries compress"; Pinecone: "enables much longer conversations — memorization reliant on the summarization ability of the intermediate summarization LLM"; padme: "keep the most recent messages intact while summarizing the previous ones — push a certain number of tokens into the summary". Điểm khác **JJJJJJJ hierarchical memory** (nhiều tầng nhớ tổng quát — episodic/semantic) và **OOOOOOO context budget** (cấp phát token các loại) — AAAAAAAA *chuyên hội thoại*: (1) layered — recent đầy đủ + rolling summary (Oracle layered); (2) summarization trigger — khi vượt ngưỡng token → tóm lượt cũ thành summary (mem0 periodic; Pinecone summarization LLM); (3) token control — push N token vào summary (padme), giữ window cố định; (4) multi-turn quality — tóm tắt giữ được: quyết định, yêu cầu, sự kiện (arXiv benchmark — QA từ lịch sử); (5) retrieval — cần chi tiết cũ → hỏi summary hoặc tra episodic (JJJJJ — cấp dưới); (6) cost — đỡ phải gửi toàn bộ lịch sử mỗi turn (OOOOOOO budget liên quan). Nối JJJJJ (tầng dưới — episodic chi tiết), OOOOOOO (budget/trim), V (episodic — chi tiết để tra lại), 165 (memory hierarchy), 170 (context).

## Kiến trúc

```
  HỘI THOẠI DÀI
        │
        ▼
  LAYERED (Oracle — best for long conversations):
   · RECENT: lượt gần — giữ NGUYÊN (coherence hiện tại)
   · SUMMARY: lượt cũ — nén định kỳ (mem0 contextual summarization)
        │
        ▼
  TRIGGER (Pinecone): vượt ngưỡng token → summarize lượt cũ
   · summarization LLM trung gian (chất lượng phụ thuộc khả năng tóm)
        │
        ▼
  TOKEN CONTROL (padme): push N token vào summary — window cố định
        │
        ▼
  CẦN CHI TIẾT CŨ? → tra episodic/JJJJJJ (không gửi nguyên lịch sử)
```

```
mya: conversation history + J SẴN — thiếu: summarization pipeline
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ Conversation history — lưu hội thoại (nền)
// ✅ JJJJJJJ memory hierarchy — episodic (tra chi tiết cũ)
// ✅ V episodic memory — trải nghiệm (nguồn chi tiết)
// ✅ OOOOOOO context budget — token window (ràng buộc)
// ✅ Summarizer — có khả năng tóm (dùng chung)

// ❌ THIẾU: layered memory cho hội thoại (recent + summary)
// ❌ THIẾU: summarization trigger (ngưỡng token → nén)
// ❌ THIẾU: token control (push N vào summary — padme)
```

## Implementation

```typescript
// packages/chat-memory/src/layered.ts (NEW)
export class ChatMemory {
  async add(turn: Turn): Promise<void> {
    history.push(turn);
    if (tokens(history) > THRESHOLD) {          // mem0: compress định kỳ
      const summary = await summarize(oldTurns(history)); // Pinecone LLM
      history.keep(recent(history), summary);   // Oracle: recent + summary
    }
  }
  context(): Prompt {                            // padme: push N tokens vào summary
    return { summary: this.summary, recent: last(history, K) };
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Hội thoại dài không phình token (mem0 compress) | ❌ Chất lượng phụ thuộc khả năng tóm (Pinecone) |
| ✅ Recent nguyên — hỏi đáp hiện tại vẫn chuẩn (Oracle layered) | ❐ Tóm sai → mất chi tiết quan trọng |
| ✅ Nhanh + rẻ — không gửi toàn lịch sử mỗi turn | ❌ Thêm 1 LLM call summarize định kỳ |
| ✅ Xây trên history + JJJJJ + OOOOOOO | ❌ Hội thoại ít lượt — không cần |

## Khác các hướng gần

| | JJJJJJJ Memory | OOOOOOO Budget | AAAAAAAA: Chat Memory |
|---|---|---|---|
| Phạm vi | Toàn bộ nhớ | Context chung | **Hội thoại (recent+summary)** |
| Cơ chế | Nhiều tầng | Trim | **Layered + summarization** |
| Quan hệ | Tra chi tiết | Cấp token | **Chuyên hội thoại dài** |

## Khi nào chọn

- Chat/agent hội thoại dài nhiều lượt — token phình
- Cần nhớ quyết định/yêu cầu cũ (QA từ lịch sử — arXiv)
- Chat UX cần nhạy — giữ recent nguyên vẹn (Oracle)
- Đã có history + J + OOOOOOO — thêm layered + trigger