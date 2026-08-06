# Hướng JN: Containerized Tool Execution — chạy tool trong container cô lập, giới hạn syscall/resource

> **Nguồn gốc:** OWASP "Agent Sandboxing"; Docker/Podman container isolation (namespaces, cgroups); "Sandboxing LLM agents" (code interpreter isolation); Firecracker microVM; OpenAI Code Interpreter (sandboxed); gVisor (syscall filter); seccomp/AppArmor; cgroups v2 resource limits (CPU/mem/io)
> **Coupling:** 🔴 — thay đổi cách tool được thực thi
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (sandbox EC sẵn — chưa có per-tool container isolate)
> **Effort:** 3-6 tuần

## Nguồn gốc

Containerized tool execution (Docker/Podman namespaces + cgroups): mỗi tool (đặc biệt tool chạy code, shell, fetch) chạy trong **container riêng** — kernel namespace cô lập filesystem/process/network, cgroups giới hạn CPU/mem/io, seccomp/AppArmor lọc syscall. OpenAI Code Interpreter chạy code user trong sandbox riêng — nếu code độc cũng không thoát. Firecracker microVM cho isolation nặng hơn (mỗi task 1 VM). gVisor chặn syscall ở userspace. OWASP Agent Sandboxing: agent chạy code không tin cậy → cô lập để chứa blast radius. Khác **EC (133) agent sandbox** (cô lập *cả agent runtime*) — JN cô lập *per-tool* tinh hơn; khác **275 SSRF prevention** (chặn network cụ thể) — JN cô lập *toàn bộ* resource; khác **179 agent testing sandbox** (CI/CD) — JN runtime production isolation.

## Mô tả

mya containerized tools: tool nguy hiểm (shell, code-exec, file write, network) chạy trong container ephemeral — mount chỉ-read input, scratch volume cho output, network egress qua proxy chặn. Resource limit (cgroup CPU 1 core, mem 512MB, timeout). Tool xong → container huỷ, output thu về. mya có sandbox EC (cô lập agent) — JN thêm per-tool container (blast radius nhỏ hơn, tinh hơn). Tăng overhead start (container boot ~100ms-1s) — dùng pool warm container.

## Kiến trúc

```
  AGENT ──tool_call──► TOOL RUNNER
        │
        ▼
  ┌─ CONTAINER (namespace+cgroup+seccomp) ──────────┐
  │  mount: input (RO)  | scratch (RW, tmpfs)        │
  │  net: egress via proxy (block internal — 275)    │
  │  limits: cpu=1, mem=512M, pids=64, ts=30s        │
  │  seccomp: deny ptrace/mount/keyring...           │
  │        │                                          │
  │   TOOL EXECUTE (shell/code/fetch)                │
  │        │                                          │
  └────────┼──────────────────────────────────────────┘
           ▼
  OUTPUT (thu về) ──► CONTAINER DESTROY (ephemeral)
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ EC (133) agent sandbox — cô lập agent runtime (sẵn nền)
// ✅ 179 agent testing sandbox — CI isolation
// ✅ HG (215) deadline — timeout (sẵn)
// ✅ 275 SSRF — network egress control (bổ sung)

// ❌ THIẾU: per-tool container runner (ephemeral, pooled)
// ❌ THIẾU: cgroup/seccomp profile (resource + syscall limit)
// ❌ THIẾU: RO mount input + tmpfs scratch (contain write)
// ❌ THIẾU: warm container pool (giảm boot overhead)
```

## Implementation

```typescript
// packages/toolbox/src/container.ts (NEW)
async function runInContainer(spec: ToolSpec, input: Buffer): Promise<Buffer> {
  const ctr = await pool.acquire();                       // warm container (giảm boot)
  try {
    await ctr.applyLimits({ cpu: 1, mem: "512m", pids: 64 });   // cgroup
    await ctr.mount(input, { ro: true });                 // input read-only
    await ctr.exec(spec.command, spec.args, { timeoutMs: 30_000 }); // 215 deadline
    return await ctr.readOutput();                        // thu output từ scratch
  } finally {
    await ctr.reset();                                    // huỷ state — pool lại
  }
}
// seccomp deny ptrace/mount/keyring; network qua proxy chặn internal (275)
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Blast radius nhỏ — tool độc không thoát (OpenAI/gVisor) | ❌ Boot overhead (~100ms-1s/container) |
| ✅ Resource limit — tool ăn CPU/mem không kill host (cgroup) | ❌ Phức hạ tầng (container runtime, image, pool) |
| ✅ Syscall filter — chặn ptrace/mount/escape (seccomp) | ❌ Tinh chỉnh profile khó (chặn quá = tool hỏng) |
| ✅ Ephemeral — không state rò giữa tool | ❌ macOS/Windows container support hạn chế |

## Khác các hướng gần

| | EC Agent Sandbox | 275 SSRF | 179 Test Sandbox | JN: Containerized Tool |
|---|---|---|---|---|
| Cô lập gì | Cả agent runtime | Network cụ thể | CI environment | **Per-tool (tinh nhất)** |
| Granularity | Thô | Network | Ngắn hạn | **Tool-level + resource** |
| Khi nào | Agent chạy code không tin | Tool fetch | Trước deploy | **Production, tool nguy hiểm** |

## Khi nào chọn

- Tool chạy code/shell không tin cậy (code interpreter, dynamic eval)
- Cần resource cap (tool nặng không ăn hết host)
- Multi-tenant — tool tenant A không đụng tenant B
- Không dùng khi: tool rẻ/idempotent (overhead container không đáng); hoặc không có container runtime
