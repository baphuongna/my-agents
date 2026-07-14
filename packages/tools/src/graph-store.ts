/**
 * GraphStore — persistent symbol + reference graph storage (§11.3 / Phase B).
 *
 * Backed by plain Maps for MVP (Map-based per the Phase B plan). A JSON
 * snapshot round-trip (`toJSON` / `fromJSON`) gives "persistence" without
 * pulling in SQLite. Three indexes on top of the symbol map:
 *
 *   - byName:  lower(name) → Set<symbolId>         (findDefinitions)
 *   - byFile:  file path    → Set<symbolId>         (getRelatedFiles)
 *   - byRef:   symbolId     → Reference[] pointing AT the symbol
 *                                               (findReferences / getCallGraph)
 *
 * Insertion order is preserved (Map iteration order is insertion order); a
 * reverse `byCallee` / caller-lookup cache is built lazily inside the
 * reference-graph module on first `getCallGraph` call.
 *
 * No I/O happens here — pure in-memory. File walking lives in
 * `symbol-extractor.ts`; serialization is a flat JSON snapshot.
 */
import type { Symbol } from "./symbol-extractor.js";
import type { Reference } from "./reference-graph.js";

export interface GraphSnapshot {
  /** Schema version. Bump on shape changes so callers can refuse to load stale
   * snapshots (deterministic; byte-faithful). */
  version: 1;
  symbols: Symbol[];
  refs: Reference[];
}

export class GraphStore {
  /** id → Symbol */
  readonly symbols: Map<string, Symbol> = new Map();
  /** id → References that target this symbol */
  readonly refs: Map<string, Reference[]> = new Map();
  /** lower(name) → ids */
  readonly byName: Map<string, Set<string>> = new Map();
  /** file → ids */
  readonly byFile: Map<string, Set<string>> = new Map();

  /** Insert a Symbol. Replaces any prior symbol with the same id (id is
   * `${file}:${line}:${col}:${name}` so duplicates indicate a parser re-pass
   * on the same file — first-write wins also keeps external map order stable). */
  addSymbol(s: Symbol): void {
    if (this.symbols.has(s.id)) return;
    this.symbols.set(s.id, s);
    const nameIdx = this.byName.get(s.name.toLowerCase());
    if (nameIdx) nameIdx.add(s.id);
    else this.byName.set(s.name.toLowerCase(), new Set([s.id]));
    const fileIdx = this.byFile.get(s.file);
    if (fileIdx) fileIdx.add(s.id);
    else this.byFile.set(s.file, new Set([s.id]));
  }

  /** Append a Reference to the target symbol's incoming-reference list. Does
   * NOT auto-insert the target Symbol — callers must add both sides for
   * `findReferences` / `findDefinitions` to be symmetric. */
  addReference(r: Reference): void {
    const list = this.refs.get(r.symbolId);
    if (list) list.push(r);
    else this.refs.set(r.symbolId, [r]);
  }

  get(id: string): Symbol | undefined {
    return this.symbols.get(id);
  }

  /** All symbol ids whose name (case-folded) equals `name`. */
  idsByName(name: string): string[] {
    const set = this.byName.get(name.toLowerCase());
    return set ? [...set] : [];
  }

  /** All symbol ids defined in `file`. */
  idsByFile(file: string): string[] {
    const set = this.byFile.get(file);
    return set ? [...set] : [];
  }

  /** Total symbol count (for diagnostics / tests). */
  get size(): number {
    return this.symbols.size;
  }

  /** Serialize for persistence. Stable key order: symbols sorted by id, refs
   * sorted by (symbolId, fromFile, fromRange.start.line, kind). */
  toJSON(): GraphSnapshot {
    const symbols = [...this.symbols.values()].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    const refs: Reference[] = [];
    for (const list of this.refs.values()) refs.push(...list);
    refs.sort((a, b) => {
      if (a.symbolId !== b.symbolId) return a.symbolId < b.symbolId ? -1 : 1;
      if (a.fromFile !== b.fromFile) return a.fromFile < b.fromFile ? -1 : 1;
      return a.fromRange.start.line - b.fromRange.start.line;
    });
    return { version: 1, symbols, refs };
  }

  /** Rebuild a GraphStore from a snapshot. Unknown version → error. */
  static fromJSON(snap: GraphSnapshot): GraphStore {
    if (snap.version !== 1) {
      throw new Error(`GraphStore.fromJSON: unsupported version ${snap.version}`);
    }
    const store = new GraphStore();
    for (const s of snap.symbols) store.addSymbol(s);
    for (const r of snap.refs) store.addReference(r);
    return store;
  }
}
