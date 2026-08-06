# Hướng LR: Safety Case Evidence — argument có bằng chứng chứng minh agent an toàn

> **Nguồn gốc:** Safety case / assurance case (Goal Structuring Notation — GSN); HAZOP; FAA AC 25.1309; UK MoD Def Stan 00-56; "argument-based safety assurance"; ISO 26262 ASIL; EU AI Act risk documentation
> **Coupling:** 🟡 — cần evidence collector + argument registry
> **Agent-agnostic:** ✅
> **Code sẵn:** ❌ (audit log sẵn — chưa có structured safety argument)
> **Effort:** 2-3 tuần

## Nguồn gốc

**Safety case** (FAA, UK MoD Def Stan 00-56): một **argument có cấu trúc** (Goal Structuring Notation — GSN) chứng minh hệ thống đủ an toàn để vận hành — không phải "chạy test rồi xong", mà cần lập luận: Goal (an toàn) ← Strategy (phân tích hazard) ← Evidence (test log, fuzzing, redteam, audit). Nguyên tắc GSN: mỗi claim phải có **evidence traceable** — không lời khẳng định suông. EU AI Act yêu cầu documentation risk. HAZOP: hazard identification + analysis. Safety case khác **testing** (chứng minh có bug) — safety case là **argument tích cực** chứng minh an toàn dưới mọi hazard đã xác định.

## Mô tả

mya safety case: lập luận có cấu trúc GSN — Goal "agent không thực hiện action destructive không được duyệt" ← Strategy "mọi destructive action qua HR approval (226) + precondition check (290) + dry-run (289)" ← Evidence "redteam 303 không bypass được, fuzzing 304 không inject, audit log 198 đầy đủ". Evidence collector thu thập tự động từ test/audit/redteam → gắn vào argument node. Khi evidence thiếu/expired → safety case **không đạt** → chặn deploy. Nối 305 security-eval-suite (evidence source) — LR tổng hợp thành **argument**. Khác 299 regression-gates (gate pass/fail) — LR là **bức tranh tổng thể** chứng minh an toàn.

## Kiến trúc

```
  ┌─────────────── SAFETY CASE (GSN) ───────────────┐
  │                                                 │
  │  GOAL: "Agent an toàn cho production"            │
  │       │                                         │
  │  ┌────┴──────────────────────────┐              │
  │  │ STRATEGY: hazard decomposition │              │
  │  └──┬───────┬───────┬────────────┘              │
  │     │       │       │                            │
  │     ▼       ▼       ▼                            │
  │  H1:       H2:       H3:                         │
  │  Unauth   Inject    Data                         │
  │  action   prompt    leak                         │
  │   │        │         │                           │
  │   ▼        ▼         ▼                           │
  │  EVIDENCE:                                        │
  │   · HR gate (226): 100% destructive → approved   │
  │   · Redteam (303): 0 bypass / 500 attempts       │
  │   · Fuzzing (304): 0 inject / 10k probes         │
  │   · Data-min (284): PII stripped, audit (198)    │
  │   │                                              │
  │   ▼ tất cả evidence present + fresh?             │
  │  SAFETY CASE: ✅ SATISFIED → deploy              │
  │              ❌ GAP (evidence thiếu) → BLOCK     │
  └─────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 198 GP audit — record mọi action (evidence source)
// ✅ 303 redteam automation — redteam evidence
// ✅ 304 prompt fuzzing — fuzzing evidence
// ✅ 305 security-eval-suite — security eval (evidence)
// ✅ 226 HR human-approval — approval gate (evidence)
// ✅ 284 data-minimization — PII handling (evidence)
// ✅ 299 regression-gates-CI — gate (nền)

// ❌ THIẾU: GSN argument structure (goal → strategy → evidence)
// ❌ THIẾU: evidence collector (tự thu thập từ test/audit)
// ❌ THIẾU: safety case registry (lưu argument qua version)
// ❌ THIẾU: evidence freshness/expiry check (evidence cũ → gap)
```

## Implementation

```typescript
// packages/safety/src/safety-case.ts (NEW)
interface Evidence {
  id: string;
  source: 'redteam' | 'fuzzing' | 'audit' | 'eval' | 'gate';
  result: 'pass' | 'fail';
  timestamp: number;
  maxAgeMs: number; // evidence hết hạn
}

interface GSNNode {
  type: 'goal' | 'strategy' | 'hazard' | 'evidence';
  claim: string;
  children?: GSNNode[];
  evidence?: Evidence;
}

function evaluateSafetyCase(node: GSNNode): { satisfied: boolean; gaps: string[] } {
  const gaps: string[] = [];
  if (node.type === 'evidence') {
    const ev = node.evidence!;
    if (ev.result !== 'pass') gaps.push(`${ev.id}: FAILED`);
    if (Date.now() - ev.timestamp > ev.maxAgeMs) gaps.push(`${ev.id}: EXPIRED`);
    return { satisfied: gaps.length === 0, gaps };
  }
  const childResults = (node.children ?? []).map(evaluateSafetyCase);
  const allSatisfied = childResults.every(r => r.satisfied);
  childResults.forEach(r => gaps.push(...r.gaps));
  if (!allSatisfied) gaps.unshift(`GOAL NOT MET: ${node.claim}`);
  return { satisfied: allSatisfied, gaps };
}

// Evidence collector — thu thập tự động từ test/audit/redteam
async function collectEvidence(): Promise<Evidence[]> {
  return [
    { id: 'redteam-bypass', source: 'redteam', result: 'pass', timestamp: Date.now(), maxAgeMs: 86400_000 },
    { id: 'fuzz-inject', source: 'fuzzing', result: 'pass', timestamp: Date.now(), maxAgeMs: 86400_000 },
  ];
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Argument tích cực chứng minh an toàn (GSN proven) | ❌ Phải xây argument tree (không trivial) |
| ✅ Evidence traceable — không khẳng định suông | ❌ Evidence cũ → phải re-run (chi phí) |
| ✅ Chặn deploy khi có gap (safety-first) | ❌ False gap chặn deploy hợp lệ |
| ✅ Nối 303/304/305 (evidence) thành tổng thể | ❌ Complex khi hazard nhiều |

## Khác các hướng gần

| | 305 Security Eval | 299 Regression Gates | LR: Safety Case |
|---|---|---|---|
| Cái gì | Security test | CI gate pass/fail | **Argument có evidence** |
| Scope | Security | Code regression | **Toàn bộ hazard** |
| Output | Score | Pass/fail | **GSN: satisfied/gap** |
| Traceability | ❌ | ❌ | ✅ goal→evidence |

## Khi nào chọn

- Hệ thống high-stakes (production, data nhạy cảm) — cần chứng minh an toàn
- Compliance yêu cầu (EU AI Act, ISO 26262) — cần documentation
- Muốn deploy gate dựa trên evidence tổng thể (không chỉ test pass)
- Kết hợp 303 redteam + 304 fuzzing + 305 eval làm evidence source; cập nhật evidence thường xuyên (freshness)
