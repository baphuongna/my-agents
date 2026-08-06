# Hướng DDDDDD: Agent Sandbox — cô lập runtime để agent chạy code không tin cậy

> **Nguồn gốc:** Edera "AI Agent Sandbox vs Containers" 2026; Augment Code "Agent Execution Sandbox" (microVMs, default-deny); Northflank "How to sandbox AI agents in 2026" (Firecracker/gVisor); Blaxel "Container Escape Vulnerabilities" 2026; CSA "AI Coding Agent Sandbox Escapes" 2026
> **Coupling:** 🟡 — thay đổi cách thực thi lệnh (shell/MCP phải đi qua sandbox)
> **Agent-agnostic:** ⚠️ — phụ thuộc runtime (container/microVM/gVisor)
> **Code sẵn:** ⚠️ (shell/exec + policy WW sẵn; thiếu isolation runtime)
> **Effort:** 2-4 tuần

## Nguồn gốc

Agent sandbox: **isolation boundary giới hạn blast radius khi agent chạy code không tin cậy** — Edera: "designed to limit the blast radius when an AI agent executes untrusted or unexpected code"; Augment: "isolates AI-generated code at runtime using microVMs, default-deny policies, escape prevention"; Northflank 2026: so sánh Firecracker (microVM — phần cứng), gVisor (userspace kernel), Docker (container — kernel dùng chung); Blaxel 2026: "container isolation designed for web apps fails when AI agents generate code from untrusted inputs" — kernel exploit thoát container; CSA 2026: "a file written inside a sandbox becomes dangerous only when something with more authority than the sandbox acts on it" — trust handoff là lỗ hổng thật. Điểm khác **TEE (IIII)** (bảo vệ dữ liệu khỏi hạ tầng) và **WW policy** (chặn hành động) — DDDDDD *cô lập thực thi*: agent prompt-injected chạy lệnh độc trong sandbox cũng không đụng được host; default-deny egress (Reddit/LocalLLaMA: "no outbound internet unless..."), file system giới hạn, network cô lập, tài nguyên có trần. Nối WW (chặn lệnh nguy hiểm — tầng thứ 2), FF firewall (bảo vệ prompt), UUUU (quyền tối thiểu trong sandbox).

## Mô tả

mya sandbox: (1) **runtime chọn theo độ tin cậy** — agent tự viết/code LLM sinh = microVM (Firecracker — phần cứng cô lập); agent quen thuộc, công việc thường = container/gVisor (rẻ hơn); (2) **default-deny** — không ra mạng ngoài trừ allowlist (egress), chỉ đọc/ghi đường dẫn được phép (workspace mount), exec chỉ tool đã đăng ký; (3) **trần tài nguyên** — CPU/RAM/disk/timeout (SS cost gate), ngăn fork bomb/loop; (4) **trust handoff** — file ra khỏi sandbox phải qua móc xác thực: vùng tin cậy chỉ đọc từ mount được ký/hash (CSA: kẻ tấn công lợi dụng handoff) — file ra ngoài được scan lại; (5) **escape watch** — theo dõi container escape vector (mount host, setuid, /proc), alert khi nghi ngờ (VV + BBBBBB watchdog); (6) **ef tương tác** — shell/MCP command đi qua sandbox runner thay vì thực thi thẳng host.

## Kiến trúc

```
  AGENT ──► SHELL/MCP ──► SANDBOX RUNNER (thay vì exec host)
                              │
        ┌─────────────────────┼──────────────────────┐
        ▼                     ▼                      ▼
   MICROVM (Firecracker)  CONTAINER/gVisor      TRẦN TÀI NGUYÊN
   code LLM sinh/không    agent quen thuộc      CPU/RAM/disk/time (SS)
   tin cậy — phần cứng    rẻ hơn
        │                     │
        ▼                     ▼
   DEFAULT-DENY: egress allowlist · fs chỉ mount cho phép · exec whitelist
        │
        ▼
   TRUST HANDOFF GATE: file ra ngoài phải scan/verify (CSA — lỗ hổng thật)
        │
        ▼
   ESCAPE WATCH (VV + BBBBBB) — alert khi nghi container escape
```

```
mya: shell/exec + WW policy SẸN — thiếu: sandbox runtime + default-deny + handoff gate
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ shell/exec — nguồn lệnh (đưa qua sandbox runner)
// ✅ WW policy engine — chặn lệnh nguy hiểm (tầng 2 sau sandbox)
// ✅ UUUU dynamic perms — quyền tối thiểu bên trong sandbox
// ✅ SS cost gate — trần tài nguyên (timeout/chi phí)
// ✅ VV + BBBBBB — escape watch (audit + giám sát)

// ❌ THIẾU: sandbox runtime (microVM/container/gVisor)
// ❌ THIẾU: default-deny (egress allowlist, fs mount giới hạn)
// ❌ THIẾU: trust handoff gate (file ra ngoài phải verify)
```

## Implementation

```typescript
// packages/sandbox/src/runner.ts (NEW)
export class SandboxRunner {
  async exec(cmd: Command, ctx: SandboxCtx): Promise<Result> {
    const rt = ctx.trust === "untrusted" ? microvm(ctx) : gVisor(ctx); // theo độ tin cậy
    const out = await rt.run(cmd, {
      network: allowlist(ctx.egress),      // default-deny — Reddit/LocalLLaMA
      fs: mountOnly(ctx.workspace),        // chỉ workspace
      limits: { cpu, mem, disk, timeout: costGate(ctx) }, // SS
    });
    return this.verifyEgress(out);          // trust handoff gate (CSA 2026)
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Prompt-injected chạy lệnh độc cũng không hại host | ❌ Latency — mỗi lệnh qua microVM/container |
| ✅ Default-deny egress chặn đánh cắp dữ liệu | ❐ Chi phí hạ tầng (microVM nặng) |
| ✅ Trần tài nguyên ngăn DoS/loop | ❌ Vẫn có đường escape (kernel, handoff — CSA) |
| ✅ Cô lập đúng độ tin cậy (microVM vs container) | ❌ Phức tạp — ít máy 1 người không đáng |

## Khác các hướng gần

| | IIII TEE | WW Policy | DDDDDD: Sandbox |
|---|---|---|---|
| Bảo vệ | Dữ liệu khỏi hạ tầng | Hành động (chặn lệnh) | **Thực thi (cô lập runtime)** |
| Cơ chế | Enclave | Rules engine | **MicroVM/container/gVisor** |
| Kết hợp | TEE chạy trong | Tầng 2 sau sandbox | **Tầng 1 — chạy code không tin cậy** |

## Khi nào chọn

- Agent thực thi code LLM sinh/tự viết (tool maker AA, code agent)
- Agent đọc input không tin cậy (web, file ngoài — rủi ro prompt injection)
- Cần chặn exfiltration (default-deny egress)
- Đã có WW+UUUU+SS — thêm sandbox runner + handoff gate