/**
 * @my-agent/memory — Markdown memory backend (human-editable).
 * D1: FileBackend variant with frontmatter-aware markdown structure.
 * Source: §08 Memory, PLAN-FEATURES D1.
 */
import type { MemoryBackend, MemoryEntry, MemoryHit, MemoryQuery } from "./backends.js";
import type { WriteResult, MemoryRoleId, Durability } from "@my-agent/core";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { nowWallclock } from "@my-agent/core";

/** Markdown backend with frontmatter — each entry is a markdown section. */
export class MarkdownBackend implements MemoryBackend {
  readonly role: MemoryRoleId;
  readonly durability: Durability = "Durable";
  readonly external = false;
  private readonly path: string;

  constructor(role: MemoryRoleId, dir: string) {
    this.role = role;
    this.path = join(dir, `${role}.md`);
  }

  async write(entry: MemoryEntry): Promise<WriteResult> {
    try {
      if (!existsSync(this.path)) {
        mkdirSync(dirname(this.path), { recursive: true });
        writeFileSync(this.path, `# ${this.role} Memory\n\n`, { mode: 0o600 });
      }
      const section = this.entryToMarkdown(entry);
      const existing = readFileSync(this.path, "utf8");
      writeFileSync(this.path, existing + section, { mode: 0o600 });
      return { Durable: true };
    } catch {
      return { Spilled: { pendingCount: 1 } };
    }
  }

  async read(query: MemoryQuery): Promise<MemoryHit[]> {
    if (!existsSync(this.path)) return [];
    const content = readFileSync(this.path, "utf8");
    return this.parseMarkdown(content, query.text ?? "");
  }

  private entryToMarkdown(entry: MemoryEntry): string {
    const ts = nowWallclock();
    const tags = (entry as { tags?: string[] }).tags?.join(", ") ?? "";
    return `## ${entry.content.slice(0, 80)}\n\n${entry.content}\n\n*tags: ${tags} · ts: ${ts}*\n\n---\n\n`;
  }

  private parseMarkdown(content: string, query: string): MemoryHit[] {
    const sections = content.split(/^---$/m).filter((s) => s.trim());
    const q = query.toLowerCase();
    return sections
      .filter((s) => !q || s.toLowerCase().includes(q))
      .map((s, i) => ({
        id: `md-${this.role}-${i}`,
        content: s.trim(),
        score: q ? (s.toLowerCase().match(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))?.length ?? 0) : 1,
      }))
      .filter((h) => h.score > 0 || !q)
      .sort((a, b) => b.score - a.score);
  }
}
