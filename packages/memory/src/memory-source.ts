/**
 * MemoryContextSource — wraps a MemoryManagerImpl as a ragfs `memory://` source
 * (Phase 12). Adapts the memory backend's read/query to the ContextSource trait
 * so ragfs can serve `memory://<role>/<id>` URIs with scan-on-read.
 *
 * Review-driven hardening:
 *   - CRITICAL F1: read() does an EXACT-ID lookup (broad fetch + filter by
 *     MemoryHit.id), not a content-substring search (which could misroute).
 *   - HIGH F3: uses parseRagfsUri (decode + slash-trim), not a divergent regex.
 *   - MEDIUM F4-F6: validates role against MemoryRoleId; rejects empty id.
 */
import type { MemoryHit, MemoryQuery, MemoryRoleId } from "@my-agent/core";
import type { ContextSource } from "./ragfs.js";
import { parseRagfsUri } from "./ragfs.js";
import type { MemoryManagerImpl } from "./manager.js";

const VALID_ROLES = new Set<string>(["archivist", "tree", "diff", "goals", "sync", "working"]);

export class MemoryContextSource implements ContextSource {
  readonly scheme = "memory" as const;

  constructor(private readonly manager: MemoryManagerImpl) {}

  async list(query: MemoryQuery): Promise<MemoryHit[]> {
    return this.manager.query(query);
  }

  async read(uri: string): Promise<string> {
    // HIGH F3: use parseRagfsUri (consistent decode + slash-trim with the router).
    const parsed = parseRagfsUri(uri);
    if (!parsed) throw new Error(`ragfs.memory: invalid uri ${uri}`);
    const parts = parsed.rest.split("/");
    if (parts.length < 2) throw new Error(`ragfs.memory: uri must be memory://<role>/<id>, got ${uri}`);
    const role = parts[0]!;
    const id = parts.slice(1).join("/");
    // MEDIUM F4/F6: validate the role.
    if (!VALID_ROLES.has(role)) throw new Error(`ragfs.memory: invalid role '${role}'`);
    // MEDIUM F5: reject empty id.
    if (!id) throw new Error(`ragfs.memory: empty id in ${uri}`);
    // CRITICAL F1: EXACT-ID lookup — broad fetch then filter by MemoryHit.id
    // (not a content-substring search which could return the wrong entry).
    const hits = await this.manager.query({ text: "", role: role as MemoryQuery["role"], topK: 1000 });
    const hit = hits.find((h) => h.id === id);
    if (!hit) throw new Error(`ragfs.memory: not found ${uri}`);
    return hit.content;
  }

  async grep(pattern: string): Promise<MemoryHit[]> {
    let re: RegExp;
    try { re = new RegExp(pattern, "i"); } catch { return []; }
    // broad fetch (topK=1000 is a Tier-1 cap; document the limitation)
    const all = await this.manager.query({ text: "", topK: 1000 });
    return all.filter((h) => re.test(h.content));
  }
}
