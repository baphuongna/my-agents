# Hướng AJA: Guide Review Takeover-UI — Guided Review render chaptered review (core → consequences → glue) dưới dạng screen takeover; file tree/dock bị CSS-hidden (không unmount), Reviewed checkbox collapse không bao giờ un-mark

> **Nguồn gốc:** plannotator | **Coupling:** 🟡 — UI layer (gateway/web) | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có web dashboard; chưa có review takeover) | **Effort:** 2 tuần

## Nguồn gốc

**plannotator** Guided Review render **chaptered review** (**core implementation → consequences → glue**) dưới dạng **screen takeover**: **file tree/dock bị CSS-hidden (không unmount)** — state UI giữ nguyên, chỉ ẩn visual; mỗi section có **markdown overview + annotatable per-file diff**; **Reviewed checkbox collapse với peek-to-re-expand không bao giờ un-mark** — user đã review xong một section, collapse để xem tiếp, peek mở lại xem nhanh — nhưng checkbox Reviewed giữ nguyên (không phải re-review).

Nguyên tắc: **takeover = CSS-hide, không unmount** — ẩn UI cũ bằng style, giữ state/DOM (unmount mất state, remount chậm); **review theo chapter có tiến độ rõ** — mỗi section checkbox Reviewed là commit không thể mất; **peek-to-re-expand** — xem nhanh nội dung đã review mà không phá trạng thái Reviewed.

## Mô tả

Với mya, pattern = **review surface trong web dashboard**: (1) **gateway serve review state** — route mới trả chaptered review (core/consequences/glue — nối `/pool/tree` subagent structure + AIZ recap); (2) **web/src (packages/web)** render screen takeover: file tree/dock **CSS-hidden** (class ẩn — không unmount React component, giữ state selection); (3) **mỗi chapter**: markdown overview (nối `packages/prompts`/render markdown) + **annotatable per-file diff** (nối `hashline-edit` hoặc diff view — `packages/tools hashline.ts` hash-anchored); (4) **Reviewed checkbox** — state per chapter persist (nối memory/audit), **collapse không un-mark**; **peek** mở preview tạm thời, đóng lại vẫn Reviewed; (5) **gateway broadcast** — review progress sync qua WS (nối `wire-envelope` + collab relay pattern). Đây là **human-in-the-loop review UX**: agent làm, người review duyệt từng chapter có bằng chứng diff.

## Kiến trúc (ASCII)

```
  REVIEW START (gateway route — chaptered: core → consequences → glue)
    │
    ▼ SCREEN TAKEOVER (packages/web)
    ├─ file tree / dock ──► CSS-HIDDEN (không unmount — giữ state DOM)
    └─ review panel hiện
         ├─ CHAPTER 1: core implementation
         │    ├─ markdown overview
         │    └─ annotatable per-file diff
         │    └─ [x] Reviewed  ──► collapse
         │         └─ PEEK ──► mở xem nhanh ──► đóng ──► VẪN Reviewed
         ├─ CHAPTER 2: consequences
         ├─ CHAPTER 3: glue
         └─ (Reviewed không bao giờ un-mark bởi collapse/peek)
    ▼
  REVIEW PROGRESS sync qua WS (wire-envelope) + persist (memory/audit)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/web — React dashboard (App.tsx, pages/, components/) — nền UI
// ✅ packages/gateway — WS broadcast + wire-envelope (sync review progress)
// ✅ packages/tools hashline.ts — hash-anchored diff (nền annotatable diff)
// ✅ packages/gateway collab relay (relay.ts) — room publish (nền review sharing)
// ✅ packages/memory + audit — persist review state (checkbox Reviewed)
// ✅ packages/print agents-panel.ts — panel/takeover pattern (CSS overlay)

// ❌ THIẾU: review takeover component (chaptered + checkbox)
// ❌ THIẾU: CSS-hide file tree (giữ state, không unmount)
// ❌ THIẾU: peek-to-re-expand không un-mark Reviewed
```

## Implementation

```typescript
// packages/web/src/components/ReviewTakeover.tsx (NEW — sketch)
export type ReviewChapter = { id: string; title: string; overview: string; files: string[] };

export function ReviewTakeover({ chapters }: { chapters: ReviewChapter[] }) {
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({});
  const [peek, setPeek] = useState<string | null>(null);
  // CSS-hide file tree: thêm class "review-takeover" vào root — tree ẩn bằng
  // style, KHÔNG unmount (giữ state selection của tree).
  useEffect(() => {
    document.body.classList.add("review-takeover");
    return () => document.body.classList.remove("review-takeover");
  }, []);

  return (
    <div className="review-chapters">
      {chapters.map((ch) => (
        <section key={ch.id} className="review-chapter">
          <header>
            <input
              type="checkbox"
              checked={reviewed[ch.id] ?? false}
              onChange={(e) => setReviewed((r) => ({ ...r, [ch.id]: e.target.checked }))}
            />
            <strong>{ch.title}</strong>
            <button onClick={() => setPeek(peek === ch.id ? null : ch.id)}>
              {peek === ch.id ? "Thu gọn" : "Peek"}
            </button>
          </header>
          {/* collapse chỉ ẩn body — checkbox reviewed giữ nguyên */}
          {(reviewed[ch.id] || peek === ch.id) && (
            <div className="review-body">
              <div className="markdown">{ch.overview}</div>
              {ch.files.map((f) => <DiffView key={f} path={f} />)}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
// CSS: .review-takeover .file-tree { display: none; } — ẩn tree, không unmount.
// Reviewed state persist qua memory/audit — collapse/peek không un-mark.
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ State UI giữ nguyên (CSS-hide) — không remount chậm | ❌ CSS-hide không dùng được nếu component cần unmount để dừng work |
| ✅ Reviewed là commit — không mất tiến độ review | ❌ User có thể quên review thật (chỉ tick checkbox) |
| ✅ Chapter theo cấu trúc (core→consequences→glue) | ❌ Takeover che hết UI — cần thoát rõ ràng |
| ✅ Nối diff annotatable (hashline) | ❌ Diff nhiều file — render nặng nếu không virtualize |

## Khác các hướng gần

| | AJA Review Takeover | AJD VSCode Diff | AJC Event Bus Req/Resp |
|---|---|---|---|
| Trọng tâm | Review UX trong dashboard | Mở diff ngoài editor | Điều khiển qua bus |
| Cơ chế | CSS-hide + checkbox chapter | HTTP protocol | Request/response bus |
| Quan hệ | Review surface | Editor integration | Control plane |

## Khi nào chọn

- Cần human review giữa chuỗi agent work — UI duyệt theo chapter có bằng chứng
- Đã có web dashboard + WS + hashline diff — thêm takeover layer
- Muốn tiến độ review bền (không mất khi collapse/peek)
- Guard: CSS-hide giữ state, checkbox persist, peek không un-mark, thoát takeover rõ