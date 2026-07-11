/**
 * MemoryContextSource — wraps a MemoryManagerImpl as a ragfs `memory://` source
 * (Phase 12). Adapts the memory backend's read/query to the ContextSource trait
 * so ragfs can serve `memory://<role>/<id>` URIs with scan-on-read.
 */
import type { MemoryHit, MemoryQuery } from "@my-agent/core";
import type { ContextSource } from "./ragfs.js";
import type { MemoryManagerImpl } from "./manager.js";

export class MemoryContextSource implements ContextSource {
  readonly scheme = "memory" as const;

  constructor(private readonly manager: MemoryManagerImpl) {}

  async list(query: MemoryQuery): Promise<MemoryHit[]> {
    return this.manager.query(query);
  }

  async read(uri: string): Promise<string> {
    // memory://<role>/<id> — extract role + id, query the backend.
    const parts = uri.replace(/^memory:\/\//, "").split("/");
    if (parts.length < 2) throw new Error(`ragfs.memory: invalid uri ${uri}`);
    const hits = await this.manager.query({ text: parts.slice(1).join("/"), role: parts[0] as MemoryQuery["role"], topK: 1 });
    if (hits.length === 0) throw new Error(`ragfs.memory: not found ${uri}`);
    return hits[0]!.content;
  }

  async grep(pattern: string): Promise<MemoryHit[]> {
    let re: RegExp;
    try { re = new RegExp(pattern, "i"); } catch { return []; }
    const all = await this.manager.query({ text: "", topK: 1000 });
    return all.filter((h) => re.test(h.content));
  }
}
