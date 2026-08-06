# Hướng WU: Produces / Acts / Terminal Factories — ba dạng factory stage phân loại theo artifact flow (produces tạo artifact kế, acts kế thừa + side-effect, terminal cô lập qua inheritsArtifacts:false)

> **Nguồn gốc:** rpiv-mono (workflow stage factory taxonomy); "produces (artifact for next stage)", "acts (side-effect inheriting artifact)", "terminal (isolated side-effect via inheritsArtifacts:false)" | **Coupling:** 🟡 — thêm stage-type phân loại vào workflow engine | **Agent-agnostic:** ✅ | **Code sẵn:** ⚠️ (workflow runner + worker sẵn — chưa có 3-mode factory taxonomy) | **Effort:** 2-3 tuần

## Nguồn gốc

**rpiv-mono** chia **workflow stage** thành ba **factory mode** tùy thuộc cách nó xử lý **artifact** (đơn vị dữ liệu truyền giữa stage): (1) **Produces** — stage này **tạo artifact** và đẩy cho stage kế (output trở thành input kế tiếp, chuỗi dữ liệu tiếp diễn). (2) **Acts** — stage này **kế thừa artifact** của stage trước (đọc artifact upstream) rồi thực thi **side-effect** (ghi file, gọi API, mutate state), nhưng không sinh artifact mới. (3) **Terminal** — stage này chạy **side-effect cô lập**: cờ `inheritsArtifacts:false` cắt đứt artifact flow, stage không thấy artifact upstream và không truyền artifact downstream. Nguyên tắc: **mỗi stage khai báo vai trò artifact** — engine biết nối chuỗi (produces/acts) hay chặn (terminal) thay vì đoán theo output.

## Mô tả

mya produces/acts/terminal factories: mỗi stage khai báo `mode` ∈ {produces, acts, terminal}. Stage **produces** chạy → trả artifact → engine nạp vào state.named cho stage kế. Stage **acts** nhận artifact kế thừa → chạy side-effect → không thay đổi artifact pool. Stage **terminal** set `inheritsArtifacts:false` → engine **không nạp** artifact upstream vào scope, side-effect cô lập (như checkpoint cuối, dọn dẹp, notify — không cần data chuỗi). mya có workflow runner + worker + orchestration — WU thêm **stage-mode metadata** + **artifact-flow guard** (produces/acts nối chuỗi, terminal cô lập).

## Kiến trúc

```
  STAGE A (mode: produces)
  ┌───────────────────────────────────────┐
  │  run(ctx) → return { artifact: report } │  ← tạo artifact
  └───────────────────┬───────────────────┘
                      ▼  (artifact → state.named)
  STAGE B (mode: acts, inheritsArtifacts:true)
  ┌───────────────────────────────────────┐
  │  ctx.artifacts = { report }             │  ← kế thừa artifact
  │  side-effect: writeFile(report)         │  ← side-effect, không tạo artifact
  │  return {}                              │
  └───────────────────┬───────────────────┘
                      ▼  (artifact vẫn { report })
  STAGE C (mode: terminal, inheritsArtifacts:false)  ← CÔ LẬP
  ┌───────────────────────────────────────┐
  │  ctx.artifacts = {}   (chặn upstream)   │  ← không thấy artifact
  │  side-effect: notifySlack("done")       │  ← cô lập, không data flow
  │  return {}                              │  ← không truyền artifact downstream
  └───────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/workflows runner.ts — workflow runner (nền — WU stage chạy ở đây)
// ✅ packages/workflows worker.ts — worker step (nền — WU stage = worker step)
// ✅ packages/workflows orchestration.ts — orchestration (nền — WU nối stage)
// ✅ packages/core spill.ts — data carry (nền — WU artifact carry analog)

// ❌ THIẾU: stage-mode metadata (produces/acts/terminal)
// ❌ THIẾU: artifact-flow guard (terminal chặn inheritsArtifacts)
// ❌ THIẾU: state.named artifact pool cho produces (kết hợp WY named-artifact-registry)
```

## Implementation

```typescript
// packages/workflows/src/stage-factory.ts (MỚI)
type StageMode = "produces" | "acts" | "terminal";

interface StageArtifact { [name: string]: unknown }
interface StageCtx { artifacts: StageArtifact; sideEffect?: (a: unknown) => void }

interface StageDef {
  mode: StageMode;
  inheritsArtifacts?: boolean; // false → terminal cô lập
  run: (ctx: StageCtx) => Promise<StageArtifact>;
}

async function runStage(prev: StageArtifact, def: StageDef): Promise<StageArtifact> {
  // terminal: cô lập — không kế thừa artifact upstream
  const artifacts: StageArtifact = def.mode === "terminal" ? {} : { ...prev };
  const out = await def.run({ artifacts });
  // produces: merge artifact mới vào pool cho stage kế
  if (def.mode === "produces") return { ...artifacts, ...out };
  // acts / terminal: không thêm artifact mới
  return artifacts;
}

async function runPipeline(stages: StageDef[], seed: StageArtifact = {}): Promise<StageArtifact> {
  let carry = seed;
  for (const s of stages) carry = await runStage(carry, s); // chuỗi artifact
  return carry;
}

// Usage:
// const pipeline = [
//   { mode: "produces", run: async () => ({ report: buildReport() }) },
//   { mode: "acts", run: async (c) => { c.sideEffect?.(c.artifacts.report); return {}; } },
//   { mode: "terminal", inheritsArtifacts: false, run: async () => { notify(); return {}; } },
// ];
// await runPipeline(pipeline);
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Artifact flow tường minh (khai báo mode, không đoán) | ❌ Metadata overhead (mỗi stage thêm mode field) |
| ✅ Terminal cô lập (side-effect cuối không rò rỉ data) | ❌ Lớp học (người viết workflow phải hiểu 3 mode) |
| ✅ Side-effect rõ (acts vs produces phân tách mutate/create) | ❌ Terminal break-chain bug (quên mode → data mất đột ngột) |
| ✅ Compose pipeline (produces nối acts nối terminal) | ❌ Debug artifact (mode sai → khó trace artifact mất ở đâu) |

## Khác các hướng gần

| | Linear pipeline | Map-reduce stage | WU: Factory-Mode |
|---|---|---|---|
| Artifact flow | Luôn nối | Fan-out/gather | **Khai báo mode (produces/acts/terminal)** |
| Side-effect | Không phân loại | Không phân loại | **✅ acts/terminal phân biệt mutate vs cô lập** |
| Cô lập | ❌ | ❌ | **✅ terminal (inheritsArtifacts:false)** |

## Khi nào chọn

- Workflow nhiều stage cần phân biệt "tạo artifact" vs "side-effect thuần" vs "bước cuối cô lập"
- Muốn artifact flow tường minh (engine nối/chặn theo mode, không đoán output)
- Nối packages/workflows runner.ts + worker.ts + orchestration.ts; guard mode-default (stage không khai báo → default acts, không silently terminal), terminal-audit (log khi artifact flow bị chặn), và artifact-schema (produces validate artifact có name — kết hợp WY named-artifact-registry); WU = produces/acts/terminal factories, kết hợp 620 WV outcome-collector-parser-validator (parser đọc artifact produces) + 623 WY named-artifact-registry (pool artifact theo tên)
