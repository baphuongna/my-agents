# Hướng EW: Agent Onboarding — khởi tạo agent mới có nền tảng tri thức ngay

> **Nguồn gốc:** DataHub "AI Agent Onboarding: The Missing Discipline" 2026; AgentPatterns "Team Onboarding for AI Agent Workflows" (trust calibration, vocabulary); Microsoft "Building intelligent agents with knowledge sources" (EP07)
> **Coupling:** 🟢 — thêm bước khởi tạo, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (skills + memory + agent spec sẵn; thiếu onboarding pipeline)
> **Effort:** 1 tuần

## Nguồn gốc

Agent onboarding: **agent mới được trang bị tri thức/trust/feedback loop trước khi làm việc** — DataHub: "Onboarding prepares the upstream knowledge, trust signals, and feedback loops the new agent draws from"; AgentPatterns: "Team onboarding aligns a team on shared infrastructure, trust calibration, and vocabulary before individual adoption diverges" — tương tự khi "nhân viên" mới: hiểu văn hóa, chuẩn mực, quy trình trước khi chạy; Microsoft EP07: "agents leverage a breadth of knowledge sources — evaluations are essential". Điểm khác **agent spec (AAAA)** (định nghĩa agent bằng khai báo — static) — XXXXXX *quá trình khởi động có trạng thái*: khi sinh agent mới: nạp spec (AAAA), gắn tri thức nguồn (docs, KB, skills — NNN), cài trust baseline (quyền tối thiểu — UUUU), chạy smoke eval (PP) chứng minh đủ năng lực → mới cho vào fleet (OOOOOO). Giống onboarding nhân viên: chưa qua onboarding không được làm việc thật. Nối AAAA (spec), NNN (registry skill), UUUU (perms baseline), PP (smoke eval gate), OOOOOO (fleet — nơi agent vào), FFFFFF (version spec).

## Mô tả

mya onboarding: (1) **nạp spec + tri thức** — agent mới từ AAAA spec: gắn knowledge sources (docs/API/skills), prompt hệ thống, giới hạn quyền (UUUU — least-privilege lúc đầu); (2) **vocabulary/chuẩn mực** — nạp thuật ngữ, conventions, quy trình của tổ chức (AgentPatterns: align vocabulary trước khi lệch); (3) **trust calibration** — bắt đầu quyền hẹp, làm tốt mới mở rộng (camera: UUUU dynamic theo lịch sử tốt); (4) **smoke eval** — PP: task đại diện nhỏ chứng minh agent hiểu tri thức + dùng tool đúng (JJJJJ) → đạt mới vào fleet; (5) **feedback loop sẵn** — nối VV audit + RRRRRR flywheel ngay từ đầu (dữ liệu onboarding agent ghi lại); (6) **downgrade/dừng** — agent không qua onboarding lần 2 (re-onboard khi thay đổi lớn — FFFFFF version spec mới cần re-eval).

## Kiến trúc

```
  AGENT MỚI (AAAA spec) ──► ONBOARDING PIPELINE
        │
  ┌─────┼──────────────────────────────┐
  ▼     ▼                              ▼
 TRI THỨC   VOCABULARY/CHUẨN MỰC     TRUST BASELINE
 (docs/KB/   (thuật ngữ · conventions  (UUUU — quyền hẹp trước,
  skills NNN) · quy trình)             làm tốt mới mở rộng)
        │
        ▼
  SMOKE EVAL (PP + JJJJJ): hiểu tri thức · dùng tool đúng
        │
   ĐẠT ─────────────► VÀO FLEET (OOOOOO)
  KHÔNG ──► sửa spec/tri thức → onboard lại (FFFF version)
        │
        ▼
  FEEDBACK TỪ ĐẦU: VV audit + RRRRRR flywheel (agent mới học ngay)
```

```
mya: AAAA + NNN + PP SẸN — thiếu: onboarding pipeline + trust calibration
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ AAAA agent spec — khai báo agent (đầu vào onboarding)
// ✅ NNN skill registry — gắn tri thức/skills
// ✅ UUUU dynamic perms — trust baseline (quyền hẹp → rộng)
// ✅ PP eval + JJJJJ tool bench — smoke eval
// ✅ OOOOOO fleet — nơi agent vào sau onboarding
// ✅ VV + RRRRRR — feedback loop từ đầu

// ❌ THIẾU: onboarding pipeline (thứ tự nạp + gate)
// ❌ THIẾU: vocabulary/conventions store
// ❌ THIẾU: re-onboard trigger (spec đổi lớn → re-eval)
```

## Implementation

```typescript
// packages/onboarding/src/pipeline.ts (NEW)
export class Onboarding {
  async onboard(spec: AgentSpec): Promise<Agent> {
    const a = await this.spawn(spec);                // AAAA
    await this.attachKnowledge(a, spec.knowledge);   // NNN — docs/skills
    await this.teachVocabulary(a, conventions);      // AgentPatterns
    await this.setTrust(a, baseline);                // UUUU — hẹp trước
    const ok = await this.smokeEval(a);              // PP + JJJJJ — gate
    if (!ok) return this.retry(a);                   // sửa spec → lại
    return fleet.add(a);                             // OOOOOO
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent mới làm việc đúng ngay (không "nháo" như agent chưa hiểu gì) | ❌ Thêm bước khởi tạo (chậm sinh agent) |
| ✅ Trust calibration — quyền mở dần theo năng lực (UUUU) | ❐ Tri thức nguồn thay đổi → re-onboard |
| ✅ Smoke eval gate — agent thiếu năng lực không vào fleet | ❌ Vocabulary store cần duy trì |
| ✅ Xây trên AAAA + NNN + PP | ❌ Onboarding nhẹ cũng đủ với agent đơn giản |

## Khác các hướng gần

| | AAAA Agent Spec | NNN Tool Registry | XXXXXX: Onboarding |
|---|---|---|---|
| Trạng thái | Tĩnh (khai báo) | Tĩnh (danh mục) | **Quá trình khởi động** |
| Mục đích | Định nghĩa agent | Tool có sẵn | **Trang bị + gate trước khi dùng** |
| Quan hệ | Đầu vào | Thành phần | **Dùng cả 2 + eval gate** |

## Khi nào chọn

- Sinh agent mới thường xuyên (fleet OOOOOO) — cần agent "biết việc" ngay
- Agent làm task tri thức nhiều — cần nạp KB + chuẩn mực trước
- Đã có AAAA + NNN + PP + UUUU — thêm pipeline + gate
- Muốn trust mở dần — không cấp full quyền ngay lúc sinh