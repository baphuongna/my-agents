/**
 * SkillStore + curator (§9).
 *
 * The store loads SKILL.md files from a directory tree. The INDEX (name +
 * description only) feeds the prompt's stable tier (progressive disclosure).
 * The full body loads on invoke (loadBody).
 *
 * The CURATOR is an auxiliary-provider-driven background writer (§9) — it can
 * write/update skills without touching the main prompt cache (invariant #8).
 * Tier 2 ships the store + index; the auxiliary-provider-driven auto-curation
 * (propose/grade/calibrate) lands as a package on top.
 *
 * Source: §9 Skills, hermes #8 curator, pi skill discovery.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import {
  parseSkillMarkdown,
  type Skill,
  type SkillProvenance,
} from "./skill.js";

/** A skill index entry — the progressive-disclosure projection. */
export interface SkillIndexEntry {
  name: string;
  description: string;
  triggers: string[];
  provenance: SkillProvenance;
}

export class SkillStore {
  private skills = new Map<string, Skill>();

  /** Number of loaded skills. */
  size(): number {
    return this.skills.size;
  }

  /** Register an already-parsed skill. */
  add(skill: Skill): void {
    if (this.skills.has(skill.name)) {
      throw new Error(`skill already registered: ${skill.name}`);
    }
    this.skills.set(skill.name, skill);
  }

  /** The index projection (name + description only — for the prompt stable tier). */
  index(): SkillIndexEntry[] {
    return [...this.skills.values()].map((s) => ({
      name: s.name,
      description: s.description,
      triggers: s.triggers,
      provenance: s.provenance,
    }));
  }

  /** Render the skills-index block for the prompt (progressive disclosure). */
  renderIndexBlock(): string {
    if (this.skills.size === 0) return "";
    const lines = ["## Skills (invoke by name for full instructions)"];
    for (const s of this.skills.values()) {
      lines.push(`- **${s.name}** — ${s.description}`);
    }
    return lines.join("\n");
  }

  /** Load a skill's full body on invoke (progressive disclosure). */
  loadBody(name: string): string | undefined {
    return this.skills.get(name)?.body;
  }

  /** Suggest skills matching a query (trigger phrase or name substring). */
  suggest(query: string): SkillIndexEntry[] {
    const q = query.toLowerCase();
    return this.index().filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.triggers.some((t) => t.toLowerCase().includes(q)) ||
        s.description.toLowerCase().includes(q),
    );
  }

  /**
   * Discover + load all SKILL.md files under `dir` (recursive). A SKILL.md is
   * any file named exactly `SKILL.md`. Returns the count loaded.
   */
  async discover(dir: string): Promise<number> {
    let count = 0;
    const walk = async (d: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        if (ent.name.startsWith(".git") || ent.name === "node_modules") continue;
        const full = join(d, ent.name);
        if (ent.isFile() && ent.name === "SKILL.md") {
          try {
            const content = await readFile(full, "utf8");
            const skill = parseSkillMarkdown(content, full);
            if (!this.skills.has(skill.name)) {
              this.skills.set(skill.name, skill);
              count++;
            }
          } catch {
            // skip malformed skill
          }
        } else if (ent.isDirectory()) {
          await walk(full);
        }
      }
    };
    await walk(dir);
    return count;
  }
}
