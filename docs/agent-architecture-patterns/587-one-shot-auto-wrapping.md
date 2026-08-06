# Hướng VO: One-Shot Auto-Wrapping — auto mode chỉ bọc prompt tiếp theo; per-session switch dùng xong là tắt để tránh overhead nền

> **Nguồn gốc:** pi-boomerang (one-shot auto-wrapping); "auto mode wraps only the next prompt"; "per-session switch off after use"; "no persistent background overhead"; "transient auto-wrap" | **Coupling:** 🟢 — thêm transient auto-wrap flag vào dispatch | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (prompt dispatch sẵn — chưa có one-shot auto-wrap + auto-off) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-boomerang** có chế độ **auto** (tự bọc prompt với template/skill). Nhưng auto **persistent** (bật mãi) gây **overhead nền** — mỗi prompt đều bị wrap dù không cần. Giải pháp: **one-shot auto-wrapping** — auto mode **chỉ bọc prompt tiếp theo** (1 lần), sau đó **tự tắt**. Hoặc **per-session switch**: bật cho session, dùng xong tự off để tránh overhead. Nguyên tắc: **wrap khi cần, tắt khi xong** — không giữ auto chạy nền vô cớ. Khác **auto persistent** (luôn wrap) — VO **transient (1-shot)**; khác manual wrap — VO **auto (user không gõ template)**.

## Mô tả

mya one-shot auto-wrapping: (1) **Auto-wrap flag**: dispatch có `autoWrap: 'one-shot' | 'session' | 'off'`. (2) **One-shot**: nếu one-shot → **chỉ wrap prompt kế tiếp**, sau đó **reset về off**. (3) **Session**: nếu session → wrap cả session, **dùng xong (task hoàn thành) tự off**. (4) **Off**: mặc định off (không overhead nền). mya có prompt dispatch — VO thêm **transient auto-wrap flag** + **auto-off logic**.

## Kiến trúc

```
  USER: "auto" (one-shot) → gõ prompt kế tiếp
        │
        ▼
  ┌─── ONE-SHOT WRAP (chỉ prompt kế tiếp) ────────────────┐
  │  autoWrap = 'one-shot'                                 │
  │  prompt kế tiếp → WRAP (template + skill)             │
  │  dispatch wrapped prompt                                │
  │  → SAU KHI dispatch: autoWrap = 'off' (AUTO-OFF)       │
  └───────────────────────┬─────────────────────────────┘
                          │ (prompt sau)
                          ▼
  ┌─── KHÔNG WRAP (đã off) ───────────────────────────────┐
  │  autoWrap = 'off' (đã reset)                           │
  │  prompt sau → dispatch THÔ (không overhead)            │
  │  → tránh wrap nền vô cớ                                 │
  └───────────────────────────────────────────────────────┘

  PER-SESSION: autoWrap='session' → wrap cả session,
               nhưng task xong → AUTO-OFF (không kẹt)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ prompt dispatch — send prompt (nền — VO = wrap layer)
// ✅ 586 per-step-model-switching (VN) — transient switch (relate — VO = transient wrap)
// ✅ template/skill injection — wrap (nền — VO = auto-wrap)

// ❌ THIẾU: autoWrap flag ('one-shot' | 'session' | 'off')
// ❌ THIẾU: auto-off logic (one-shot reset / session task-done off)
// ❌ THIẾU: wrap-if-flag (chỉ wrap khi flag on)
```

## Implementation

```typescript
// packages/agent/src/one-shot-auto-wrap.ts (MỚI)
type AutoWrapMode = 'off' | 'one-shot' | 'session';

class OneShotAutoWrapping {
  private mode: AutoWrapMode = 'off';
  constructor(
    private wrap: (prompt: string) => string,  // template/skill wrap
  ) {}

  setMode(mode: AutoWrapMode): void { this.mode = mode; }

  // dispatch: wrap nếu mode on, rồi auto-off
  dispatch(prompt: string, onTaskComplete?: () => void): string {
    let out = prompt;
    if (this.mode === 'one-shot') {
      out = this.wrap(prompt);
      this.mode = 'off'; // AUTO-OFF sau 1 lần
    } else if (this.mode === 'session') {
      out = this.wrap(prompt);
      // session: off khi task hoàn thành (caller báo)
      if (onTaskComplete) this.mode = 'off';
    }
    return out; // mode='off' → không wrap (thô)
  }

  // caller báo task xong (session mode → off)
  taskComplete(): void { this.mode = 'off'; }
}

// Usage:
// wrapper.setMode('one-shot');
// dispatch("fix the bug")  → wrap → dispatch → AUTO-OFF
// dispatch("run tests")    → off → dispatch thô (no overhead)
// wrapper.setMode('session'); ... wrapper.taskComplete(); // off sau khi xong
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Wrap khi cần (không overhead nền) | ❌ User phải re-enable (quên → không wrap) |
| ✅ Auto-off (không kẹt auto mãi) | ❌ One-shot bất tiện (mỗi lần phải set) |
| ✅ Cost-aware (wrap tốn token, chỉ khi cần) | ❌ State confusion (user tưởng còn on) |
| ✅ Linh hoạt (one-shot / session / off) | ❌ Wrap quality (auto-wrap kém manual) |

## Khác các hướng gần

| | Auto persistent | Manual wrap | VO: One-Shot-Auto-Wrap |
|---|---|---|---|
| Khi | Luôn (mọi prompt) | User gõ | **1-shot / session (auto-off)** |
| Overhead | Nền liên tục | 0 (user chủ động) | **Chỉ khi flag on** |
| Off | Manual | — | **✅ auto-off** |

## Khi nào chọn

- Auto wrap tốn token → chỉ muốn wrap khi cần, không nền
- User hay quên tắt auto → cần auto-off (one-shot / session)
- Muốn cost-aware (wrap transient, không persistent)
- Nối prompt dispatch + 586 per-step-model-switching (transient switch, relate) + template/skill injection; guard state clarity (cho user biết mode hiện tại), one-shot ergonomics (re-enable dễ), và wrap quality (auto-wrap đủ tốt để tin); VO = one-shot auto-wrapping, kết hợp 586 VN (transient model switch, cùng triết lý dùng xong tắt) + template injection
