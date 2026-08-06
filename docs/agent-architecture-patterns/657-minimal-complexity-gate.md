# Hướng YG: Minimal Complexity Gate — cấm overcomplexity: mọi complexity thừa bị review chặn lại — gstack map sang /review để bắt unnecessary complexity (gstack/README.md)

> **Nguồn gốc:** andrej-karpathy-skills (gstack/README.md) | **Coupling:** 🟢 — review gate, không đổi runtime | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có council review + eval — chưa có complexity gate) | **Effort:** 1-2 tuần

## Nguồn gốc

**andrej-karpathy-skills** (gstack) có quy tắc: **cấm overcomplexity** — mọi complexity thừa phải bị **review chặn lại**. gstack map rule này sang **`/review`**: mỗi review phải gắn cờ "unnecessary complexity" — config phức tạp không cần thiết, abstraction giả, layer thừa, generic hóa quá sớm. Triết lý: **code đơn giản nhất đạt mục tiêu là chuẩn** — complexity phải được biện minh bằng nhu cầu thật, không phải bằng "sẽ cần sau này".

## Mô tả

mya áp dụng minimal-complexity-gate: trong vòng review (nối 648 XX five-axis), thêm trục **complexity**: đếm "complexity tokens" — class/layer trừu tượng không có caller thật, config option chưa ai dùng, generic type quá rộng, abstraction chỉ có 1 implementation. Ngưỡng: complexity thêm mà không kèm use-case thật → **block review** (hoặc comment nặng). Kèm **prevention**: tool/skill mới khai báo complexity budget (số file, số abstraction) trong manifest — vượt budget bị chặn ở gate. mya có sẵn council (review), eval (gate), skills curator — YG thêm **complexity counter** + **budget check**.

## Kiến trúc

```
  Diff/PR ──► COMPLEXITY GATE
       │
       ├─ đếm: abstraction không caller thật
       │        layer thừa (chỉ 1 impl)
       │        config option chưa dùng
       │        generic quá rộng (any)
       │        file chức năng chồng lấn
       │
       ├─ vượt ngưỡng? ──► BLOCK — "unnecessary complexity"
       │        (yêu cầu: xóa hoặc nêu use-case thật)
       │
       └─ trong budget? ──► PASS (đơn giản = chuẩn)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/council council.ts — review nhiều member (nền — YG chạy trong review)
// ✅ packages/eval harness.ts — gate CI (nền — YG budget check ở gate)
// ✅ packages/skills curator.ts — đánh giá skill mới (nền — YG skill manifest)
// ✅ packages/core iteration-budget.ts — giới hạn vòng (nền — YG budget tương tự)

// ❌ THIẾU: complexity counter (heuristic đếm abstraction/layer)
// ❌ THIẾU: complexity budget manifest (file/abstraction giới hạn)
```

## Implementation (TS)

```typescript
// packages/council/src/complexity-gate.ts (MỚI)
export interface ComplexityReport {
  unusedAbstractions: number;  // interface/class không caller thật
  singleImplLayers: number;    // layer chỉ 1 implementation
  unusedConfig: number;        // config option không code đọc
  overGeneric: number;         // generic quá rộng (any / T extends unknown)
  score: number;
}

const MAX_SCORE = 4; // vượt → block

export function scoreComplexity(source: string, configKeys: string[]): ComplexityReport {
  const unusedAbstractions = (source.match(/^export (interface|abstract class|class) \w+/gm) ?? []).length;
  // heuristic: abstraction chưa có caller → đếm symbol export không import
  const singleImplLayers = (source.match(/^export (class|interface) \w+Layer/gm) ?? []).length;
  const unusedConfig = configKeys.filter((k) => !source.includes(k)).length;
  const overGeneric = (source.match(/<[^>]*\bany\b[^>]*>/g) ?? []).length;
  return {
    unusedAbstractions,
    singleImplLayers,
    unusedConfig,
    overGeneric,
    score: unusedAbstractions + singleImplLayers + unusedConfig + overGeneric,
  };
}

export function gateComplexity(report: ComplexityReport): { pass: boolean; reason?: string } {
  if (report.score > MAX_SCORE) {
    return { pass: false, reason: `unnecessary complexity: ${JSON.stringify(report)} — xóa hoặc nêu use-case thật` };
  }
  return { pass: true };
}

// Usage:
// const rep = scoreComplexity(newCode, manifest.configKeys);
// const g = gateComplexity(rep);
// g.pass || blockReview("Complexity gate", g.reason);
// → abstraction không caller thật bị chặn ở review, không vào main
```

## Được

- ✅ Chặn over-engineering — abstraction/layer thừa không vào codebase
- ✅ Đo được — complexity score máy tính, không cảm tính
- ✅ Budget rõ — manifest khai báo giới hạn từ đầu
- ✅ Kết hợp review — chạy trong council review (648 XX)
- ✅ Phòng thủ "sẽ cần sau" — use-case thật mới qua gate

## Mất

- ❌ Heuristic sai — abstraction có caller qua import động bị đếm nhầm
- ❌ Cản refactor đúng — tách layer hợp lý bị chặn vì vượt budget
- ❌ Budget gaming — nhét complexity vào file không scan tới

## Khác các hướng gần

| | Code review tay | Lint rule (complexity) | YG: Complexity Gate |
|---|---|---|---|
| Cơ chế | người duyệt | rule tĩnh | **score + budget** |
| Bối cảnh | cảm tính | cú pháp | **use-case justification** |
| Chặn lúc | review | commit | **review gate (council)** |

## Khi nào chọn

- Codebase mya dễ bị abstraction thừa (nhiều package, nhiều layer)
- Muốn review chặn complexity có số liệu, không chỉ khuyên
- Có council + eval sẵn — YG thêm counter + budget
- Nối packages/council (chạy trong review) + eval (gate CI) + skills curator (skill manifest budget); guard false-positive (import động/reflection — whitelist pattern), budget-flex (use-case thật được nới budget qua approve), và scope (gate áp cho code mới, không force-refactor code cũ); YG = complexity gate, kết hợp 648 XX five-axis (complexity là trục review) + 656 YF declarative-over-imperative (đơn giản declarative, không layer thừa)
