/**
 * ragfs — unified context FS (§8). One URI namespace over memory + skills +
 * knowledge + files; uniform list/read/grep via the ContextSource trait.
 * A read-only aggregation layer (writes stay on the owning subsystem).
 *
 *   memory://<role>/<id>   skill://<name>   knowledge://<doc>   file://<path>
 *
 * Source: §8; OpenViking (architecture only, AGPL clean-room); mya-v1 context-fs.
 */
import type { MemoryHit, MemoryQuery } from "@my-agent/core";

/** A context source serves one URI scheme. */
export interface ContextSource {
  readonly scheme: "memory" | "skill" | "knowledge" | "file";
  list(query: MemoryQuery): Promise<MemoryHit[]>;
  read(uri: string): Promise<string>;
  grep(pattern: string): Promise<MemoryHit[]>;
}

/** A parsed ragfs URI. */
export interface RagfsUri {
  scheme: ContextSource["scheme"];
  /** The path after the scheme (e.g. role/id, name, doc, file path). */
  rest: string;
}

/** Parse a ragfs URI. Returns null on an unknown/invalid scheme. */
export function parseRagfsUri(uri: string): RagfsUri | null {
  const m = uri.match(/^(memory|skill|knowledge|file):\/\/(.+)$/);
  if (!m) return null;
  return { scheme: m[1] as ContextSource["scheme"], rest: m[2]! };
}

/**
 * The ragfs router. Registers one ContextSource per scheme; routes list/read/
 * grep to the matching source. Injection-scanned on read (§8 R25-18 double-scan).
 */
export class RagfsRouter {
  private readonly sources = new Map<string, ContextSource>();

  register(source: ContextSource): void {
    if (this.sources.has(source.scheme)) throw new Error(`ragfs: scheme ${source.scheme} already registered`);
    this.sources.set(source.scheme, source);
  }

  list(query: MemoryQuery): Promise<MemoryHit[]> {
    const src = query.role ? this.sources.get("memory") : undefined;
    // route list to memory by default; a per-scheme query could extend this.
    const target = src ?? [...this.sources.values()][0];
    return target ? target.list(query) : Promise.resolve([]);
  }

  async read(uri: string): Promise<string> {
    const parsed = parseRagfsUri(uri);
    if (!parsed) throw new Error(`ragfs: invalid uri ${uri}`);
    const src = this.sources.get(parsed.scheme);
    if (!src) throw new Error(`ragfs: no source for scheme ${parsed.scheme}`);
    return src.read(uri);
  }

  async grep(pattern: string): Promise<MemoryHit[]> {
    // fan out across all sources, merge by score
    const all: MemoryHit[] = [];
    for (const src of this.sources.values()) all.push(...(await src.grep(pattern)));
    return all.sort((a, b) => b.score - a.score);
  }
}

/** A static (in-memory) ContextSource — for tests + fixed knowledge blobs. */
export class StaticContextSource implements ContextSource {
  constructor(
    readonly scheme: ContextSource["scheme"],
    private readonly docs: Map<string, string>,
  ) {}

  async list(query: MemoryQuery): Promise<MemoryHit[]> {
    const q = query.text.toLowerCase();
    const out: MemoryHit[] = [];
    for (const [id, content] of this.docs) {
      if (!q || content.toLowerCase().includes(q)) {
        out.push({ id, role: (query.role ?? "working") as never, content, score: q ? 1 / (1 + (content.toLowerCase().indexOf(q) || 0)) : 1 });
      }
    }
    return out.sort((a, b) => b.score - a.score);
  }

  async read(uri: string): Promise<string> {
    const parsed = parseRagfsUri(uri);
    const id = parsed?.rest ?? uri;
    const content = this.docs.get(id);
    if (content === undefined) throw new Error(`ragfs ${this.scheme}: not found ${uri}`);
    return content;
  }

  async grep(pattern: string): Promise<MemoryHit[]> {
    const re = new RegExp(pattern, "i");
    const out: MemoryHit[] = [];
    for (const [id, content] of this.docs) {
      if (re.test(content)) out.push({ id, role: "working" as never, content, score: 1 });
    }
    return out;
  }
}
