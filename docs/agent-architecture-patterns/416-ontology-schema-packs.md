# Hướng OZ: Ontology Schema Packs — packs type/verbs+facts cho KG, thêm pack không đụng parser

> **Nguồn gốc:** gbrain (ontology schema packs); "pluggable ontology packs for knowledge graph"; "type/verb/fact schema packs"; "add pack without parser rewrite"; "domain-specific KG schema modules"
> **Coupling:** 🟡 — thêm pluggable ontology-pack system trên KG
> **Agent-agnostic:** ✅
> **Code sẵn:** ⚠️ (AST-KG + knowledge-graph sẵn — chưa có pluggable ontology packs)
> **Effort:** 3 tuần

## Nguồn gốc

**gbrain** knowledge graph (KG) dùng **ontology schema packs** — mỗi pack define **types + verbs + fact templates** cho một domain. Vd pack `code` define type `Function`, `Module`, verb `calls`, `imports`; pack `devops` define type `Service`, `Deploy`, verb `deploys-to`, `depends-on`. Thêm pack **không đụng parser** — parser chỉ cần biết pack schema, không hardcode. Nguyên tắc: **KG schema modular** — thêm domain mới = thêm pack, không rewrite core. Khác **348 MJ AST-KG** — OZ là **pluggable schema** (không phải fixed code-KG); khác **416... ** — OZ packs cho KG extensibility.

## Mô tả

mya ontology schema packs: (1) **Pack format** — define types, verbs, fact templates (schema). (2) **Registry** — load/unload packs tại runtime. (3) **Parser adapter** — parser dùng pack schema để extract facts (không hardcode type/verb). (4) **Add pack** = register schema → KG chấp nhận type/verb mới. mya có `348 MJ AST-KG` — OZ thêm **pluggable ontology-pack system**.

## Kiến trúc

```
  ┌─── ONTOLOGY PACK REGISTRY ─────────────────────────┐
  │                                                     │
  │  PACK "code":                                       │
  │    types:  [Function, Module, Class]                │
  │    verbs:  [calls, imports, extends]                │
  │    facts:  Function --calls--> Function             │
  │            Module --imports--> Module               │
  │                                                     │
  │  PACK "devops":                                     │
  │    types:  [Service, Deploy, Container]             │
  │    verbs:  [deploys-to, depends-on, scales]         │
  │    facts:  Service --deploys-to--> Container        │
  │                                                     │
  │  PACK "team":  (ADD mới — không đụng parser)        │
  │    types:  [Person, Team, Role]                     │
  │    verbs:  [owns, reports-to, reviews]              │
  └───────────────────────┬─────────────────────────────┘
                          │ register pack
                          ▼
  ┌─── KG (accepts all pack types/verbs) ──────────────┐
  │  [auth()] --calls--> [validate()]    (code pack)    │
  │  [api-svc] --deploys-to--> [docker-1] (devops pack) │
  │  [Alice] --owns--> [auth module]      (team pack)   │
  │  → parser dùng pack schema, không hardcode          │
  └─────────────────────────────────────────────────────┘
```

## mya ĐÃ CÓ (1 phần)

```typescript
// ✅ 348 MJ AST-KG — code knowledge graph (nền — OZ = pluggable schema)
// ✅ 396 OF repo-graph-planning — graph planning (nền — OZ packs cho graph)
// ✅ 181 tool-orchestration-graph — tool graph (nền — OZ = schema packs)
// ✅ 388 skill-lifecycle — plugin lifecycle (nền — OZ = pack lifecycle)

// ❌ THIẾU: ontology-pack format (types/verbs/facts schema)
// ❌ THIẾU: pack registry (load/unload runtime)
// ❌ THIẾU: parser adapter (extract via pack schema, không hardcode)
```

## Implementation

```typescript
// packages/agent/src/memory/ontology-packs.ts (MỚI)
interface OntologyPack {
  name: string;
  types: string[];           // e.g. ['Function', 'Module']
  verbs: string[];           // e.g. ['calls', 'imports']
  factTemplates: { from: string; verb: string; to: string }[];
}

interface KGFact {
  from: string; type: string;
  verb: string;
  to: string; type2: string;
  pack: string;
}

class OntologyPackRegistry {
  private packs = new Map<string, OntologyPack>();
  private kg: KGFact[] = [];

  register(pack: OntologyPack): void {
    this.packs.set(pack.name, pack);
    // parser không cần rewrite — chỉ cần biết pack schema
  }

  unregister(name: string): void {
    this.packs.delete(name);
    this.kg = this.kg.filter(f => f.pack !== name);  // remove pack's facts
  }

  // Validate fact against pack schema (parser uses this)
  validate(packName: string, from: string, verb: string, to: string): boolean {
    const pack = this.packs.get(packName);
    if (!pack) return false;
    if (!pack.verbs.includes(verb)) return false;
    return pack.factTemplates.some(t => t.verb === verb);  // template exists
  }

  // Add fact (validated against pack)
  addFact(packName: string, from: string, verb: string, to: string): { ok: boolean } {
    if (!this.validate(packName, from, verb, to)) return { ok: false };
    const pack = this.packs.get(packName)!;
    this.kg.push({ from, type: pack.types[0]!, verb, to, type2: pack.types[0]!, pack: packName });
    return { ok: true };
  }

  // Query KG by pack or verb
  query(opts: { pack?: string; verb?: string }): KGFact[] {
    return this.kg.filter(f =>
      (!opts.pack || f.pack === opts.pack) &&
      (!opts.verb || f.verb === opts.verb),
    );
  }
}

// Usage:
// const reg = new OntologyPackRegistry();
// reg.register({ name: 'code', types: ['Function'], verbs: ['calls', 'imports'], factTemplates: [{from:'Function',verb:'calls',to:'Function'}] });
// reg.addFact('code', 'auth()', 'calls', 'validate()');  // ✅ valid
// reg.addFact('code', 'auth()', 'unknown-verb', 'x');    // ❌ invalid (verb not in pack)
// reg.register({ name: 'team', types: ['Person'], verbs: ['owns'], ... });  // add new pack, no parser change
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Modular schema (thêm domain = thêm pack) | ❌ Pack schema design upfront (type/verb plan) |
| ✅ Không đụng parser (schema-driven extraction) | ❌ Validation overhead (check mỗi fact) |
| ✅ Multi-domain KG (code + devops + team) | ❌ Pack conflict (verb trùng tên pack khác) |
| ✅ Nối 348 MJ (code KG = 1 pack) | ❌ Cold-start (pack rỗng → KG trống) |

## Khác các hướng gần

| | 348 MJ AST-KG | 396 OF Repo-Graph | 181 Tool-Graph | OZ: Ontology-Packs |
|---|---|---|---|---|
| Cái gì | Code KG | Plan trên graph | Tool graph | **Pluggable schema packs** |
| Schema | Fixed (code) | Fixed (deps) | Fixed (tools) | **Per-pack modular** |
| Extend | Rewrite parser | ❌ | ❌ | ✅ add pack |
| Domain | Code only | Code | Tools | **Multi-domain** |

## Khi nào chọn

- KG cần nhiều domain (code + devops + team + ...)
- Muốn thêm domain mà không rewrite parser
- Cần schema-driven extraction (type/verb từ pack)
- Nối 348 MJ AST-KG (code pack) + 396 OF repo-graph (code domain) + 388 skill-lifecycle (pack lifecycle); guard pack conflict (namespace verbs) + schema design upfront
