# Hướng W: Content-Addressable DAG — reasoning là Merkle tree

> **Nguồn gốc:** Git (Torvalds, 2005), IPFS (Benet, 2014), Merkle trees (1979)
> **Coupling:** 🟢 Content-addressed (hash = identity)
> **Agent-agnostic:** ✅ — bất kỳ agent produce thoughts
> **Code sẵn:** ✅ AuditLog (Merkle hash-chain)

## Nguồn gốc

Git's internal object model (Linus Torvalds, 2005). IPFS (Benet, 2014). Merkle trees (Ralph Merkle, 1979).

**Tham chiếu:**
- Torvalds, L. (2005). Git initial design.
- Benet, J. (2014). "IPFS." arXiv:1407.3561.
- Merkle, R. C. (1987). "A Digital Signature Based on a Conventional Encryption Function." CRYPTO '87.

## Mô tả

Mỗi agent "thought" là content-addressed node trong DAG. Identical thoughts → same hash (dedup). Mỗi thought reference parents (causal dependencies). Branching + merging reasoning paths. Immutable. Provable. Queryable.

## Kiến trúc

```
┌──────────────────────────────────────────────────────────────┐
│              CONTENT-ADDRESSABLE REASONING DAG                │
│                                                               │
│  Mỗi "thought" được content-address:                        │
│                                                               │
│  sha256:a1b2 { type:"prompt", "fix auth bug" }              │
│       │                                                       │
│       ├── sha256:e5f6 { type:"read", file:"auth.ts" }       │
│       │    └── sha256:i9j0 { type:"reason", "line 42 bug" } │
│       │         └── sha256:k1l2 { type:"edit", "+null guard"}│
│       │              └── sha256:o5p6 { type:"test", pass }  │
│       │                   └── sha256:w3x4 { "done!" }       │
│       │                                                       │
│       └── sha256:m7n8 { type:"grep", "similar bugs" }       │
│            └── sha256:q1r2 { "found 2 more" }               │
│                 └── (merge vào w3x4)                        │
│                                                               │
│  Thuộc tính:                                                 │
│  · Dedup: cùng thought = cùng hash (không trùng LLM call)   │
│  · Provable: hash-chain chứng minh causal order             │
│  · Branchable: nhiều agent reasoning song song → merge     │
│  · Immutable: thought không sửa, chỉ supersede              │
│  · Shareable: export thư mục files, import ở hệ khác        │
│                                                               │
│  mya ĐÃ CÓ Merkle audit log — chỉ cần mở rộng thành DAG.   │
└──────────────────────────────────────────────────────────────┘
```

## Node structure

```typescript
interface ReasoningNode {
  hash: string;              // sha256(content + parentHashes)
  type: "prompt" | "tool_call" | "tool_result" | "reasoning" | "response" | "error";
  content: string;           // The actual thought
  parents: string[];         // Hash references to parent nodes
  agentId: string;           // Who produced this
  timestamp: number;
  metadata?: {
    tokensUsed?: number;
    cost?: number;
    toolName?: string;
    toolInput?: unknown;
  };
}
```

## Storage (filesystem, like .git/objects)

```
.mya/dag/
  sha256/
    a1/
      b2c3d4...  ← { hash: "a1b2c3d4...", type: "prompt", content: "fix auth" }
    e5/
      f6g7h8...  ← { hash: "e5f6g7h8...", type: "read", parents: ["a1b2c3d4..."] }
    i9/
      j0k1l2...  ← { hash: "i9j0k1l2...", type: "reason", parents: ["e5f6g7h8..."] }
```

## Properties

### Deduplication
```
Agent A reasons: "The bug is on line 42"
  → sha256("The bug is on line 42" + parentHash) = abc123

Agent B independently reasons: "The bug is on line 42"
  → sha256("The bug is on line 42" + parentHash) = abc123  (SAME HASH!)

→ No duplicate storage. No duplicate LLM cost.
```

### Branching + Merging
```
Agent A explores: read → reason → edit (branch A)
Agent B explores: grep → reason → patch (branch B)
→ Merge: both branches' results merge at a common child
```

### Time Travel
```
git log for reasoning:
$ mya dag log
sha256:w3x4 "done!" (turn 5)
sha256:o5p6 "tests pass" (turn 4)
sha256:k1l2 "edit auth.ts:42" (turn 3)
sha256:i9j0 "found bug on line 42" (turn 2)
sha256:e5f6 "read auth.ts" (turn 1)
sha256:a1b2 "fix auth bug" (turn 0)

$ mya dag trace w3x4
→ shows full reasoning chain from prompt to conclusion
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Built-in deduplication (same thought = same hash) | ❌ No mutation (must supersede) |
| ✅ Provable provenance (trace to root causes) | ❌ Storage growth (GC needed) |
| ✅ Branching/merging reasoning paths | ❌ Not human-friendly (hash files) |
| ✅ Immutable history (tamper-evident) | ❌ Conflict resolution on merge |
| ✅ Shareable (directory of files) | ❌ Hashing overhead |

## mya đã có Merkle audit

```typescript
// packages/audit/src/index.ts — hash-chain
hash_n = sha256(prevHash + JSON.stringify(record))

// Hướng W: mở rộng thành DAG
hash_n = sha256(content + parentHashes.join(","))
// parents can be multiple → DAG (not just chain)
```

## Khi nào chọn

- Want provable reasoning chain (audit + traceability)
- Want deduplication (same conclusion = same hash)
- Need branching/merging (parallel agent exploration)
- Want shareable reasoning (export/import DAG)
- Already have Merkle audit (extend to DAG)
