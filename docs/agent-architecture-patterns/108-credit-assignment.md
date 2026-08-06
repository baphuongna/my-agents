# Hướng DD: Credit Assignment — biết agent nào thực sự đóng góp kết quả

> **Nguồn gốc:** "LLM-Guided Credit Assignment in Multi-Agent" (NeurIPS 2025, arXiv 2502.03723); AAMAS 2025 LLM-TACA; arXiv 2603.06859
> **Coupling:** 🟢 — tầng phân tích trace, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (trace sẵn; thiếu attribution)
> **Effort:** 1-2 tuần

## Nguồn gốc

Credit assignment: **gán công/trách cho từng agent với kết quả của cả nhóm** — NeurIPS 2025 "LLM-Guided Credit Assignment": "attributing credit or blame to individual agents for contributions to team success or failure"; AAMAS 2025 LLM-TACA (19 cites): combinar credit assignment + explicit task assignment cấp thẳng vào policy mỗi agent; arXiv 2603.06859: counterfactual credit assignment cho cooperative MARL LLM-based; awesome-credit-assignment 2026 repo đầy đủ. Tại sao cần với mya: team nhiều agents (GG/XX/CCCC...) — kết quả tốt/xấu là *của nhóm* — không biết **agent nào thật sự quyết định** → không biết sửa ai (BBBBB self-improve điếc), không biết cấu trúc nào thừa (IIII topology điều chỉnh mù). Attribution framework (openreview 2026): định lượng đóng góp từng agent để tối ưu kiến trúc.

## Mô tả

mya attribution: (1) **đo lường trace** — mỗi subtask (AAAAA) ghi: ai thực hiện, kết quả, dependency, ảnh hưởng lên kết quả cuối (đã có trace QQQQ + audit); (2) **credit split** — cuối task: LLM/toán gán credit từng agent theo: chạy đúng? quyết định đúng? hay đẩy task đi đúng hướng? (counterfactual — 2603.06859: nếu bỏ agent X kết quả đổi? cách này qua sim UUUU/FFFFF); (3) **cung cấp** — credit → BBBBB (self-improve sửa đúng agent), IIII (bỏ agent thừa), 48/DD (router lens), SS (chi phí theo agent — chargeback per role); (4) **feedback** — credit thấp agent trễ/đẩy sai → cảnh báo (ZZZZ drift detect agent-level). Tránh: credit bôi tro (mọi agent "promising" hào — YYYY anti-hack / honest reporting).

## Kiến trúc

```
  TRACE TASK (AAAAA — mỗi subtask ghi ai làm · kết quả · dependency)
        │
        ▼
  CREDIT ASSIGN (NeurIPS 2025 / 2603.06859 counterfactual)
    ├─ correctness: agent chạy đúng? (53/GGGG verify)
    ├─ decision: quyết định đúng hướng? (trace stepping)
    ├─ counterfactual: bỏ agent X — kết quả đổi? (sim UUUU/FFFFF)
    └─ contribution: đẩy task đúng chỗ? (delegation)
        │
        ▼
  TIÊU THỤ:
    ├─ BBBBB self-improve → sửa ĐÚNG agent (không sửa bừa)
    ├─ IIII topology → bỏ agent thừa / đổi cấu trúc
    ├─ 48/DD router → chỉnh phân phối task
    └─ SS chargeback → chi phí per agent
  tránh "bôi tro": credit + evidence (YYYY honest)
```

```
mya: trace QQQQ + audit SẴN — thiếu: credit attribution layer
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ QQQQ trace + VV audit — dữ liệu attribution (ai làm gì)
// ✅ AAAAA decompose — subtask granularity (đơn vị credit)
// ✅ 53 + GGGG — verify đúng/sai per subtask
// ✅ UUUU mock + FFFFF sim — counterfactual (bỏ agent X — sim lại)
// ✅ BBBBB + IIII — consumer (sửa đúng agent / cấu trúc)
// ✅ SS budget — cost per agent

// ❌ THIẾU: attribution engine (credit split có evidence)
// ❌ THIẾU: counterfactual runner (sim bỏ agent)
// ❌ THIẾU: feedback tới BBBBB/IIII tự động
```

## Implementation

```typescript
// packages/analysis/src/credit.ts (NEW)
interface Credit { agent: AgentId; score: number; evidence: TraceId[]; }

function assignCredit(taskTrace: Trace): Credit[] {
  const nodes = splitSubtasks(taskTrace);        // AAAAA đơn vị
  return nodes.map((n) => ({
    agent: n.agent,
    score: weighted(
      verifyOutcome(n),                          // 53/GGGG đúng?
      decisionQuality(n),                        // hướng đúng?
      n.delegatedTo?.score ?? 0,                 // delegation
    ),
    evidence: n.traceIds,
  }));
}
// counterfactual: bỏ agent X → UUUU/FFFFF sim lại → đổi khác nhiều?
//   → X thật sự quan trọng (2603.06859) | không đổi → X có thể bỏ (IIII)
// output → BBBBB (sửa đúng) · IIII (bỏ thừa) · 48 (router)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Biết agent nào đóng góp — sửa đúng (BBBBB) | ❐ Attribution heuristic có thể nhầm (cần evidence) |
| ✅ Bỏ agent thừa (IIII) — qua counterfactual sim | ❌ Counterfactual chạy tốn (UUUU/FFFFF) |
| ✅ Chi phí theo agent (SS chargeback) | ❌ Credit "bôi tro" — cần YYYY honest flags |
| ✅ Nguồn: NeurIPS 2025 + AAMAS 2025 | ❌ Methodology chưa đồng thuận hoàn toàn |

## Khác các hướng gần

| | YYYY Anti-Hack | BBBBB Self-Improve | EEEEE: Credit |
|---|---|---|---|
| Vấn đề | Gian lận metric | Cải thiện năng lực | **Biết AI đóng góp** |
| Cơ chế | Verify trace | Feedback→fix | **Attribution+evidence** |
| Mối quan hệ | Bảo vệ credit | Consumer | **Cấp dữ liệu đúng** |

## Khi nào chọn

- Team nhiều agents — không biết ai tạo giá trị (important)
- Self-improve (BBBBB) đang sửa sai agent
- Muốn tinh cấu trúc (IIII) dựa trên dữ liệu
- Có trace + sim (UUUU/FFFFF) để counterfactual