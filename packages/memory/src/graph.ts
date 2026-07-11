/**
 * Typed knowledge graph (§8 R35 — entity graph used by both the knowledge://
 * ragfs source and the typed-graph arm of 4-arm RRF).
 *
 * Built lazily from `Brain.backlinks()` (which is the zero-LLM extractor) plus
 * any operator-declared entities/relations (Phase 9 supports both).
 *
 * Source: §8 R35 "typed knowledge graph (`links(from,to,link_type,link_source)`)".
 */

export interface KGEntity {
  id: string;          // canonical slug (e.g. "Alice")
  type?: string;       // e.g. "person" — operator-supplied
  aliases: string[];   // alternate forms
}

export interface KGRelation {
  from: string;
  to: string;
  kind: "link" | "wikilink" | "bare";
  /** Source fact id (for provenance). */
  source: string;
}

/** An in-memory knowledge graph (the Phase-9 spec row). */
export class TypedGraph {
  private readonly entities = new Map<string, KGEntity>();
  /** Adjacency: from → relation[] (directed). */
  private readonly edges = new Map<string, KGRelation[]>();

  /** Declare an entity (idempotent; aliases unioned). */
  addEntity(e: KGEntity): void {
    const ex = this.entities.get(e.id);
    if (!ex) this.entities.set(e.id, { ...e, aliases: [...new Set(e.aliases)] });
    else for (const a of e.aliases) if (!ex.aliases.includes(a)) ex.aliases.push(a);
  }

  /** Add a directed relation. Both endpoints are auto-declared if absent. */
  addRelation(r: KGRelation): void {
    if (!this.entities.has(r.from)) this.addEntity({ id: r.from, aliases: [] });
    if (!this.entities.has(r.to)) this.addEntity({ id: r.to, aliases: [] });
    const adj = this.edges.get(r.from);
    if (adj) adj.push(r);
    else this.edges.set(r.from, [r]);
  }

  /** Seed the graph from `brain.backlinks()` output (typed-graph ingestion).
   * CRITICAL-1 (review): `from` is the fact's ENTITY (not the fact id) so the
   * graph is entity→entity, not UUID-stub→entity. */
  ingestBacklinks(edges: { from: string; fromFactId?: string; to: string; kind: KGRelation["kind"] }[]): void {
    for (const e of edges) {
      this.addRelation({ from: e.from, to: e.to, kind: e.kind, source: e.fromFactId ?? e.from });
    }
  }

  /** All entities. */
  allEntities(): KGEntity[] { return [...this.entities.values()]; }
  /** Outgoing edges for `id`. */
  out(id: string): KGRelation[] { return this.edges.get(id) ?? []; }

  /**
   * Hop-distance query (§8 R35 "auto-link zero-LLM"). Return entities
   * reachable within `maxDepth` hops; include their hop-distance. Self (id) is
   * distance 0 if present. Empty if the seed is unknown.
   */
  query(seed: string, maxDepth = 2): Array<{ id: string; dist: number; rel: KGRelation[] }> {
    // H1 (review): an unknown seed returns [] (per the JSDoc; the old code
    // returned a spurious dist-0 node for any id).
    if (!this.entities.has(seed)) return [];
    const results: Array<{ id: string; dist: number; rel: KGRelation[] }> = [];
    const seen = new Set<string>([seed]);
    let frontier: { id: string; path: KGRelation[] }[] = [{ id: seed, path: [] }];
    for (let d = 0; d <= maxDepth && frontier.length > 0; d++) {
      const nextFrontier: typeof frontier = [];
      for (const node of frontier) {
        results.push({ id: node.id, dist: d, rel: node.path });
        if (d === maxDepth) continue;
        for (const e of this.out(node.id)) {
          // H2 (review): case-sensitive to match storage (entities/edges Maps).
          if (seen.has(e.to)) continue;
          seen.add(e.to);
          nextFrontier.push({ id: e.to, path: [...node.path, e] });
        }
      }
      frontier = nextFrontier;
    }
    return results;
  }

  /** Spec R36: `entities(id:type)[name]…` + `relations[from,to,kind,source]`.
   * Most fields are filled by retrieveArm/ingest; phase 9 leaves them as
   * the empty-graph defaults. */
  knowledgeGraphSpec(): { entities: { id: string; type: string; name: string }[]; relations: { from: string; to: string; kind: string; link_source?: string }[] } {
    return {
      entities: this.allEntities().map((e) => ({ id: e.id, type: e.type ?? "unknown", name: e.id })),
      relations: [...this.edges.values()].flat().map((r) => ({ from: r.from, to: r.to, kind: r.kind, link_source: r.source })),
    };
  }
}
