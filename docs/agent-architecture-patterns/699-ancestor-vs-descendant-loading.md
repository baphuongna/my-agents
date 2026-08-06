# Hướng ZW: Ancestor vs Descendant Loading — hai cơ chế load CLAUDE.md trong monorepo: ancestor loading (đi lên từ cwd, load ngay lúc startup) vs descendant loading (đi xuống, lazy load chỉ khi đọc/edit file trong thư mục đó) — quyết định bố trí instruction cho repo lớn
> **Nguồn gốc:** claude-code-best-practice (best-practice/claude-memory.md) | **Coupling:** 🟢 — memory file loading strategy trong prompts | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (prompts/assembler + memory — chưa có 2 chế độ loading) | **Effort:** 1-2 tuần

## Nguồn gốc

**claude-code-best-practice** phân tích 2 cơ chế load file instruction (CLAUDE.md) trong monorepo: (1) **Ancestor loading** — từ cwd **đi lên** (cwd → parent → root), **load ngay lúc startup**, gộp tất cả vào context đầu; (2) **Descendant loading** — từ cwd **đi xuống** (cwd → subdir), **lazy load** — chỉ khi agent **đọc/edit file trong thư mục đó** thì file instruction của thư mục đó mới được load. Quyết định bố trí instruction: ancestor phù hợp **rule chung** (luôn áp dụng — code style, security); descendant phù hợp **rule theo module** (chỉ áp dụng khi chạm vào module — domain conventions). Nguyên tắc: **ancestor cho rule toàn cục, descendant cho rule theo module — đúng chỗ, đúng lúc**.

## Mô tả

mya ancestor vs descendant loading: (1) **Ancestor loader** — startup: walk up từ cwd, gộp file instruction (vd AGENTS.md/CLAUDE.md) vào prompt ổn định. (2) **Descendant loader** — lazy: khi tool read/edit file ở thư mục X, load instruction thư mục X (cache theo dir). (3) **Merge policy** — ancestor luôn có; descendant inject theo ngữ cảnh file đang đụng. (4) **Precedence** — rule gần (descendant) thắng rule xa (ancestor) khi xung đột. mya có prompts/assembler.ts (stable tier) + tools (read/edit hook) — ZW thêm **ancestor walk** + **descendant lazy loader** + **merge/precedence**.

## Kiến trúc

```
  ANCESTOR (startup — đi lên từ cwd)
  ┌────────────────────────────────────────┐
  │  cwd/AGENTS.md  ▲                       │
  │  parent/AGENTS.md │ đi lên              │
  │  root/AGENTS.md   │ gộp → context đầu   │
  └────────────────────────────────────────┘
  → rule chung luôn áp dụng (style, security)

  DESCENDANT (lazy — đi xuống khi đụng file)
  ┌────────────────────────────────────────┐
  │  read src/payment/domain.ts             │
  │  → load src/payment/AGENTS.md (cache)   │
  │  → inject rule module payment           │
  └────────────────────────────────────────┘
  → rule module chỉ khi chạm vào module
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/prompts assembler.ts — buildVolatileTier/defaultStableTier (nền — ZW inject)
// ✅ packages/prompts inject.ts — scanInject (nền — ZW descendant inject)
// ✅ packages/tools — read/edit tools (nền — ZW lazy trigger)
// ✅ packages/tools tool-search.ts — ToolSearch (nền — ZW cache theo dir analog)
// ✅ packages/core session.ts — createSession (nền — ZW gắn cwd)

// ❌ THIẾU: ancestor loader (walk up + merge lúc startup)
// ❌ THIẾU: descendant lazy loader (theo dir, cache)
// ❌ THIẾU: merge/precedence policy (rule gần thắng rule xa)
```

## Implementation

```typescript
// packages/prompts/src/instruction-loading.ts (MỚI)

class InstructionLoading {
  private dirCache = new Map<string, string>();   // descendant cache theo dir

  constructor(
    private fs: { read(p: string): Promise<string | null>; dirsUp(cwd: string): Promise<string[]> },
  ) {}

  // Ancestor loading: startup — đi lên từ cwd, gộp rule chung
  async loadAncestors(cwd: string, filename = "AGENTS.md"): Promise<string[]> {
    const dirs = await this.fs.dirsUp(cwd);          // [cwd, parent, root]
    const out: string[] = [];
    for (const dir of dirs) {
      const content = await this.fs.read(`${dir}/${filename}`);
      if (content) out.push(`# ${dir}/${filename}\n${content}`);
    }
    return out;                                       // rule chung vào context đầu
  }

  // Descendant loading: lazy — chỉ khi đụng file trong dir X
  async loadDescendant(filePath: string, filename = "AGENTS.md"): Promise<string | null> {
    const dir = filePath.split("/").slice(0, -1).join("/");   // dir của file đang đụng
    if (this.dirCache.has(dir)) return this.dirCache.get(dir) ?? null;   // cache theo dir
    const content = await this.fs.read(`${dir}/${filename}`);
    this.dirCache.set(dir, content);                  // lazy load + cache
    return content;
  }

  // Merge: ancestor (rule chung) + descendant (rule module) — rule gần thắng
  merge(ancestors: string[], descendant: string | null): string {
    const parts = [...ancestors];
    if (descendant) parts.push(descendant);           // descendant đặt sau → precedence cao hơn
    return parts.join("\n\n---\n\n");
  }
}
// Usage:
// const loader = new InstructionLoading(fsAdapter);
// const ancestors = await loader.loadAncestors(session.cwd);              // startup
// // trong read/edit tool:
// const desc = await loader.loadDescendant(filePath);                     // lazy
// const prompt = loader.merge(ancestors, desc);
// // rule chung luôn có; rule module chỉ khi chạm module
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Rule chung không bao giờ thiếu (ancestor) | ❌ Ancestor nhiều cấp → context đầu nặng |
| ✅ Rule module đúng lúc (lazy, không phí token) | ❌ Lazy load trễ → agent đụng module mà chưa có rule |
| ✅ Cache theo dir (không load lại mỗi file) | ❌ Dir cache stale (rule sửa → cache cũ) |
| ✅ Precedence rõ (rule gần thắng rule xa) | ❌ File instruction trùng tên nhiều cấp → gộp dài |

## Khác các hướng gần

| | Load tất cả | Load 1 file root | ZW: Ancestor + Descendant |
|---|---|---|---|
| Startup | Nặng | Nhẹ | **Ancestor (vừa)** |
| Rule module | Có | Không | **✅ lazy đúng lúc** |
| Token | Tốn | Ít | **Tối ưu** |

## Khi nào chọn

- Monorepo lớn: rule chung (root) + rule module (per-dir)
- Muốn rule module chỉ tốn token khi đụng module
- Muốn precedence rõ (rule gần thắng)
- Nối packages/prompts assembler.ts + inject.ts + tools (read/edit hook) + tool-search.ts + core session.ts; guard cache-invalidation (dir cache hết hạn), precedence-correctness (rule gần thắng thật), và ancestor-bounded (walk up có giới hạn cấp, không lên tới /); ZW = ancestor vs descendant loading, kết hợp 688 ZL compaction-survival-notes (instruction sống qua compaction) + 700 ZX hook-sound-notification (hook events quanh tool)
