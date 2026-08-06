# Hướng ACK: Two-Surface Extension — extension lộ cả command UI lẫn LLM tools để human và agent cùng thao tác được

> **Nguồn gốc:** pi-add-dir (README.md) | **Coupling:** 🟢 — extension surface, core không đổi | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (có command-registry + tool registry — chưa có mô hình extension 2 mặt) | **Effort:** 1-2 tuần

## Nguồn gốc

**pi-add-dir** là extension lộ **hai surface cùng một lúc**: (1) **command UI** — `/add-dir`, `/suggest-dirs`, `/remove-dir`, `/dirs` cho **human** dùng trực tiếp; (2) **LLM tools** — `add_directory`, `search_external_files` cho **agent** gọi tự động. Nhờ vậy cả hai actor đều có thể thêm/search external dirs — và quan trọng: **agent tự đề xuất thêm directory khi cần reference shared library** (agent phát hiện cần, tự gọi `add_directory`, không cần user nhắc). Nguyên tắc: **một capability, hai mặt người-máy** — command cho human, tool cho agent, cùng backend.

## Mô tả

mya two-surface extension: (1) **capability backend** — logic dùng chung (thêm dir, liệt kê, remove, search file) nằm trong một module, không duplicate; (2) **command surface** — đăng ký `/add-dir`... vào packages/print command-registry.ts (human TUI); (3) **tool surface** — đăng ký `add_directory`/`search_external_files` vào packages/tools ToolRegistry (agent tool-call); (4) **agent tự đề xuất** — tool description nói rõ "gọi khi cần reference file ngoài cwd" — agent chủ động mở rộng context; (5) **search external files** — tool tra cứu file trong external dirs đã thêm. Nối ACH/ACI — ACK là surface layer trên cùng engine.

## Kiến trúc

```
                ┌─── TWO-SURFACE EXTENSION ───────────────┐
  HUMAN ◀──▶ COMMAND SURFACE            TOOL SURFACE ◀──▶ AGENT
                │  /add-dir                 add_directory  │
                │  /suggest-dirs            search_external_files
                │  /remove-dir              (tool-call tự động)
                │  /dirs                                    │
                           ▼
                  CAPABILITY BACKEND (dùng chung)
                    addDir / removeDir / listDirs / searchFiles
                           ▼
                    External dir registry (persist)
```

## mya ĐÃ CÓ

```typescript
// ✅ packages/print command-registry.ts — command registry (nền — command surface)
// ✅ packages/tools registry.ts — ToolRegistry + ToolImpl (nền — tool surface)
// ✅ packages/intercom extension-api.ts — extension register + event (nền — extension model)
// ✅ packages/tools auto-discover.ts — scanCustomToolDir (nền — đăng ký tool từ extension)
// ✅ packages/tools find.ts / search-index.ts — tìm kiếm file (nền — search_external_files)

// ❌ THIẾU: capability backend dùng chung (command + tool cùng logic)
// ❌ THIẾU: cặp command/tool đăng ký từ một khai báo duy nhất
// ❌ THIẾU: agent tự đề xuất thêm dir (tool description động)
```
## Implementation
```typescript
// packages/tools/src/two-surface.ts (MỚI)
import type { ToolImpl } from "./registry.js";
import type { CommandDef } from "@my-agent/print";
/** Capability backend — logic dùng chung cho cả 2 surface. */
export interface DirCapabilities {
  addDir(path: string): Promise<{ ok: boolean; reason?: string }>;
  removeDir(path: string): Promise<{ ok: boolean }>;
  listDirs(): Promise<string[]>;
  searchFiles(query: string): Promise<Array<{ path: string; match: string }>>;
}
/** Tool surface — agent gọi tự động. */
export function makeDirTools(caps: DirCapabilities): ToolImpl[] {
  return [
    {
      meta: {
        name: "add_directory",
        description:
          "Thêm directory ngoài cwd vào context (AGENTS.md + skills). " +
          "GỌI KHI cần reference shared library / project khác — tự đề xuất, không đợi user nhắc.",
        args: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      },
      async run(args: { path: string }) {
        const r = await caps.addDir(args.path);
        return { callId: "add_directory", ok: r.ok, output: r.reason ?? `added ${args.path}` };
      },
    },
    {
      meta: {
        name: "search_external_files",
        description: "Tìm file trong các external directory đã thêm (/add-dir).",
        args: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      },
      async run(args: { query: string }) {
        const hits = await caps.searchFiles(args.query);
        return { callId: "search_external_files", ok: true, output: hits };
      },
    },
  ];
}
/** Command surface — human dùng /add-dir... Một khai báo → cả 2 surface. */
export function makeDirCommands(caps: DirCapabilities): CommandDef[] {
  const commands: CommandDef[] = [];
  for (const t of makeDirTools(caps)) {
    commands.push({
      name: t.meta.name.replace(/_/g, "-").replace(/^/, "/"),
      description: t.meta.description.split(".")[0]!,
      run: async (args: string[]) => {
        const r = await (t.run as (a: Record<string, string>) => Promise<{ output: unknown }>)({ path: args[0] ?? "" });
        return String(r.output);
      },
    });
  }
  return commands;
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Human + agent cùng thao tác — không bắt buộc người nhắc | ❌ Hai surface = hai surface test |
| ✅ Backend dùng chung — không duplicate logic | ❌ Description tool phải đủ rõ để agent tự đề xuất |
| ✅ Agent tự mở rộng context khi cần — ít gián đoạn | ❌ Command/tool mapping phải nhất quán (naming) |
| ✅ Extension model sẵn — đăng ký có cấu trúc | ❌ Tool tự thêm dir có thể lạm dụng (cần approval?) |

## Khác các hướng gần

| | Tool-only extension (tools/auto-discover) | ACK: Two-Surface |
|---|---|---|
| Surface | Chỉ LLM tool | **Command UI + LLM tool từ một khai báo** |
| Actor | Chỉ agent | **Human + agent, cùng backend** |
| Agent hành động | User phải biết tool tồn tại | **Agent tự đề xuất khi cần** |
| Dùng khi | Tool thuần | **Capability cần cả 2 actor thao tác** |

## Khi nào chọn

- Capability cần cả human lẫn agent thao tác (add dir, quản lý resource)
- Muốn agent chủ động mở rộng (tự add dir khi cần reference)
- Extension model + command registry + tool registry đều đã có — nối là tự nhiên
- Guard: description tool động, backend không duplicate, tool tự hành động qua approval nếu nhạy cảm
