# Hướng HM: Feature Flags & Gradual Rollout cho Agent — bật/tắt năng lực, canary, rollback nhanh không deploy

> **Nguồn gốc:** GrowthBook "Feature Flags for AI" ("feature flags give runtime control — gradual rollouts tăng % cho probabilistic settings"); AWS AppConfig "Experiment feature flag" (flag attributes + constraints cho experiment); Amplitude "Feature Flags Best Practices" ("phased rollouts — new elements dần giới thiệu limited audience trước full-scale"); Harness "Feature Management & Experimentation" (beyond basic toggles — A/B testing, gradual rollouts, traffic targeting); Facebook "Safely experimenting with agents using feature flags" (enable/disable agent capabilities, test new behaviors, rollback mà không deploy lại code); Azure App Config (groups + percentage rollout)
> **Coupling:** 🟢 — độc lập, điểm cắm cấu hình ngoài runtime
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (config nội bộ — chưa flag runtime)
> **Effort:** 2-4 tuần

## Nguồn gốc

Feature flags: **mọi hành vi agent (tool, prompt, model, policy) kiểm soát qua flag runtime — rollout theo % / nhóm, shadow, A/B, rollback khẩn cấp không cần deploy** — GrowthBook: "probabilistic settings — gradual rollout %" — đúng bản chất LLM (xác suất); Amplitude: "phased rollout — dần giới thiệu limited audience"; Harness: A/B + traffic; Facebook: "enable/disable agent capabilities safely, rollback nhanh"; AWS AppConfig: flag attributes/constraints cho experiment; Azure: groups + packet %. Khác **84 prompt-versioning (173)** (A/B prompt — trong code static) — NNN system-level flag cho bất kỳ thứ gì; **shadow 49/130** (một pattern rollout) — ; NNN là *hạ tầng* để làm shadow/A-B. Kết nối: **141/76 feature per-user** (flags distribution theo attribute), **131/203 slow-guard** (kill khi nguy), **41 eval** (khi flag bật — đo real user). Lớn agent cần: nếu tool xấu — tắt cờ là đủ, không phải deploy.

## Kiến trúc

```
  FLAG STORE (flag: name, 'on/off', %, nhóm, constraints — mỗi agent đọc)
        │            (tạo từ UI/API — không cần deploy — GrowthBook/Azure)
        ▼
  AGENT RUNTIME (mỗi bước: feature.evaluate(name) → quyết định hành vi)
        │
  ┌──────► TO-BEHAVIOR (tool mới / prompt mới / model mới)
  │       ► % rollout (giải quyết: 5% user — xem KếTo metrics; rồi tăng)
  │       ► SHADOW (chạy song song — 129 — không ảnh user)
  │       ► KILL → tắt flag ngay — rollback
        ▼
  METRICS (41/184 so quyết — tốt → tăng rollout; xấu → tắt)
```

```
mya: config để bật/tắt tool bằng code— chưa flag động + rollout %
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 129 shadow — sẵn pattern chạy song song (nền)
// ✅ 137 banner CI-CD — deploy đổi model (nền)
// ✅ 178 routing — quyết chọn — flag có thể q/lựa
// ✅ 176 eval/194 — đo sau enable

// ❌ THIẾU: flag store + evaluate (per user/group Tester float any cfg)
// ❌ THIẾU: rollout % + kill switch tức thời
// ❌ THIẾU: experiment metadata (release note, owner — AWS constraint)
```

## Implementation

```typescript
// packages/featureflags/src/flags.ts (NEW)
export class FeatureGate {
  constructor(private store: FlagStore) {}
  async decide(name: string, user: User, agent: AgentCtx): Promise<Flag> {
    const f = await store.get(name);
    if (!f.enabled) return off;
    if (f.kill) return off(f, "kill");                                  // rollback nhanh
    if (rolloutPercent(f, user)) return on(f, f.value);                  // % + nhóm
    return off(f, "not-in-rollout");
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Rollback tức — tool/prompt hỏng tắt mà không deploy | ❌ Flag mọc nhiều — quên xóa → hỗn loạn cấu hình |
| ✅ Ship theo %, thử lại real user (GrowthBook NP) | ❌ Tốt hơn: nới đến hệ thống — cần chủ sạch ổn định |
| ✅ Hạ tầng cho AB/shadow/canary gộp 1 nơi | ❌ Flag bị "always length" — không deploy đều có |
| ✅ Tách chalk + vận — dễ thử AI trong môi trường lạ | ❌ Cần plugin + quyền — ai dám tắt cả? |

## Khác các hướng gần

| | 129 Shadow | 182 A/B-prompt | NNNNNNNN: Flags |
|---|---|---|---|
| Mục | Chạy song song | So prompt | **Bật/tắt mọi thứ runtime** |
| Phạm vi | Một variant | Một biến | **Toàn hệ — hạ tầng** |
| Quan hệ | Một pattern | Một pattern | **Nền cho cả hai** |

## Khi nào chọn

- Agent triển khai rộng với user real — cần an toàn khi đổi
- Tool/prompt/model hay thay — muốn thử nhanh/rollback tức
- Đã có 129 shadow + 41 measure — thêm flag để scale cách thử
- Không khi: hệ đơn user đơn agent — flag là over-engineering