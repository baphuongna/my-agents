# Hướng HHHHHH: Edge/On-Device Agents — agent chạy local, offline, dữ liệu không rời máy

> **Nguồn gốc:** Qualcomm "Run Nexa AI agents locally on Snapdragon" 2026 (Hexagon NPU); Medium "Edge AI Dominance 2026 — 80% inference locally"; Petronella "Edge-First AI Agents: Offline, Private"; Crewdle "On-Device AI and Data Sovereignty 2026"
> **Coupling:** 🟡 — runtime local thay cloud (model inference thay đổi)
> **Agent-agnostic:** ✅ (agent interface không đổi — chỉ đổi backend)
> **Code sẵn:** ⚠️ (hybrid local-cloud + model cascade sẵn; thiếu on-device runtime)
> **Effort:** 2-4 tuần

## Nguồn gốc

Edge/on-device agents: **agent chạy trên thiết bị, inference local, offline-capable** — Qualcomm 2026: "developers can now ship apps that run offline... Granite-4 execute at the edge" (NPU Hexagon); Medium 2026: "By 2026, 80% of AI inference happens locally on devices rather than cloud data centers — transforms economics, privacy"; Petronella: "offline-capable, privacy-first AI agents for frontline operations... works without cloud connectivity in factories"; Crewdle: "on-device AI keeps data on your own infrastructure — Local AI eliminates the transfer entirely". Điểm khác **PPPP hybrid local-cloud** (route model theo cost — local khi rẻ) và **HHH cascade** (bậc model) — HHHHHH *cực đoan local-first*: ràng buộc dữ liệu không rời máy (data sovereignty), chạy offline được, model nhỏ trên NPU/GPU local, cloud chỉ khi bắt buộc (tác vụ khó — fallback) và có chính sách rõ dữ liệu nào được gửi. Nối PPPP (routing local/cloud), HHH (cascade local → cloud), IIII TEE (bảo vệ dữ liệu local), FF firewall (chống exfil khi fallback cloud).

## Mô tả

mya edge mode: (1) **runtime local** — model chạy qua NPU/GPU local (Ollama/llama.cpp tương tự — Granite-4/Qwen3.5) hoặc model nhỏ embed + reasoning local; (2) **offline-first** — toàn bộ core agent (task, memory, tool local — kanban/tuple space SQLite) chạy không mạng; cloud chỉ cho: model mạnh khi task khó (cascade HHH), tác vụ cần KB ngoài; (3) **data sovereignty** — chính sách: dữ liệu nhạy cảm (file người dùng, secret) KHÔNG gửi cloud — policy engine WW chặn nếu tool yêu cầu gửi; (4) **fallback an toàn** — mất mạng → agent vẫn chạy với model local (degrade thành, không crash — watchdog BBBBBB); (5) **đồng bộ** — khi có mạng: đồng bộ kết quả/artifact lên (chọn lọc — không đồng bộ toàn bộ context); (6) **đo** — metric latency/cost local vs cloud (YYYY + XXXXX) để quyết định task nào local đủ.

## Kiến trúc

```
  AGENT (core local — task/memory/tool SQLite — OFFLINE OK)
        │
        ▼
  INFERENCE ROUTER (PPPP) — data sovereignty policy (WW)
   │ local (NPU — Granite-4/Qwen)     │ cloud (model mạnh)
   │ offline ✓ · privacy ✓            │ task khó · KB ngoài · có mạng
        │                                    │
        ▼                                    ▼
  CASCADE HHH: local trước, cloud khi cần (quyết định theo task độ khó)
        │
        ▼
  MẤT MẠNG → vẫn chạy (local) — không crash (BBBBBB watchdog)
  ĐỒNG BỘ có chọn lọc khi có mạng (artifact — QQQQ)
```

```
mya: PPPP + HHH + WW SẸN — thiếu: on-device inference runtime + offline contract
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ PPPP hybrid local-cloud — routing local/cloud (nền)
// ✅ HHH cascade — local trước, escalate cloud
// ✅ WW policy — chặn gửi dữ liệu nhạy cảm ra ngoài
// ✅ core local — task/memory/tool SQLite (chạy offline được)
// ✅ QQQQ artifact — đồng bộ có chọn lọc

// ❌ THIẾU: on-device inference runtime (NPU/GPU local)
// ❌ THIẾU: offline contract (model local đủ cho task nào)
// ❌ THIẾU: data sovereignty policy chi tiết (gì được gửi cloud)
```

## Implementation

```typescript
// packages/edge/src/router.ts (NEW)
export class EdgeRouter {
  async infer(task: Task, ctx: EdgeCtx): Promise<Result> {
    if (this.sovereignty(ctx, task)) return local(task);      // NPU — offline
    if (this.offline()) return local(task);                   // mất mạng — degrade
    return this.cascade(task, ctx);                           // HHH — cloud khi cần
  }
  private sovereignty(ctx: EdgeCtx, t: Task): boolean {
    return ctx.sensitive || t.difficulty <= localThreshold;   // dữ liệu nhạy cảm ở local
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Dữ liệu không rời máy (sovereignty/privacy) | ❌ Model local yếu hơn — task khó sai nhiều hơn |
| ✅ Chạy offline (mất mạng không chết) | ❐ Cần phần cứng (NPU/GPU — RAM) |
| ✅ Rẻ (80% inference local — Medium 2026) | ❌ Latency local lớn nếu máy yếu |
| ✅ Đồng bộ chọn lọc — ít băng thông | ❌ Vận hành phức tạp (2 runtime + policy gửi dữ liệu) |

## Khác các hướng gần

| | PPPP Hybrid | HHH Cascade | HHHHHH: Edge |
|---|---|---|---|
| Động lực | Giá rẻ | Chất lượng | **Quyền riêng tư + offline** |
| Chọn theo | Cost model | Độ khó/conf | **Data sovereignty + mạng** |
| Cực đoan | Cloud khi cần | Escalate | **Local-first, cloud ngoại lệ** |

## Khi nào chọn

- Dữ liệu nhạy cảm không được gửi cloud (hợp đồng/pháp lý)
- Môi trường mất mạng (factory, field — frontline)
- Đã có PPPP + HHH + WW — thêm runtime local + offline contract
- Đang có phần cứng NPU/GPU local