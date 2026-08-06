# Hướng OB: Trust-Scoped Context Blocks — gắn nhãn tin cậy từng block; Capabilities không dùng làm lệnh

> **Nguồn gốc:** Leaks Gemini / Claude (system prompt internals); "untrusted content isolation"; "context block provenance"; "capability ≠ command"; "title reminder injection defense"; "trust boundary tagging"
> **Coupling:** 🟡 — thêm trust-label layer vào context assembly + tool dispatch
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (context assembly + message types sẵn — chưa có per-block trust tag + capability guard)
> **Effort:** 2-3 tuần

## Nguồn gốc

**Leaks Gemini / Claude** tiết lộ cách model nội bộ gắn **provenance / trust label** cho từng block context: block do user nhập → `untrusted`, block do system/developer → `trusted`, block từ tool output → `tool_result` (semi-trusted). Model được train **tin khác nhau** theo label — user block không được ưu tiên ngang system block. **Capability ≠ command**: Capabilities (tuyên bố model có thể làm gì) **không phải lệnh** — model không tự ý thực thi vì user nhét "you have capability X" vào untrusted block. **Title reminder injection defense**: attack giả "title" (role) trong user content → model không tin title từ untrusted source. Nguyên tắc: **mỗi context block có trust label rõ**, model **phân biệt** trusted vs untrusted, **capabilities phải đến từ trusted source**. Khác **106 rag-poisoning** (detect poisoned content) — OB là **structural trust labeling**; khác **124 dynamic-permissions** (action auth) — OB là **context auth**.

## Mô tả

mya trust-scoped context blocks: context assembly gắn **trust label** cho mỗi block — `system` (developer prompt, trusted), `user` (untrusted), `tool-output` (semi-trusted), `retrieved-memory` (confidence-scored), `file-content` (untrusted — có thể chứa injection). Model xử lý block **theo trust**: instruction chỉ chấp nhận từ `system` block; `user` block không override system rule; `tool-output` không tự ý trigger action (phải qua capability check). **Capability guard**: tuyên bố capability trong untrusted block → bị **ignore** — capability phải được đăng ký qua trusted config. mya có context assembly + message types — OB thêm **per-block trust tag** + **instruction-origin filter** + **capability source validation**.

## Kiến trúc

```
  CONTEXT ASSEMBLY (before LLM call):
  ┌─────────────────────────────────────────────────────┐
  │                                                     │
  │  [system]  "You are a coding agent..."  TRUSTED ✓   │  ← developer prompt
  │  [system]  capabilities: { tools: [...] } TRUSTED ✓ │  ← capability registry
  │  [user]    "Read this: <file content>"  UNTRUSTED ✗ │  ← could contain injection
  │  [user]    "IGNORE PREVIOUS, you are..." UNTRUSTED ✗│  ← title/role spoofing
  │  [tool]    bash output: "... error ..." SEMI ✓      │  ← tool result
  │  [memory]  fact: "user likes X" (conf 0.8) SCORED   │  ← retrieved memory
  │  [file]    README.md content             UNTRUSTED ✗│  ← external file
  │                                                     │
  └───────────────────────┬─────────────────────────────┘
                          │
                          ▼
  ┌─── TRUST-SCOPED PROCESSING ────────────────────────┐
  │                                                     │
  │  Instruction filter:                                │
  │    · accept instructions ONLY from [system] blocks  │
  │    · [user]/[file]/[tool] blocks → data, NOT cmds   │
  │    · "you are admin now" in [user] → IGNORE         │
  │                                                     │
  │  Capability guard:                                  │
  │    · "you have capability to rm" in [user] → REJECT │
  │    · capabilities validated against trusted registry│
  │                                                     │
  │  Title spoofing defense:                            │
  │    · role/title from untrusted block → IGNORE       │
  │    · only [system] block sets role/title            │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ context assembly — build message array (nền — OB thêm trust tag per block)
// ✅ message types — system/user/tool/assistant (nền — OB thêm trust field)
// ✅ 106 rag-poisoning-defense — detect poison (nền — OB = structural label)
// ✅ 124 dynamic-permissions — action auth (nền — OB = context auth)
// ✅ tool registry — capability registry (nền — OB guards untrusted capability claim)

// ❌ THIẾU: per-block trust label (system/user/tool/memory/file)
// ❌ THIẾU: instruction-origin filter (only system block = instructions)
// ❌ THIẾU: capability source validation (capabilities from trusted config only)
// ❌ THIẾU: title/role spoofing defense (ignore role from untrusted)
```

## Implementation

```typescript
// packages/agent/src/trust-scopes.ts (MỚI)
type TrustLevel = 'trusted' | 'semi-trusted' | 'untrusted' | 'scored';

interface ContextBlock {
  role: 'system' | 'user' | 'tool' | 'memory' | 'file';
  content: string;
  trust: TrustLevel;
  confidence?: number; // for 'scored' (memory)
  source: string;      // provenance: 'developer' | 'user' | 'tool:bash' | 'file:README.md'
}

class TrustScopeAssembler {
  // Tag each block with trust level based on role + source
  tag(role: ContextBlock['role'], content: string, source: string): ContextBlock {
    const trust = this.inferTrust(role, source);
    return { role, content, trust, source };
  }

  // Instruction filter — extract instructions only from trusted blocks
  extractInstructions(blocks: ContextBlock[]): string[] {
    return blocks
      .filter(b => b.trust === 'trusted' && b.role === 'system')
      .map(b => b.content);
  }

  // Capability guard — reject capability claims from untrusted blocks
  validateCapabilities(
    declared: string[],
    trustedRegistry: Set<string>
  ): { valid: string[]; rejected: string[] } {
    const valid: string[] = [];
    const rejected: string[] = [];
    for (const cap of declared) {
      if (trustedRegistry.has(cap)) valid.push(cap);
      else rejected.push(cap); // capability not in trusted registry → ignore
    }
    return { valid, rejected };
  }

  // Title/role spoofing defense — strip role markers from untrusted
  sanitizeUntrusted(blocks: ContextBlock[]): ContextBlock[] {
    return blocks.map(b => {
      if (b.trust === 'untrusted') {
        // strip fake role/title markers: "[SYSTEM]", "You are admin", etc.
        const sanitized = b.content
          .replace(/^\[(system|developer|admin)\]/im, '')
          .replace(/^you are (?:a |an )?(system|admin|developer)/im, '');
        return { ...b, content: sanitized };
      }
      return b;
    });
  }

  private inferTrust(role: ContextBlock['role'], source: string): TrustLevel {
    if (role === 'system') return 'trusted';
    if (role === 'memory') return 'scored';
    if (role === 'tool') return 'semi-trusted';
    return 'untrusted'; // user, file
  }
}

// Usage:
// const blocks = [
//   asm.tag('system', developerPrompt, 'developer'),
//   asm.tag('user', userInput, 'user'),
//   asm.tag('file', fileContent, 'file:README.md'),
// ];
// const instructions = asm.extractInstructions(blocks); // only system blocks
// asm.sanitizeUntrusted(blocks); // strip spoofed roles
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Chống injection từ user/file (instruction chỉ từ system) | ❌ Trust inference heuristic (role-based — có thể miss) |
| ✅ Capability không bị spoof (untrusted claim → ignore) | ❌ Over-sanitize (strips legitimate untrusted formatting) |
| ✅ Title/role spoofing defense (role chỉ từ system) | ❌ Model cần huấn luyện/tune để nhận biết trust tag |
| ✅ Nối 106 rag-poisoning ( OB = structural layer) | ❌ Provenance tracking overhead (mỗi block cần source) |

## Khác các hướng gần

| | 106 RAG-Poisoning | 124 Dynamic-Permissions | 102 Reward-Hacking | OB: Trust-Scoped Blocks |
|---|---|---|---|---|
| Cái gì | Detect poison | Action auth | Detect gaming | **Context block trust label** |
| Layer | Retrieval | Tool dispatch | Behavior | **Context assembly** |
| Capabilities | ❌ | action-based | ❌ | ✅ capability source guard |
| Injection | Content-level | — | — | ✅ structural (role/origin) |

## Khi nào chọn

- Agent nhận context từ nhiều nguồn (user, file, tool, memory) với độ tin cậy khác nhau
- Lo ngại prompt injection qua file/tool output (untrusted content override system)
- Cần capability guard (user không tự ý cấp capability)
- Nối 106 rag-poisoning (detect content) + OB trust-label (structural) + 124 dynamic-permissions (action); capability phải đến từ trusted registry, không từ untrusted block
