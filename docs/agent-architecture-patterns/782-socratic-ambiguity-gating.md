# Hướng ADB: Socratic Ambiguity Gating — Deep Interview hỏi MỘT câu một lần nhắm weakest clarity dimension, score minh bạch, từ chối proceed tới khi ambiguity ≤ threshold

> **Nguồn gốc:** oh-my-claudecode (skills/deep-interview/SKILL.md) | **Coupling:** 🟢 — interview stage, không đụng core loop | **Agent-agnostic:** ⚠️ (phụ thuộc model scoring) | **Code sẵn:** ⚠️ (có adversarial + hindsight — chưa có interview gate) | **Effort:** 1-2 tuần

## Nguồn gốc

**oh-my-claudecode** có **Deep Interview** dùng **Socratic questioning** với **mathematical ambiguity scoring**: (1) hỏi **MỘT câu một lần** — không hỏi dồn dập — nhắm vào **weakest clarity dimension** (chiều mơ hồ nhất hiện tại); (2) **score hiển thị minh bạch** sau mỗi answer (user thấy điểm rõ ràng thay đổi thế nào); (3) **từ chối proceed tới execution** cho tới khi **ambiguity ≤ resolved threshold VÀ user approve explicit execution path**. Nguyên tắc: **hỏi ít mà đúng chỗ (weakest dimension), điểm minh bạch, gate execution tới khi rõ + user duyệt**.

## Mô tả

mya socratic ambiguity gating: (1) **clarity dimensions** — tập hợp chiều cần rõ: goal, scope, constraints, acceptance-criteria, stakeholders, risks; (2) **scoring** — mỗi answer cập nhật điểm từng dimension (0-1 rõ ràng); (3) **hỏi 1 câu** — chọn dimension điểm thấp nhất, sinh câu hỏi Socratic (hỏi sâu vào chỗ mơ hồ nhất); (4) **minh bạch** — hiển thị score sau mỗi answer; (5) **gate** — ambiguity ≤ threshold (`resolved`) VÀ user approve execution path mới được proceed; không đủ → tiếp tục hỏi. Nối council/hindsight.ts (scoring JSON) + council.ts (judge) — ADB là interview pipeline.

## Kiến trúc

```
  TASK BAN ĐẦU (mơ hồ)
       ▼
  SCORE DIMENSIONS (0-1 rõ ràng)
    goal · scope · constraints · acceptance · stakeholders · risks
       ▼
  CHỌN WEAKEST DIMENSION
       ▼
  HỎI MỘT CÂU (Socratic — vào chỗ mơ hồ nhất)
       │  user answer
       ▼
  RE-SCORE + HIỂN THỊ MINH BẠCH
       ├─ ambiguity ≤ threshold VÀ user approve path?
       │     ├─ ✅ → PROCEED tới execution
       │     └─ ❌ → quay lại hỏi (weakest mới)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/council hindsight.ts — HindsightReviewer (nền — JSON scoring output)
// ✅ packages/council council.ts — CouncilProvider judge strategy (nền — judge score)
// ✅ packages/council adversarial.ts — refute (nền — kiểm tra giả định)
// ✅ packages/prompts inject.ts — scan (nền — an toàn khi nhận input user)
// ✅ packages/tools approval.ts — approval flow (nền — user approve execution path)
// ✅ packages/agent prompt() — run turn (nền — hỏi 1 câu = 1 turn)

// ❌ THIẾU: clarity dimensions + scoring model
// ❌ THIẾU: weakest-dimension selection (hỏi 1 câu đúng chỗ)
// ❌ THIẾU: gate execution (ambiguity ≤ threshold + user approve)
```
## Implementation
```typescript
// packages/council/src/deep-interview.ts (MỚI)
export type ClarityDimension =
  | "goal" | "scope" | "constraints" | "acceptance" | "stakeholders" | "risks";
export interface ClarityState {
  dimensions: Record<ClarityDimension, number>; // 0..1 — 1 = rõ
  resolved: boolean;
}
const RESOLVED_THRESHOLD = 0.8;
export function newClarityState(): ClarityState {
  return { dimensions: { goal: 0.2, scope: 0.2, constraints: 0.2, acceptance: 0.2, stakeholders: 0.2, risks: 0.2 }, resolved: false };
}
/** Chọn weakest dimension — chiều mơ hồ nhất (điểm thấp nhất). */
export function weakestDimension(state: ClarityState): ClarityDimension {
  return (Object.entries(state.dimensions) as Array<[ClarityDimension, number]>).sort((a, b) => a[1] - b[1])[0]![0];
}
/** Re-score sau mỗi answer — dimension được hỏi tăng điểm theo chất lượng answer. */
export function applyAnswer(state: ClarityState, dimension: ClarityDimension, answer: string, judgeScore: (text: string) => number): ClarityState {
  const raw = judgeScore(answer);
  const current = state.dimensions[dimension]!;
  const updated: ClarityState = {
    ...state,
    dimensions: { ...state.dimensions, [dimension]: Math.max(0, Math.min(1, current * 0.4 + raw * 0.6)) },
  };
  updated.resolved = Object.values(updated.dimensions).every((d) => d >= RESOLVED_THRESHOLD);
  return updated;
}
/** Gate — ambiguity ≤ threshold VÀ user approve path. */
export function gateExecution(state: ClarityState, userApproved: boolean): { proceed: boolean; reason: string } {
  if (!state.resolved) {
    const weakest = weakestDimension(state);
    return {
      proceed: false,
      reason: `ambiguity chưa resolved (${weakest} = ${Math.round(state.dimensions[weakest]! * 100)}% — cần ≥ ${RESOLVED_THRESHOLD * 100}%) — hỏi tiếp 1 câu.`,
    };
  }
  if (!userApproved) {
    return { proceed: false, reason: "rõ rồi nhưng user chưa approve execution path — trình bày path + xin duyệt." };
  }
  return { proceed: true, reason: "ambiguity ≤ threshold + user approve — proceed." };
}
/** Sinh câu hỏi Socratic cho dimension — 1 câu duy nhất. */
export function socraticQuestion(dimension: ClarityDimension, state: ClarityState): string {
  const prompts: Record<ClarityDimension, string> = {
    goal: "Mục tiêu cuối cùng đo bằng gì? Khi nào thì 'xong' theo nghĩa kiểm chứng được?",
    scope: "Phạm vi chính xác là gì — cái gì KHÔNG nằm trong task này?",
    constraints: "Ràng buộc cứng nào (thời gian, kỹ thuật, quy định) tôi phải tôn trọng?",
    acceptance: "Làm sao biết kết quả ĐẠT — tiêu chí chấp nhận cụ thể?",
    stakeholders: "Ai là người hưởng lợi / bị ảnh hưởng — yêu cầu của họ khác gì nhau?",
    risks: "Rủi ro lớn nhất nếu làm sai là gì — và dấu hiệu sớm của sai lệch?",
  };
  return `(clarity: ${dimension} ${Math.round(state.dimensions[dimension]! * 100)}%) ${prompts[dimension]}`;
}
//        state = applyAnswer(state, dim, answer, judgeScore);
//        gateExecution(state, userApproved) → proceed?
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Hỏi 1 câu đúng chỗ — ít phiền user, hiệu quả cao | ❌ Judge score phụ thuộc model — điểm có thể lệch |
| ✅ Score minh bạch — user thấy tiến độ rõ ràng | ❌ Nhiều dimension mơ hồ → nhiều vòng hỏi (chậm) |
| ✅ Gate execution — không chạy khi chưa rõ + chưa duyệt | ❌ Threshold 0.8 cần calibrate theo loại task |
| ✅ Nối approval flow — user approve path có sẵn | ❌ Score thủ công khởi điểm 0.2 — chủ quan |

## Khác các hướng gần

| | Adversarial review (adversarial.ts) | ADB: Deep Interview |
|---|---|---|
| Mục đích | Refute findings | **Làm rõ task trước khi execution** |
| Cơ chế | N reviewer vote | **Hỏi 1 câu → weakest dimension → re-score** |
| Output | Filter | **Gate proceed (ambiguity + approve)** |
| Thời điểm | Sau khi có kết quả | **Trước khi bắt đầu** |

## Khi nào chọn

- Task mơ hồ — cần hỏi đúng chỗ trước khi chạy (tránh làm sai hướng)
- Muốn gate execution có căn cứ (score + user approve) thay vì tự đoán
- Guard: 1 câu mỗi lần, score minh bạch, threshold + approve bắt buộc
