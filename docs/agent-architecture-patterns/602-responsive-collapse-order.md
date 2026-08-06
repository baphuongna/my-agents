# Hướng WD: Responsive Collapse Order — segment statusbar nhóm theo collapse_order để ẩn giảm khi terminal hẹp; collapsed_template là fallback

> **Nguồn gốc:** pi-bar (responsive collapse order); "group statusbar segments by collapse_order"; "hide progressively when terminal narrows"; "collapsed_template as fallback"; "responsive width adaptation" | **Coupling:** 🟢 — thêm collapse-order grouping vào statusbar render | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (statusbar + print sẵn — chưa có collapse-order responsive) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-bar** statusbar có nhiều **segment** (model name, token count, git branch, time, cost...). Khi **terminal hẹp** (width nhỏ), không đủ chỗ hiện hết → **tràn dòng / cắt xấu**. Giải pháp **responsive collapse order**: mỗi segment có **collapse_order** (độ ưu tiên ẩn) — segment **collapse_order cao ẩn trước**, thấp ẩn sau. Khi terminal hẹp dần, segment ẩn dần theo thứ tự. Khi segment bị ẩn, dùng **collapsed_template** (fallback ngắn — vd git branch đầy đủ → chỉ icon `⎇`, hoặc ẩn hoàn toàn). Nguyên tắc: **graceful degradation by priority**. Khác truncate (cắt text đột ngột) — WD **priority-based hide + fallback template**.

## Mô tả

mya responsive collapse order: (1) **Segment + collapse_order**: mỗi statusbar segment có priority (0=critical, luôn hiện; 1,2,3=ẩn dần). (2) **Width measure**: đo terminal width, tính tổng segment width. (3) **Progressive hide**: nếu overflow, ẩn segment collapse_order cao nhất trước (collapsed_template hoặc ẩn hoàn toàn). (4) **collapsed_template**: segment bị ẩn hiển thị fallback ngắn (vd `[g] main` → `⎇`). (5) **Render**: chỉ segment còn fit width được render đầy đủ. mya có statusbar + print — WD thêm **collapse-order grouping** + **collapsed_template fallback**.

## Kiến trúc

```
  STATUSBAR SEGMENTS (mỗi segment có collapse_order)
  ┌─────────────────────────────────────────────────────────┐
  │  [model]   order=0  width=12  "gpt-4"      (critical)    │
  │  [tokens]  order=0  width=15  "1.2k/8k"    (critical)    │
  │  [git]     order=1  width=18  "⎇ main ↑3"  (hide 1st)    │
  │  [time]    order=2  width=10  "14:32"      (hide 2nd)    │
  │  [cost]    order=3  width=12  "$0.42"      (hide 3rd)    │
  └─────────────────────────────────────────────────────────┘

  WIDE terminal (80 cols): hiện hết
  │ gpt-4 │ 1.2k/8k │ ⎇ main ↑3 │ 14:32 │ $0.42 │

  NARROW (50 cols): overflow → hide order=3 first
  │ gpt-4 │ 1.2k/8k │ ⎇ main ↑3 │ 14:32 │

  NARROWER (35 cols): hide order=2 → git dùng collapsed_template
  │ gpt-4 │ 1.2k/8k │ ⎇ │           (collapsed: "⎇")

  TINY (20 cols): hide order=1 → chỉ critical
  │ gpt-4 │ 1.2k/8k │
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/print — statusbar/print (nền — WD render ở đây)
// ✅ packages/print laneboard.ts — laneboard (nền — WD segment relate)
// ✅ packages/core telemetry.ts — metrics (nền — WD segment data source)
// ✅ packages/tools frecency.ts — frecency (relate — WD segment ordering)

// ❌ THIẾU: collapse_order per segment (priority hide)
// ❌ THIẾU: progressive-hide logic (width → ẩn theo order)
// ❌ THIẾU: collapsed_template (fallback ngắn khi ẩn)
```

## Implementation

```typescript
// packages/print/src/responsive-collapse.ts (MỚI)

interface Segment {
  name: string;
  collapseOrder: number;           // 0 = critical (luôn hiện), cao = ẩn trước
  render: () => string;            // full content
  collapsedTemplate?: () => string; // fallback ngắn (nếu có)
  minWidth: number;                // width tối thiểu để hiện
}

class ResponsiveCollapseOrder {
  constructor(private segments: Segment[]) {}

  // measure + render: ẩn segment theo collapse_order đến khi fit
  render(terminalWidth: number): string {
    // sort by collapse_order (cao ẩn trước)
    const sorted = [...this.segments].sort((a, b) => a.collapseOrder - b.collapseOrder);
    // tính width, ẩn segment overflow theo thứ tự
    const visible: Segment[] = [];
    let usedWidth = 0;
    for (const seg of sorted) {
      const w = seg.render().length + 1;  // +1 separator
      if (usedWidth + w <= terminalWidth) {
        visible.push(seg);
        usedWidth += w;
      } else if (seg.collapsedTemplate) {
        // thử collapsed_template (ngắn hơn)
        const cw = seg.collapsedTemplate().length + 1;
        if (usedWidth + cw <= terminalWidth) {
          visible.push({ ...seg, render: seg.collapsedTemplate! });
          usedWidth += cw;
        }
        // không fit cả collapsed → ẩn hoàn toàn
      }
      // không fit → ẩn (không thêm vào visible)
    }
    // render visible theo thứ tự gốc (không phải collapse_order)
    const order = this.segments.filter(s => visible.some(v => v.name === s.name));
    return order.map(s => {
      const v = visible.find(x => x.name === s.name)!;
      return v.render();
    }).join(' │ ');
  }
}
// Usage:
// const bar = new ResponsiveCollapseOrder([
//   {name:'model', collapseOrder:0, render:()=>'gpt-4', minWidth:5},
//   {name:'git', collapseOrder:1, render:()=>'⎇ main ↑3', collapsedTemplate:()=>'⎇', minWidth:1},
//   {name:'cost', collapseOrder:3, render:()=>'$0.42', minWidth:5},
// ]);
// bar.render(80);  // wide → full
// bar.render(20);  // tiny → chỉ model
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Graceful degradation (hẹp → ẩn theo priority) | ❌ Width calc complexity (mỗi segment width khác nhau) |
| ✅ No truncation (ẩn sạch, không cắt text xấu) | ❌ Info loss (segment ẩn → user thiếu context) |
| ✅ Collapsed fallback (icon ngắn thay vì ẩn hết) | ❌ Order tuning (collapse_order sai → ẩn nhầm critical) |
| ✅ Critical preserved (order=0 luôn hiện) | ❌ Re-render cost (resize terminal → re-render mỗi lần) |

## Khác các hướng gần

| | Truncate | Fixed layout | WD: Collapse-Order |
|---|---|---|---|
| Hẹp | Cắt text đột ngột | Tràn dòng | **Priority hide + fallback** |
| Critical | Có thể bị cắt | ⚠ | **✅ luôn hiện (order=0)** |
| Fallback | ❌ | ❌ | **collapsed_template** |

## Khi nào chọn

- Statusbar nhiều segment, terminal width thay đổi (resize / narrow terminal)
- Muốn graceful degradation (ẩn theo priority, không truncate xấu)
- Cần critical segment luôn hiện (order=0)
- Nối packages/print + laneboard.ts + packages/core telemetry.ts; guard width-accuracy (đo đúng terminal width), collapse-order-sanity (critical=0, decorative=cao), và collapsed-template-quality (fallback đủ ý nghĩa, không mơ hồ); WD = responsive collapse order, kết hợp 603 WE template-eval-token-mix (segment content = template/eval — WD quyết định hiện/ẩn) + packages/print (statusbar infra sẵn)
