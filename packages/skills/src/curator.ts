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
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, basename, dirname } from "node:path";
import {
  parseSkillMarkdown,
  type Skill,
  type SkillProvenance,
  type SkillProvenanceKind,
} from "./skill.js";
import { nowWallclock } from "@my-agent/core";

/** A skill index entry — the progressive-disclosure projection. */
export interface SkillIndexEntry {
  name: string;
  description: string;
  triggers: string[];
  provenance: SkillProvenance;
}

export class SkillStore {
  private skills = new Map<string, Skill>();
  private pinned = new Set<string>();

  /** Number of loaded skills. */
  size(): number {
    return this.skills.size;
  }

  /** Get a skill by name (for curator + body load). */
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /** Pin a skill (curator bypass). */
  pin(name: string): void {
    this.pinned.add(name);
  }

  /** Unpin a skill. */
  unpin(name: string): void {
    this.pinned.delete(name);
  }

  /** Check if a skill is pinned. */
  isPinned(name: string): boolean {
    return this.pinned.has(name);
  }

  /** Remove a skill from the store (curator archive calls this after moving the file). */
  remove(name: string): boolean {
    return this.skills.delete(name);
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
            // Infer provenance kind from path: .mya/skills/* = UserCreated, else Bundled.
            const kind: SkillProvenanceKind = full.includes(`${join(".mya", "skills")}`) ? "UserCreated" : "Bundled";
            const skill = parseSkillMarkdown(content, full, kind);
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

/** A single curation action recorded by the curator (audit trail). */
export interface CurationAction {
  skill: string;
  action: "archived" | "pruned" | "kept" | "pinned-bypass";
  reason: string;
}

/** Curator options (§9). */
export interface SkillCuratorOptions {
  /** When true (default), allows pruning Bundled built-in skills. */
  pruneBuiltins?: boolean;
  /** Days of inactivity before a skill is eligible for archive/prune. */
  inactiveAfterDays?: number;
  /** Directory to move archived skills to (archive-not-delete invariant). */
  archiveDir?: string;
  /** Current wall-clock (injectable for tests). */
  now?: number;
}

/** §9 SkillCurator — inactivity-triggered, archive-not-delete background curation.
 *
 * Invariants (SPEC §9 R26-C):
 *   - touches AgentCreated AND Bundled (when pruneBuiltins is on, the default);
 *     HubInstalled/external are off-limits.
 *   - archive-not-delete: moves the SKILL.md to archiveDir, never unlinks.
 *   - Pinned skills bypass ALL auto-transitions.
 *   - UserCreated skills are NEVER auto-pruned (user must explicitly remove).
 */
export async function curate(
  store: SkillStore,
  opts: SkillCuratorOptions = {},
): Promise<CurationAction[]> {
  const pruneBuiltins = opts.pruneBuiltins ?? true;
  const inactiveAfterDays = opts.inactiveAfterDays ?? 30;
  const now = opts.now ?? nowWallclock();
  const cutoff = now - inactiveAfterDays * 24 * 60 * 60 * 1000;
  const archiveDir = opts.archiveDir;
  const actions: CurationAction[] = [];

  for (const entry of store.index()) {
    const name = entry.name;
    // Pinned bypass.
    if (store.isPinned(name)) {
      actions.push({ skill: name, action: "pinned-bypass", reason: "pinned" });
      continue;
    }
    const kind = entry.provenance.kind;
    // Eligible kinds: AgentCreated always; Bundled only if pruneBuiltins.
    const eligible = kind === "AgentCreated" || (kind === "Bundled" && pruneBuiltins);
    if (!eligible) {
      actions.push({ skill: name, action: "kept", reason: `${kind} off-limits` });
      continue;
    }
    // Inactivity check (based on loadedAt as proxy for last-use — no usage tracking in Tier-1).
    if (entry.provenance.loadedAt > cutoff) {
      actions.push({ skill: name, action: "kept", reason: "active" });
      continue;
    }
    // Archive-not-delete.
    if (archiveDir) {
      const skill = store.get(name);
      if (skill) {
        try {
          await mkdir(archiveDir, { recursive: true });
          const dest = join(archiveDir, `${name}.md`);
          await writeFile(dest, `---\nname: ${skill.name}\ndescription: ${skill.description}\narchivedAt: ${now}\n---\n\n${skill.body}`, "utf8");
          store.remove(name);
          actions.push({ skill: name, action: "archived", reason: `inactive ${inactiveAfterDays}d → ${dest}` });
          continue;
        } catch {
          // archive failed — keep in store (fail-safe)
          actions.push({ skill: name, action: "kept", reason: "archive-failed" });
          continue;
        }
      }
    }
    // No archiveDir — prune from store only (but never delete the file on disk without archive).
    store.remove(name);
    actions.push({ skill: name, action: "pruned", reason: `inactive ${inactiveAfterDays}d` });
  }
  return actions;
}
