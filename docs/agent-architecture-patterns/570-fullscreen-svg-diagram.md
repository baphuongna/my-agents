# Hướng UX: Fullscreen SVG Diagram — html-diagram: artifact HTML fullscreen, SVG-first, tối thiểu prose cho sơ đồ kiến trúc

> **Nguồn gốc:** effective-html `html-diagram/` (`artifact.html`, SVG-first); "fullscreen SVG artifact"; "minimal prose for architecture diagrams"; "SVG-first not canvas/img"; "diagram as interactive HTML artifact" | **Coupling:** 🟢 — thêm html-diagram tool/generator vào tools (artifact HTML fullscreen + SVG-first) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (tools + print sẵn — chưa có SVG-diagram artifact generator) | **Effort:** 2-3 tuần

## Nguồn gốc

**effective-html** khi vẽ sơ đồ kiến trúc không xuất ảnh (PNG/Canvas) — mà sinh **artifact HTML fullscreen** với **SVG-first** (vector, scalable, inspectable). Nguyên tắc: (1) **SVG-first** — vector crisp mọi zoom, không raster mờ; (2) **fullscreen** — chiếm toàn viewport, đủ lớn đọc; (3) **minimal prose** — sơ đồ là visual, text chỉ label ngắn, không văn dài chèn; (4) **inspectable** — SVG là DOM, user hover/click inspect node. Khách prose-heavy diagram — UX **visual-first SVG artifact**.

## Mô tả

mya fullscreen SVG diagram: (1) **Generate**: agent mô tả kiến trúc → sinh artifact HTML (SVG-first). (2) **Fullscreen**: artifact chiếm toàn viewport (responsive). (3) **SVG**: nodes + edges là SVG element (vector, scalable). (4) **Minimal prose**: label ngắn, prose dài → tooltip/side-panel (không chèn trong diagram). (5) **Interactive**: hover/click inspect node detail. mya có tools + print — UX thêm **SVG-diagram generator** + **fullscreen artifact** + **minimal-prose constraint**.

## Kiến trúc

```
  AGENT: "vẽ sơ đồ kiến trúc mya (core → tools → transport)"
        │ (html-diagram generator)
        ▼
  ┌─── ARTIFACT HTML (fullscreen, SVG-first) ────────────┐
  │  <html fullscreen>                                     │
  │    <svg viewBox="0 0 1000 600">                        │
  │      <rect> core </rect>                               │
  │      <line core→tools>                                 │
  │      <rect> tools </rect>  (label NGẮN, không prose)   │
  │      <line tools→transport>                            │
  │    </svg>                                              │
  │  </html>                                               │
  └───────────────────────┬─────────────────────────────┘
                          │ (SVG-first: vector, fullscreen)
                          ▼
  USER xem: fullscreen, zoom vô hạn crisp, click node → detail
  (minimal prose: label ngắn, detail → tooltip/side-panel)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/tools — tool registry (nền — UX html-diagram tool)
// ✅ packages/print — output rendering (nền — UX artifact render)
// ✅ packages/web — HTML render (nền — UX fullscreen)

// ❌ THIẾU: SVG-diagram generator (arch desc → SVG nodes/edges)
// ❌ THIẾU: fullscreen artifact template (HTML fullscreen + SVG)
// ❌ THIẾU: minimal-prose constraint (label ngắn, detail tooltip)
// ❌ THIẾU: node interactivity (hover/click inspect)
```

## Implementation

```typescript
// packages/tools/src/html-diagram.ts (MỚI)
interface DiagramNode { id: string; label: string; detail?: string; x: number; y: number }
interface DiagramEdge { from: string; to: string; label?: string }

interface DiagramSpec { nodes: DiagramNode[]; edges: DiagramEdge[]; title: string }

class HtmlDiagram {
  // generate fullscreen SVG-first artifact HTML
  render(spec: DiagramSpec): string {
    const esc = (s: string) => s.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));
    const nodes = spec.nodes.map(n =>
      `    <g class="node" data-detail="${esc(n.detail ?? '')}">` +
      `      <rect x="${n.x}" y="${n.y}" width="120" height="50" rx="8" fill="#1e293b" stroke="#38bdf8"/>` +
      `      <text x="${n.x + 60}" y="${n.y + 30}" text-anchor="middle" fill="#e2e8f0" font-size="13">${esc(n.label)}</text>` +
      `    </g>`,
    ).join('\n');
    const edges = spec.edges.map(e => {
      const f = spec.nodes.find(n => n.id === e.from)!;
      const t = spec.nodes.find(n => n.id === e.to)!;
      return `    <line x1="${f.x + 60}" y1="${f.y + 50}" x2="${t.x + 60}" y2="${t.y}" stroke="#475569" marker-end="url(#arrow)"/>`;
    }).join('\n');
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(spec.title)}</title>
<style>html,body{margin:0;height:100%;background:#0f172a;font-family:system-ui}svg{width:100%;height:100%}.node{cursor:pointer}.node:hover rect{stroke:#fbbf24}#detail{position:fixed;right:16px;bottom:16px;max-width:320px;background:#1e293b;color:#e2e8f0;padding:12px;border-radius:8px;display:none}</style></head>
<body>
<svg viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid meet">
  <defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="#475569"/></marker></defs>
${nodes}
${edges}
</svg>
<div id="detail"></div>
<script>document.querySelectorAll('.node').forEach(g=>{g.addEventListener('click',()=>{const d=document.getElementById('detail');d.textContent=g.getAttribute('data-detail')||'(no detail)';d.style.display='block';});});</script>
</body></html>`;
  }

  // minimal-prose guard: label phải ngắn (≤ 24 chars)
  validate(spec: DiagramSpec): string[] {
    const issues: string[] = [];
    for (const n of spec.nodes) if (n.label.length > 24) issues.push(`label too long: "${n.label}" (move detail to .detail)`);
    return issues;
  }
}

// Usage:
// const dg = new HtmlDiagram();
// const html = dg.render({ title:'mya arch', nodes:[…], edges:[…] });
// fs.writeFileSync('diagram.html', html); // fullscreen SVG artifact
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ SVG vector (crisp mọi zoom, scalable) | ❌ Layout complexity (auto-layout node/edge khó) |
| ✅ Fullscreen (đủ lớn đọc sơ đồ phức tạp) | ❌ Generator quality (SVG sinh sai cấu trúc) |
| ✅ Minimal prose (visual-first, không text chèn) | ❌ Detail hidden (tooltip → user phải click) |
| ✅ Interactive (hover/click inspect node) | ❌ Accessibility (SVG cần ARIA label) |

## Khác các hướng gần

| | packages/print | 126 Multimodal | UX: Fullscreen-SVG-Diagram |
|---|---|---|---|
| Cái gì | Render text | Input đa phương tiện | **Artifact HTML SVG-first** |
| Format | Text | Image/audio | **SVG vector** |
| Prose | Full | ❌ | **minimal (label ngắn)** |

## Khi nào chọn

- Cần sơ đồ kiến trúc visual (không phải văn mô tả)
- Muốn SVG vector (crisp zoom, inspectable DOM)
- Sơ đồ phức tạp cần fullscreen (nhiều node/edge)
- Nối packages/tools + packages/print + packages/web; guard auto-layout (node không chồng), minimal-prose enforcement (label ngắn), và accessibility (ARIA, keyboard nav); UX = fullscreen SVG diagram, kết hợp 523 code-community-detection (graph → visualize) + UW multi-harness-packaging (artifact đóng gói cross-harness)
