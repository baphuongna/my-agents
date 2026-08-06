# Hướng BN: Agent Chaos Engineering — inject lỗi trước production

> **Nguồn gốc:** tianpan.co 2026 "Chaos Engineering for AI Agents"; Microsoft Agent SRE (2026); zenn fault-injection TDD
> **Coupling:** 🟢 — injection qua harness, không đụng core
> **Agent-agnostic:** ✅
> **Code sẨn:** ⚠️ (eval sẵn; thiếu fault templates + injection layer)
> **Effort:** 1-2 tuần

## Nguồn gốc

Mô hình từ SRE (Chaos Monkey): chủ động **gây lỗi có chủ đích** để đo độ chịu lỗi. Với agent — 2026: "Chaos Engineering for AI Agents: Injecting the Failures Before Production" (tianpan.co): inject failure ở **tool layer** rồi kiểm tra "agent có thừa nhận lỗi hay che đậy". Microsoft "Applying SRE to Autonomous AI Agents" (2026) ship **fault injection templates** cho các failure mode hay bị bỏ qua. zenn 2026 "LLM Agent Fault Injection TDD": viết test inject lỗi trước (RED) — JSON malformed, timeout, quota. Điểm cốt lõi: agent đang có **hallucinate thành công** — lỗi xảy ra mà agent trả về "xong" như không có chuyện gì.

## Mô tả

mya chạy **fault campaigns** định kỳ (gắn PP): trong môi trường test, inject lỗi vào từng tầng — tool trả error, tool trả đúng nhưng chậm (timeout), tool trả dữ liệu sai lệch tinh vi, LLM output JSON malformed, quota exhausted (taint), network drop (mcp-reliability) — rồi đo: agent có **phát hiện** lỗi không (ok:false đúng), có **xử lý** đúng không (retry/escalate/QQ open), có **che đậy** không (trả ok khi thực ra fail). Mỗi campaign ra **scorecard che đậy** (masking rate) — chỉ số quan trọng nhất. Khác PP Eval (chấm output đúng/sai với input tốt) — chaos chấm hành vi khi *đường đi xấu*; khác QQ (breaker phản ứng realtime) — chaos là kiểm tra trước.

## Kiến trúc

```
                        FAULT CAMPAIGN (định kỳ, offline)
  test task ──► INVOKE mya ──► INJECTION POINT (harness bọc)
                  │             ├─ tool: throw error / return >timeout / data sai nhẹ
                  │             ├─ LLM: JSON malformed / response mất field
                  │             └─ infra: quota taint / network drop / 5xx
                  ▼
                OBSERVE hành vi:
                  ├─ phát hiện? (ok:false đúng)
                  ├─ xử lý? (retry / escalate UU / breaker QQ mở)
                  └─ CHE ĐẬY? (trả ok khi fail) ← metric quan trọng nhất
                  ▼
                SCORECARD (masking rate, handled rate, detected rate)
```

```
mya: packages/eval (PP) = chạy campaign · mcp-reliability (retry) = nơi inject
     registry.ts TaintedProfile = fixture quota/network
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/eval — harness chạy scenario (PP) — nền cho campaign
// ✅ packages/gateway/src/mcp-reliability.ts — retry/backoff (nơi test inject timeout)
// ✅ packages/ai/src/registry.ts — TaintedProfile (fixture: quota/rate_limited)
// ✅ packages/gateway/src/rate-limiter.ts (SS) — inject "chạm trần"

// ❌ THIẾU: fault templates (tool fail/timeout/data-sai/JSON-malformed) chuẩn hoá
// ❌ THIẾU: injection layer — bọc 1 tool call bằng fault trong lúc chạy
// ❌ THIẾU: scorecard masking-rate + CI gate (masking cao → chặn release)
```

## Implementation

```typescript
// packages/eval/src/chaos.ts (NEW)
type Fault =
  | { kind: "tool-error"; tool: string; errorCode: string }
  | { kind: "tool-timeout"; tool: string; latencyMs: number }
  | { kind: "tool-tamper"; tool: string; mutate: (out: unknown) => unknown }
  | { kind: "llm-malformed"; field: string }       // JSON thiếu field
  | { kind: "quota-taint"; provider: string };

interface Scorecard {
  detectedRate: number;    // agent thấy lỗi
  handledRate: number;     // xử lý đúng (retry/escalate)
  maskingRate: number;     // CHE ĐẬY — trả ok khi fail ← cấm cao
}

async function runCampaign(cases: Array<{ task: string; faults: Fault[] }>): Promise<Scorecard> {
  return harness.run(cases, (t, env) => injectAndInvoke(t, env));
  // injectAndInvoke: bọc tool/LLM call bằng fault, quan sát hành vi
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Phát hiện che đậy lỗi — lỗi nguy hiểm nhất của agent | ❌ Viết fault templates + scenario tốn công |
| ✅ Scorecard đo được → CI gate chặn release kém | ❌ Chaotic test có thể flaky (timeout ngẫu nhiên) |
| ✅ Tận dụng eval + taint + rate-limiter sẵn | ❌ Không cover hết failure mode (vô hạn) |
| ✅ Đo trực tiếp QQ breaker + UU escalation có hoạt động | ❌ Agent xử lý lỗi tốt không = task thành công |
| ✅ Kết hợp TDD: inject lỗi trước, rồi mới viết handler | |

## Khác các hướng gần

| | PP Eval Harness | QQ Circuit Breaker | OOO: Chaos |
|---|---|---|---|
| Khi nào | Khai thác thông thường | Runtime fail | Chủ động inject |
| Đo gì | Đúng/sai | Đóng/mở | **Masking/handling rate** |
| Mục đích | Quality | Phản ứng | **Đo độ chịu lỗi trước prod** |
| Mối quan hệ | Nền chạy campaign | Đối tượng được đo | Inject + đo cả hai |

## Khi nào chọn

- Agent đã trả "xong" nhưng thực ra fail (nghi che đậy lỗi)
- Muốn CI gate: masking rate cao → chặn release
- Đã có eval + rate-limiter + taint — thêm fault templates
- Sắp đưa agent tự hành (ít giám sát) — bắt buộc đo trước