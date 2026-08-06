# Hướng BD: Reflexion — tự đánh giá, ghi nhớ lỗi, thử lại

> **Nguồn gốc:** Shinn et al., 2023 (NeurIPS; arXiv 2303.11366)
> **Coupling:** 🟢 — chỉ quanh 1 agent + bộ nhớ phản hồi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (1 phần — eval-harness PP + memory episodic MM sẵn; thiếu reflect loop)
> **Effort:** 1 tuần

## Nguồn gốc

Reflexion (Shinn et al. 2023): agent sau khi thực hiện task sai → **tự đánh giá** output (trajectory + kết quả), ghi **lời phản xạ ('verbal reinforcement')** vào bộ nhớ, rồi **thử lại** với bài học đó trong context. Khác với retry thường: không lặp lại cùng cách làm — lần sau *được dặn* tránh lỗi đã mắc. Paper: cải thiện HumanEval 91% pass@1 với GPT-4, và trên ALFWorld sau 2 lần réflexion. Gọi là "reinforcement bằng lời" — không cần fine-tune, chỉ cần thêm loop.

## Mô tả

mya thực hiện task → **evaluator** (test suite từ PP eval-harness, tool-output, hoặc tự LLM) chấm PASS/FAIL → nếu FAIL: tạo **reflection** ngắn ("đã làm X nhưng test Y đỏ vì Z; lần sau làm W") → nạp vào memory episodic (MM tầng 2) → chạy lại task với reflection trong context → đến khi pass hoặc chạm max attempts (SS). Khác JJ (GAN-adversarial: critic là *agent khác* phản biện người ngoài) — Reflexion tự phản xạ, thêm *tri thức lỗi bền vững* qua memory.

## Kiến trúc

```
  task ──► AGENT ──► output ──► EVALUATOR (test/eval/tool-result)
                                    │ PASS ──► done ✅
                                    │ FAIL
                                    ▼
                          REFLECTION MEMORY (episodic, MM)
                          "lần 1: thử X → test Y đỏ vì Z"
                                    │ (nạp vào context lần chạy sau)
                                    ▼
                                AGENT thử lại (attempt+1)
                                    (tối đa N lần — SS budget)

  mya: packages/eval (PP) = evaluator · packages/memory = reflection store
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/eval — evaluator (test pass/fail) — đã là backbone đánh giá
// ✅ packages/memory — episodic layer (MM) — chỗ lưu reflection
// ✅ packages/tools/src/kanban-sqlite.ts — task state (chạy lại task attempt)
// ✅ packages/print/src/role-subagent-spawn.ts — lặp agent theo attempt

// ❌ THIẾU: vòng lặp generate→evaluate→reflect→retry ở cấp runtime
// ❌ THIẾU: prompt reflection (ép agent nêu lỗi gọn, actionable)
// ❌ THIẾU: gắn reflection vào next attempt (không chỉ log)
```

## Implementation

```typescript
// packages/core/src/reflexion-loop.ts (NEW)
interface ReflexionState {
  task: string;
  attempts: number;
  maxAttempts: number;             // SS: chặn lố
  reflections: string[];           // từ memory episodic (MM)
}

async function reflexionLoop(state: ReflexionState): Promise<Result> {
  while (state.attempts < state.maxAttempts) {
    const output = await runAgent(state.task, state.reflections);
    const verdict = await evaluate(output);            // packages/eval
    if (verdict.ok) { await saveEpisode(state, output); return output; }

    const lesson = await promptReflection(output, verdict);  // "lỗi gì, làm sao"
    state.reflections.push(lesson);                   // nạp vào context lần sau
    await memory.save({ kind: "reflection", lesson }); // MM episodic
    state.attempts++;
  }
  return escalate(state);                              // UU: escalation sau N lần
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Nâng pass rate rõ (HumanEval 91% GPT-4) | ❌ N× cost chuỗi thử (SS bắt buộc) |
| ✅ Tri thức lỗi **bền vững** qua memory (không như retry) | ❌ Reflection kém → lặp cùng sai lầm |
| ✅ Dùng chung eval-harness sẵn có | ❌ Delay: 1 task chạy nhiều vòng |
| ✅ Không fine-tune | ❌ Evaluator là tiêu chuẩn đúng sai — task mở khó chấm |
| ✅ Graph cửa sổ lỗi chồng lên MM | |

## Khác các hướng gần

| | QQ Circuit Breaker | JJ Adversarial | EEE: Reflexion |
|---|---|---|---|
| Ai đánh giá | External health (lỗi mạng/code) | Critic agent riêng | Chính agent/tool tự chấm |
| Học gì | Không — chỉ cắt | Phản biện trong lượt | Lời phản xạ lưu memory |
| Dùng lại | Không | Không | ✅ episode/tri thức |
| Vòng lặp | Mở lại sau cool-down | N vòng trong lượt | N attempt trong task |

## Khi nào chọn

- Có test suite (PP eval) đáng tin để chấm PASS/FAIL
- Task lặp lại nhiều lần → reflection tích lũy giá trị
- Muốn tăng pass rate mà không nhồi prompt dài
- Đã có memory episodic — chỉ cần nối loop