# Hướng FFFFFF: Agent Versioning — prompt/config/tool theo phiên bản, rollback bằng cấu hình

> **Nguồn gốc:** Claude "Managed Agents: prompt versioning and rollback" cookbook; Arthur AI "Version & Rollback LLM Agent Prompts"; Restate "Updating AI Agents safely in production"; Notch "Versioning AI Agents in Production"
> **Coupling:** 🟢 — thêm lớp cấu hình, runtime không đổi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (MAV QQQQ + eval PP + git sẵn; thiếu version store + env tags)
> **Effort:** 1-2 tuần

## Nguồn gốc

Agent versioning: **prompt/tools/config theo phiên bản, rollback là thay đổi cấu hình** — Claude cookbook: "create v1, evaluate against a labelled test set, ship v2, detect a regression, roll back by pinning sessions"; Arthur AI: "Roll back instantly by repointing the environment tag... rollback should be a configuration change, not a redeploy"; Restate: "immutable deployments and pinned executions" — long-running agents version theo execution đã pin; Notch: "any update to configuration is logged, versioned, and traceable". Điểm khác **QQQQ MAV** (version artifact *output*) và **SSSS reproducible** (pin môi trường) — FFFFFF *version cấu hình agent* (prompt/system/tools/params): mỗi thay đổi = version mới (immutable), môi trường (dev/prod) trỏ tới tag (v1.2.3), rollback = đổi tag — không cần sửa code. Nối QQQQ (artifact version), SS (eval gate trước khi ship), ZZZZZ (shadow test version mới), YYYY (đo hồi quy sau deploy).

## Mô tả

mya versioning loop: (1) **config store** — prompt/system/tool-set/params thành artifact versionable (git-friendly: file YAML/TS như giờ); (2) **immutable** — v1.0.0 khóa, không sửa; sửa = tạo v1.1.0; (3) **env tags** — `dev→v1.1.0`, `prod→v1.0.0` — agent đọc config theo tag hiện thời; (4) **pre-ship gate** — version mới chạy eval PP + shadow ZZZZZ trước khi trỏ prod; (5) **rollback** — version prod xấu → đổi tag về version cũ (cấu hình, tức thì, không redeploy); (6) **traceability** — mọi session ghi version config đã dùng (Restate: pinned execution) — biết chính xác agent nào chạy prompt nào khi lỗi; (7) **chi nhánh** — A/B test 2 version cùng lúc qua tag khác nhau (arena AAAAAA so).

## Kiến trúc

```
  CONFIG (prompt/tools/params) ──► VERSION STORE (immutable v1.0.0, v1.1.0...)
                                        │
                                        ▼
  ENV TAGS: dev→v1.1.0 · prod→v1.0.0 (rollback = đổi tag — Arthur AI)
                                        │
                                        ▼
  PRE-SHIP GATE: eval PP + shadow ZZZZZ → mới trỏ prod
                                        │
                                        ▼
  SESSION PIN: mỗi session ghi version đã dùng (Restate — long-running)
                                        │
                                        ▼
  REGRESSION WATCH: YYYY đo sau deploy → hồi quy → đổi tag (rollback tức thì)
```

```
mya: git + QQQQ + PP SẸN — thiếu: version store + env tags + session pin
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ git — nguồn versioning (file config trong repo)
// ✅ QQQQ MAV — version artifact output (chuẩn versionable)
// ✅ PP eval — pre-ship gate (đánh giá version mới)
// ✅ ZZZZZ shadow — test version mới song song
// ✅ YYYY — đo hồi quy sau deploy

// ❌ THIẾU: version store (immutable + tag)
// ❌ THIẾU: env tags (dev/prod trỏ version)
// ❌ THIẾU: session pin (ghi version đã dùng trong session log)
```

## Implementation

```typescript
// packages/config/src/versioning.ts (NEW)
export class VersionStore {
  async ship(version: Version, env: "dev" | "prod"): Promise<void> {
    await this.assertImmutable(version);          // version không sửa sau
    if (env === "prod") await this.gate(version); // PP eval + shadow ZZZZZ
    this.tags[env] = version;                     // rollback = repoint tag
  }
  resolve(env: "dev" | "prod"): Version {
    return this.tags[env];                        // agent đọc theo tag
  }
}
// session pin: mỗi session ghi versionConfig (Restate — pinned execution)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Rollback tức thì bằng cấu hình — không redeploy | ❌ Thêm bước vận hành (tag/ship/gate) |
| ✅ Biết chính xác version nào gây lỗi (session pin) | ❐ Version nhiều → quản lý chồng (dọn version cũ) |
| ✅ A/B test 2 version (tag khác nhau) | ❌ Config tham chiếu chéo (tool external) khó version |
| ✅ Xây trên git + PP + QQQQ | ❌ Vẫn cần gate — version không tự đảm bảo tốt |

## Khác các hướng gần

| | QQQQ Artifacts | SSSS Reproducible | FFFFFF: Versioning |
|---|---|---|---|
| Version cái gì | Output (artifact) | Môi trường (pin stack) | **Config agent (prompt/tools/params)** |
| Mục đích | Truy vết output | Chạy lại giống hệt | **Ship/rollback an toàn** |
| Cơ chế | MAV | Manifest + pin | **Env tags + session pin** |

## Khi nào chọn

- Prompt/config thay đổi thường xuyên — cần rollback nhanh
- Agent chạy dài (durable UUUU) — session phải biết version đã dùng
- Đã có git + PP + QQQQ — thêm version store + tags
- Nhiều môi trường (dev/staging/prod) — trỏ version khác nhau