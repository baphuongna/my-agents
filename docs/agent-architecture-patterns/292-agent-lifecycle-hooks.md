# Hướng KF: Agent Lifecycle Hooks — startup/shutdown/migrate, event orchestration

> **Nguồn gốc:** Kubernetes postStart/preStop hooks; systemd ExecStartPre/ExecStopPost; Spring Bean lifecycle; Celery worker init; Celery/Temporal activity hooks
> **Coupling:** 🟡 — agent chạy trong lifecycle container
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (pool start/stop sẵn — thiếu hook registry có thứ tự)
> **Effort:** 1 tuần

## Nguồn gốc

**Lifecycle hooks**: các điểm cố định trong vòng đời một process — `init`/`startup`, `migrate`, `preStop`/`shutdown` — để chạy setup/teardown có kiểm soát. Kubernetes: `postStart` (sau khi container khởi tạo — load cache, warm-up) và `preStop` (trước khi kill — drain connection, flush). systemd: `ExecStartPre` (kiểm tra điều kiện trước start) / `ExecStopPost` (dọn sau stop). Spring: `@PostConstruct`/`@PreDestroy`. Tính chất: hook **có thứ tự** (init trước serve, shutdown ngược thứ tự), **idempotent** (chạy nhiều lần an toàn), và **phân giai đoạn** (migrate DB chỉ 1 lần).

## Mô tả

mya lifecycle: mỗi agent session đi qua các pha cố định — `onInit` (load config, 62 credential, 18 connection pool), `onMigrate` (nâng cấp schema DB / 135 agent-version migration, chạy 1 lần), `onReady` (bắt đầu serve), `onDrain` (ngừng nhận task mới, 215 deadline chờ in-flight), `onShutdown` (flush state, checkpoint 45, đóng kết nối). Hook registry: operator đăng ký hàm theo pha, runtime gọi đúng thứ tự. Khác `start()`/`stop()` rời rạc: hook **cấu trúc theo pha**, shutdown **graceful** (drayn → flush → đóng).

## Kiến trúc

```
  ┌─────────────── AGENT SESSION LIFECYCLE ───────────────┐
  │                                                       │
  │  onInit ──► onMigrate ──► onReady ──► [serve]         │
  │   (load       (DB/agent    (health     (handle        │
  │    config     schema       OK,        requests)       │
  │    creds      upgrade      start       │              │
  │    pool)      1 lần)       accept)     │ SIGTERM      │
  │                                         ▼              │
  │  onShutdown ◄── onDrain ◄── [stop accept]             │
  │   (flush       (chờ in-      (ngừng      │            │
  │    state,      flight done,  nhận mới)   │            │
  │    close       kill no-new)              │            │
  │    conn)                                  │           │
  └───────────────────────────────────────────────────────┘
  Hook registry: [onInit: loadCreds, warmPool]  [onShutdown: checkpoint, close]
  Shutdown = NGƯỢC thứ tự (init pool → ... → close pool cuối cùng)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ packages/agent/src/pool.ts — pool start/stop
// ✅ 62 credential-broker — load credential (init-phase)
// ✅ 18 connection-pool — pool lifecycle
// ✅ 45 wait-event-checkpoint — checkpoint (shutdown-phase)
// ✅ 135 agent-versioning — version (migrate-phase tiềm năng)
// ✅ 12 event-stream — event bus (có thể phát lifecycle event)

// ❌ THIẾU: hook registry theo pha (onInit/onMigrate/onShutdown)
// ❌ THIẾU: thứ tự shutdown ngược (dependency-aware)
// ❌ THIẾU: migrate gate (chạy 1 lần, lock)
// ❌ THIẾU: graceful drain (chờ in-flight trước kill)
```

## Implementation

```typescript
// packages/agent/src/lifecycle.ts (NEW)
type Phase = "onInit" | "onMigrate" | "onReady" | "onDrain" | "onShutdown";

class Lifecycle {
  private hooks: Record<Phase, Array<{ name: string; fn: () => Promise<void> }>> = {
    onInit: [], onMigrate: [], onReady: [], onDrain: [], onShutdown: [],
  };

  on(phase: Phase, name: string, fn: () => Promise<void>): void {
    this.hooks[phase].push({ name, fn });
  }

  async startup(): Promise<void> {
    await this.run("onInit");          // load config/creds/pool
    await this.run("onMigrate");       // schema upgrade (lock, 1 lần)
    await this.run("onReady");         // health OK → accept
  }

  async shutdown(): Promise<void> {
    await this.run("onDrain");         // chờ in-flight, ngừng nhận mới
    // shutdown NGƯỢC thứ tự init (close pool cuối)
    await this.runReversed("onShutdown");
  }

  private async run(phase: Phase): Promise<void> {
    for (const { name, fn } of this.hooks[phase]) {
      try { await fn(); }            // một hook fail → log, tiếp tục
      catch (e) { console.error(`[lifecycle] ${phase}/${name} failed:`, e); }
    }
  }
  private async runReversed(phase: Phase): Promise<void> {
    for (const { name, fn } of [...this.hooks[phase]].reverse()) {
      try { await fn(); } catch (e) { console.error(`[lifecycle] ${phase}/${name}:`, e); }
    }
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Setup/teardown cấu trúc (K8s/systemd proven) | ❌ Hook chạy tuần tự → startup chậm hơn |
| ✅ Shutdown graceful (drain → flush → đóng) | ❌ Migration cần lock (single-run gate) |
| ✅ Thứ tự đóng ngược (dependency-safe) | ❌ Hook fail cần policy (log & tiếp tục?) |
| ✅ Migrate tách pha (chạy 1 lần, không mỗi request) | ❌ Thêm lớp trừu tượng (debug harder) |

## Khác các hướng gần

| | 32 Supervisor Tree | KF: Lifecycle Hooks |
|---|---|---|
| Mục | Restart khi crash | **Pha startup/shutdown/migrate** |
| Kích hoạt | Crash → restart | **Giai đoạn cố định** |
| Restart vs init | Restart (= re-init) | **Init ≠ restart (migrate 1 lần)** |
| Graceful | ❌ (crash-driven) | ✅ drain → flush |

## Khi nào chọn

- Agent cần setup (load creds, warm pool) + teardown (flush, close)
- Có schema/agent migration (chạy 1 lần khi nâng version)
- Cần graceful shutdown (chờ in-flight, không mất request)
- Shutdown có dependency (đóng theo thứ tự)
