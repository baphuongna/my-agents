# Hướng KH: Agent Message Contracts — schema evolution, versioning giữa agent

> **Nguồn gốc:** Protocol Buffers/Avro schema evolution; gRPC; JSON Schema; Confluent Schema Registry; OpenAPI
> **Coupling:** 🟢 — contract layer tách riêng
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (tool schema sẵn — thiếu message contract + registry)
> **Effort:** 1-2 tuần

## Nguồn gốc

**Schema evolution** (Protobuf/Avro): khi producer nâng schema, consumer cũ vẫn chạy được — **backward compatible** (consumer mới đọc data cũ) và **forward compatible** (consumer cũ đọc data mới). Avro: thêm field phải có default; Protobuf: thêm field = new tag number, không tái dùng tag. Confluent Schema Registry: lưu mọi version, kiểm tra compatibility mỗi publish. Nguyên tắc: contract **phiên bản hóa + đăng ký** — không "bắn tin tự do" giữa service. Với agent: 202 agent-communication-patterns + 54 handoff truyền payload — cần contract ổn định qua version.

## Mô tả

mya inter-agent message contract: khi parent handoff (54) cho subagent, payload (task, context, artifact) có schema đã đăng ký version. Agent v2 gửi message, agent v1 nhận vẫn hiểu (forward compat — field mới bị ignore). Registry lưu mọi schema version, kiểm tra compatible mỗi lần agent upgrade. Khác JSON tự do: contract **đăng ký + check** — break change (đổi kiểu, xoá field) bị chặn. Nối 97 tool-schema-drift (phát hiện) — KH thêm **compatibility gate** (chặn break).

## Kiến trúc

```
  AGENT v2 ──msg──► AGENT v1
  (producer)        (consumer)

  msg payload (schema v2):
    { task, context, priority, deadline }   ← deadline mới (v2)
                    │
                    ▼
  Schema Registry kiểm tra compat:
    v2 = v1 + { deadline } (field mới có default) → COMPATIBLE ✓
                    │
                    ▼
  AGENT v1 (schema v1): nhận → ignore "deadline" (forward compat)
    { task, context, priority }   ← v1 không biết deadline, vẫn chạy

  Break change (xoá "task" / đổi kiểu) → Registry BLOCK → agent không deploy
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 40 tool-registry — tool schema (nền contract)
// ✅ 97 tool-schema-drift — phát hiện schema thay đổi
// ✅ 54 handoff — truyền payload giữa agent
// ✅ 202 agent-communication-patterns — messaging
// ✅ 189 interoperability-protocols — protocol

// ❌ THIẾU: message contract schema (versioned, registered)
// ❌ THIẾU: compatibility check (backward/forward) mỗi publish
// ❌ THIẾU: schema registry (lưu mọi version)
// ❌ THIẾU: default field rule (field mới phải có default)
```

## Implementation

```typescript
// packages/agent/src/contract.ts (NEW)
interface SchemaVersion { version: number; fields: Record<string, { type: string; default?: unknown }>; }

class SchemaRegistry {
  private versions = new Map<string, SchemaVersion[]>();

  register(name: string, next: SchemaVersion): void {
    const prev = this.versions.get(name)?.at(-1);
    if (prev) this.assertCompatible(prev, next); // chặn break change
    this.versions.get(name)!.push(next);
  }

  // Backward/forward compatible: field mới phải có default, không đổi kiểu/xoá
  private assertCompatible(prev: SchemaVersion, next: SchemaVersion): void {
    for (const [k, f] of Object.entries(prev.fields)) {
      const nf = next.fields[k];
      if (!nf) throw new Error(`break: field "${k}" bị xoá`);
      if (nf.type !== f.type) throw new Error(`break: field "${k}" đổi kiểu`);
    }
    for (const [k, nf] of Object.entries(next.fields)) {
      if (!(k in prev.fields) && nf.default === undefined)
        throw new Error(`break: field mới "${k}" thiếu default`);
    }
  }

  // Consumer cũ đọc data mới → bỏ field không biết (forward compat)
  decode(payload: unknown, consumerVersion: number): unknown {
    const schema = this.versions.values().next().value![consumerVersion - 1];
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(schema.fields)) if (k in (payload as object)) out[k] = (payload as any)[k];
    return out;
  }
}
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Agent upgrade dần — cũ/mới cùng chạy (Protobuf/Avro) | ❌ Phải giữ compatibility rule (no break) |
| ✅ Break change bị chặn sớm (registry gate) | ❌ Schema registry = thêm infrastructure |
| ✅ Audit: mọi message version được lưu | ❌ Default field cần thiết kế trước |
| ✅ Nối 97 drift (phát hiện) → KH (chặn break) | ❌ Overhead check mỗi publish |

## Khác các hướng gần

| | 97 Tool Schema Drift | 189 Interop Protocol | KH: Message Contracts |
|---|---|---|---|
| Mục | Phát hiện schema đổi | Chuẩn protocol | **Compatibility + registry** |
| Khi | Tool đổi | A2A | **Agent upgrade dần** |
| Chặn? | Detect (post) | ❌ | ✅ gate trước deploy |
| Version | ❌ | ❌ | ✅ mọi version |

## Khi nào chọn

- Nhiều agent version cùng chạy (upgrade dần, rolling)
- Handoff (54) truyền payload phức tạp (cần ổn định)
- Muốn chặn break change sớm (agent v2 không phá v1)
- Cần audit message qua nhiều version
