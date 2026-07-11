/**
 * ragfs — unified context FS (§8). One URI namespace over memory + skills +
 * knowledge + files; uniform list/read/grep via the ContextSource trait.
 * A read-only aggregation layer (writes stay on the owning subsystem).
 *
 *   memory://<role>/<id>   skill://<name>   knowledge://<doc>   file://<path>
 *
 * R25-18 (scan-on-read): the router is the AUTHORITATIVE scanner — content
 * returned via read/list/grep is run through the configured `RagfsScanner`
 * BEFORE being handed to the caller. A poisoned memory/skill/knowledge
 * entry containing a prompt-injection payload is blocked at the gate.
 *
 * Source: §8; OpenViking (architecture only, AGPL clean-room); mya-v1 context-fs.
 */
import type { MemoryHit, MemoryQuery, MemoryRoleId, ScanVerdict } from "@my-agent/core";

/** A context source serves one URI scheme. */
export interface ContextSource {
  readonly scheme: "memory" | "skill" | "knowledge" | "file";
  list(query: MemoryQuery): Promise<MemoryHit[]>;
  read(uri: string): Promise<string>;
  grep(pattern: string): Promise<MemoryHit[]>;
}

/** §8 R25-18: scans a content string for prompt-injection payloads. Provided
 * by the host at wire-up (core defines the shape; prompts provides a concrete
 * implementation via scanInject). Memory cannot import prompts directly
 * (layering); the Scanner is injected. */
export interface RagfsScanner {
  scan(content: string, scope?: "context" | "wire" | "direct"): ScanVerdict;
}

/** A parsed ragfs URI. */
export interface RagfsUri {
  scheme: ContextSource["scheme"];
  /** The path after the scheme (e.g. role/id, name, doc, file path). */
  rest: string;
}

/** Parse a ragfs URI. Lowercases the scheme; decodes %-escapes in rest;
 * rejects malformed URIs outright (no silent key fallback). */
export function parseRagfsUri(uri: string): RagfsUri | null {
  if (typeof uri !== "string") return null;
  const m = uri.match(/^(memory|skill|knowledge|file):\/\/(.+)$/i);
  if (!m) return null;
  let rest = m[2]!;
  try { rest = decodeURIComponent(rest); } catch { return null; }
  // Trim 2+ leading slashes only (file:///path keeps its single leading /).
  rest = rest.replace(/^\/{2,}/, "");
  if (!rest) return null;
  return { scheme: m[1]!.toLowerCase() as ContextSource["scheme"], rest };
}

/** Sentinel string returned when a read/list/grep hit fails the scan. */
export const RAGFS_BLOCKED = "[BLOCKED: ragfs scan rejected content]";

/** Map a scheme → MemoryRoleId for hit-tagging. */
const SCHEME_ROLE: Record<ContextSource["scheme"], MemoryRoleId> = {
  memory: "working",
  skill: "archivist",
  knowledge: "tree",
  file: "diff",
};

/**
 * The ragfs router. Registers one ContextSource per scheme; routes list/read/
 * grep to the matching source; scans content via `scanner` (R25-18 double-scan).
 *
 * If no scanner is configured, returns a loud warning once AND runs in fail-
 * closed mode for `read` (throws). `list`/`grep` mark each unscanned hit with
 * `RAGFS_BLOCKED` so the prompt assembler can't accidentally render raw.
 */
export class RagfsRouter {
  private readonly sources = new Map<string, ContextSource>();
  private scanner: RagfsScanner | undefined;
  private warnedNoScanner = false;

  setScanner(s: RagfsScanner | undefined): void { this.scanner = s; }

  register(source: ContextSource): void {
    if (this.sources.has(source.scheme)) throw new Error(`ragfs: scheme ${source.scheme} already registered`);
    this.sources.set(source.scheme, source);
  }

  private requireScanner(label: string): RagfsScanner {
    if (this.scanner) return this.scanner;
    if (!this.warnedNoScanner) {
      // eslint-disable-next-line no-console
      console.warn(`ragfs: ${label} invoked without a scanner wired — fail-closed (R25-18). WIRE a RagfsScanner before production use.`);
      this.warnedNoScanner = true;
    }
    throw new Error(`ragfs.${label}: no scanner configured (R25-18 — fail-closed)`);
  }

  private scanHit(content: string, scanner: RagfsScanner, uriForError: string): string {
    const v = scanner.scan(content, "context");
    return v.allowed ? content : RAGFS_BLOCKED;
  }

  async read(uri: string): Promise<string> {
    const parsed = parseRagfsUri(uri);
    if (!parsed) throw new Error(`ragfs.read: invalid uri ${uri}`);
    const src = this.sources.get(parsed.scheme);
    if (!src) throw new Error(`ragfs.read: no source for scheme ${parsed.scheme}`);
    const scanner = this.requireScanner("read");
    const raw = await src.read(uri);
    return this.scanHit(raw, scanner, uri);
  }

  async list(query: MemoryQuery): Promise<MemoryHit[]> {
    // HIGH F2 (review): role must go to memory; otherwise throw rather than silently
    // route to an unrelated source (data-laundering via silent fallback).
    let src: ContextSource | undefined;
    if (query.role) {
      src = this.sources.get("memory");
      if (!src) throw new Error(`ragfs.list: role=${query.role} requires a memory source`);
    } else {
      src = [...this.sources.values()][0];
    }
    if (!src) return [];
    const hits = await src.list(query);
    return await this.scanHits(hits, "list");
  }

  async grep(pattern: string): Promise<MemoryHit[]> {
    let re: RegExp;
    try { re = new RegExp(pattern, "i"); } catch { return []; } // REVIEW F6: invalid regex → []
    const all: MemoryHit[] = [];
    for (const src of this.sources.values()) {
      for (const h of await src.grep(pattern)) {
        if (re.test(h.content)) all.push(h);
      }
    }
    // RRF-ish re-merge by per-arm rank: each source is its own arm.
    return await this.scanHits(all, "grep");
  }

  /** Scan each hit's content (R25-18). On reject, content becomes RAGFS_BLOCKED. */
  private async scanHits(hits: MemoryHit[], label: string): Promise<MemoryHit[]> {
    const scanner = this.warnedNoScanner && !this.scanner ? null : this.scanner;
    if (!scanner) {
      this.requireScanner(label);
      return hits; // unreachable: requireScanner throws
    }
    const out: MemoryHit[] = [];
    for (const h of hits) {
      const v = scanner.scan(h.content, "context");
      out.push({ ...h, content: v.allowed ? h.content : RAGFS_BLOCKED });
    }
    return out;
  }
}

/** A static (in-memory) ContextSource — for tests + fixed knowledge blobs. */
export class StaticContextSource implements ContextSource {
  constructor(
    readonly scheme: ContextSource["scheme"],
    private readonly docs: Map<string, string>,
  ) {}

  async list(query: MemoryQuery): Promise<MemoryHit[]> {
    const q = (query.text ?? "").trim().toLowerCase();
    const hits: MemoryHit[] = [];
    for (const [id, content] of this.docs) {
      if (q && !content.toLowerCase().includes(q)) continue;
      const idx = q ? content.toLowerCase().indexOf(q) : -1;
      const tagRole = SCHEME_ROLE[this.scheme];
      hits.push({
        id,
        role: tagRole as MemoryRoleId,
        content,
        // REVIEW F3: explicit guard, no indexOf||0 quirk; length-normalized position bias.
        score: q ? 1 / (1 + Math.log2(1 + Math.max(idx, 0))) : 1,
      });
    }
    hits.sort((a, b) => b.score - a.score);
    // REVIEW F8: respect query.topK.
    return hits.slice(0, query.topK ?? hits.length);
  }

  async read(uri: string): Promise<string> {
    // REVIEW F4: malformed URI throws (no silent fallback to raw-URI key).
    const parsed = parseRagfsUri(uri);
    if (!parsed) throw new Error(`ragfs.${this.scheme}: invalid uri ${uri}`);
    const id = parsed.rest;
    const content = this.docs.get(id);
    if (content === undefined) throw new Error(`ragfs.${this.scheme}: not found ${uri}`);
    return content;
  }

  async grep(pattern: string): Promise<MemoryHit[]> {
    // REVIEW F6: invalid regex → [] (don't throw).
    let re: RegExp;
    try { re = new RegExp(pattern, "i"); } catch { return []; }
    const out: MemoryHit[] = [];
    const tagRole = SCHEME_ROLE[this.scheme];
    for (const [id, content] of this.docs) {
      if (re.test(content)) out.push({ id, role: tagRole, content, score: 1 });
    }
    return out;
  }
}

/**
 * A knowledge:// ContextSource backed by a TypedGraph (Phase 9). Exposes the
 * typed knowledge graph (spec §8 R35) over the RAGFS knowledge:// namespace.
 * `read("knowledge://<doc>")` returns a serialized KG entity card; `grep()`
 * returns every entity whose name/aliases match the pattern.
 */
export class KnowledgeSource implements ContextSource {
  readonly scheme = "knowledge" as const;
  /** doc-id → human-readable summary string (the "doc card"). */
  private readonly cards = new Map<string, string>();

  constructor(private readonly graph: import("./graph.js").TypedGraph) {}

  /** Register a human-readable summary for an entity (used by read()). */
  registerCard(entityId: string, summary: string): void {
    this.cards.set(entityId, summary);
  }

  async list(query: MemoryQuery): Promise<MemoryHit[]> {
    const q = (query.text ?? "").trim().toLowerCase();
    const hits: MemoryHit[] = [];
    for (const e of this.graph.allEntities()) {
      if (!q || e.id.toLowerCase().includes(q) || e.aliases.some((a) => a.toLowerCase().includes(q))) {
        hits.push({ id: e.id, role: SCHEME_ROLE.knowledge, content: this.cards.get(e.id) ?? `(entity ${e.id})`, score: q ? 1 : 1 });
      }
    }
    return hits.slice(0, query.topK ?? hits.length);
  }

  async read(uri: string): Promise<string> {
    const parsed = parseRagfsUri(uri);
    if (!parsed) throw new Error(`ragfs.knowledge: invalid uri ${uri}`);
    const e = this.graph.allEntities().find((x) => x.id === parsed.rest);
    if (!e) throw new Error(`ragfs.knowledge: not found ${uri}`);
    return this.cards.get(e.id) ?? JSON.stringify(e);
  }

  async grep(pattern: string): Promise<MemoryHit[]> {
    let re: RegExp;
    try { re = new RegExp(pattern, "i"); } catch { return []; }
    return this.graph.allEntities()
      .filter((e) => re.test(e.id) || e.aliases.some((a) => re.test(a)))
      .map((e) => ({ id: e.id, role: SCHEME_ROLE.knowledge, content: this.cards.get(e.id) ?? `(entity ${e.id})`, score: 1 }));
  }
}
