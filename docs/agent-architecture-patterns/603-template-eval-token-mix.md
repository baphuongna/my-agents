# Hướng WE: Template Eval Token Mix — segment nội dung mix template {token} và eval JS expr; show_if điều khiển render

> **Nguồn gốc:** pi-bar (template eval token mix); "segment content mixes template {token} and eval JS expression"; "show_if controls render visibility"; "dynamic segment via template + eval"; "hybrid static/dynamic segment content" | **Coupling:** 🟢 — thêm template+eval render engine vào statusbar segment | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (print/template sẵn — chưa có eval expr + show_if) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-bar** segment statusbar không chỉ text tĩnh — nội dung **mix 2 loại**: (1) **Template `{token}`** — thay thế token bằng giá trị (vd `{model}` → "gpt-4", `{tokens}` → "1.2k"). (2) **Eval JS expression** — tính toán động (vd `{tokens > 6000 ? '⚠' : ''}` → cảnh báo khi gần full). Thêm **`show_if`** — condition kiểm soát **segment có render hay không** (vd `show_if: git.branch !== null` → chỉ hiện git segment khi trong repo). Nguyên tắc: **hybrid static template + dynamic eval + conditional render**. Khác pure template (chỉ thay token) — WE **eval expression**; khác hardcoded logic (logic trong code) — WE **declarative in segment config**.

## Mô tả

mya template eval token mix: (1) **Template tokens**: `{model}`, `{tokens}`, `{branch}` — thay bằng runtime value. (2) **Eval expression**: `{JS expr}` — tính động (vd `{cost > 1 ? '💰' : ''}`). (3) **show_if**: condition boolean → segment hiện/ẩn (vd `show_if: tokens > 0`). (4) **Render engine**: parse template → replace token → eval expr → check show_if → output string. (5) **Sandbox eval**: JS expr chạy trong safe scope (chỉ thấy token vars, không global). mya có print + template — WE thêm **eval engine** + **show_if gate** + **token scope**.

## Kiến trúc

```
  SEGMENT CONFIG (declarative — template + eval + show_if)
  ┌─────────────────────────────────────────────────────────┐
  │  name: "tokens"                                           │
  │  content: "{used}/{max} {used > max*0.8 ? '⚠' : ''}"     │
  │           ├── template: {used} {max} → replace           │
  │           └── eval: used > max*0.8 ? '⚠' → compute       │
  │  show_if: "used > 0"                                      │
  │           └── condition → segment hiện/ẩn                │
  └───────────────────────────┬─────────────────────────────┘
                              │ (render engine)
                              ▼
  ┌─── RENDER PIPELINE ────────────────────────────────────┐
  │  1. scope = {model:'gpt-4', used:6500, max:8000, ...}    │
  │  2. show_if: "used > 0" → 6500 > 0 → true → render       │
  │  3. template: {used}/{max} → "6500/8000"                 │
  │  4. eval: 6500 > 8000*0.8 (6400) → true → '⚠'            │
  │  5. output: "6500/8000 ⚠"                                 │
  │                                                            │
  │  (if show_if false → skip, segment ẩn)                    │
  └───────────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/print — print/render (nền — WE render engine ở đây)
// ✅ packages/print laneboard.ts — segment (nền — WE segment config)
// ✅ packages/core telemetry.ts — metrics (nền — WE token scope data)
// ✅ packages/core canonical-json.ts — JSON (nền — WE config parse)

// ❌ THIẾU: eval expression engine (sandbox JS expr trong token scope)
// ❌ THIẾU: show_if gate (condition → render/hidden)
// ❌ THIẾU: template+eval mixer (parse {token} + {expr} trong cùng string)
```

## Implementation

```typescript
// packages/print/src/template-eval-token.ts (MỚI)

interface SegmentConfig {
  name: string;
  content: string;        // mix {token} + {JS expr}
  showIf?: string;        // JS condition → boolean
}

// token scope: runtime values available cho template/eval
type Scope = Record<string, string | number | boolean | null>;

class TemplateEvalTokenMix {
  // render: template + eval + show_if → output string (hoặc null nếu hidden)
  render(config: SegmentConfig, scope: Scope): string | null {
    // 1. show_if gate
    if (config.showIf && !this.evalSafe(config.showIf, scope)) return null;  // hidden
    // 2. mix: thay {token} + eval {expr}
    let output = config.content;
    // eval expressions: {JS expr} (chứa operator) → compute
    output = output.replace(/\{([^{}]*[<>!=+\-*/?][^{}]*)\}/g, (_, expr) => {
      const val = this.evalSafe(expr, scope);
      return val !== undefined ? String(val) : '';
    });
    // template tokens: {name} (không có operator) → replace
    output = output.replace(/\{(\w+)\}/g, (_, key) => {
      return scope[key] !== undefined ? String(scope[key]) : `{${key}}`;
    });
    return output;
  }
  // safe eval: JS expr trong sandbox scope (chỉ thấy scope vars)
  private evalSafe(expr: string, scope: Scope): unknown {
    try {
      const keys = Object.keys(scope);
      const vals = Object.values(scope);
      // Function constructor → sandbox (scope vars as params, no global access)
      const fn = new Function(...keys, `"use strict"; return (${expr});`);
      return fn(...vals);
    } catch {
      return undefined;  // eval error → empty
    }
  }
}
// Usage:
// const engine = new TemplateEvalTokenMix();
// const seg: SegmentConfig = {
//   name: 'tokens',
//   content: '{used}/{max} {used > max*0.8 ? "⚠" : ""}',
//   showIf: 'used > 0',
// };
// const scope = { model:'gpt-4', used:6500, max:8000 };
// engine.render(seg, scope);  // → "6500/8000 ⚠"
// // if used=0 → show_if false → null (hidden)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Dynamic content (eval expr tính động, không hardcoded) | ❌ Eval security (Function constructor — cần sandbox chặt) |
| ✅ Conditional render (show_if → hiện/ẩn linh hoạt) | ❌ Eval errors (expr sai → silent empty, khó debug) |
| ✅ Declarative config (template+eval trong segment, không code) | ❌ Performance (eval mỗi render frame) |
| ✅ Hybrid mix (template tĩnh + eval động cùng string) | ❌ Complexity (debug template+eval+show_if cùng lúc) |

## Khác các hướng gần

| | Pure template | Hardcoded logic | WE: Template-Eval-Token-Mix |
|---|---|---|---|
| Dynamic | ❌ (chỉ thay token) | ✅ (nhưng trong code) | **eval expr (declarative)** |
| Conditional | ❌ | Code if/else | **show_if (config)** |
| Config | Template only | Code recompile | **declarative (template+eval+show_if)** |

## Khi nào chọn

- Segment cần dynamic content (eval expr: warning icon, computed value)
- Muốn conditional render (show_if: segment hiện/ẩn theo runtime)
- Cần declarative config (template+eval trong segment config, không sửa code)
- Nối packages/print + laneboard.ts + packages/core telemetry.ts; guard eval-sandbox (Function constructor chặn global access, chỉ scope vars), eval-error-handling (silent fail → empty, không crash), và show_if-safety (condition không có side-effect); WE = template eval token mix, kết hợp 602 WD responsive-collapse-order (collapse quyết định hiện/ẩn — WE show_if cũng quyết định, kết hợp 2 layer) + packages/print (render infra sẵn)
