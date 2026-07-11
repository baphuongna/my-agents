import { nowWallclock } from "@my-agent/core";
/**
 * Skill model + provenance (§9).
 *
 * A Skill is a SKILL.md file: YAML frontmatter (name, description, triggers,
 * optional model/tools) + a markdown body (the actual instructions). Skills
 * load via PROGRESSIVE DISCLOSURE: only name + description go into the prompt's
 * stable tier; the full body loads when the agent invokes the skill.
 *
 * Provenance tracks where a skill came from (source path / agentskills.io
 * frontmatter) so the curator can audit + update it.
 *
 * Source: §9 Skills, hermes #8, pi/oh-my-pi skill model.
 */

/** §9 R26-C: SkillProvenance enum gating edits. Controls which skills the
 * curator may touch (Bundled+AgentCreated only by default; HubInstalled is
 * off-limits unless prune_builtins-style override; UserCreated is pinned-safe). */
export type SkillProvenanceKind =
  | "Bundled"
  | "HubInstalled"
  | "UserCreated"
  | "AgentCreated";

/** Provenance metadata: the kind enum (gate) + origin details (audit). */
export interface SkillProvenance {
  /** The 4-value enum that gates curator edits (§9). */
  kind: SkillProvenanceKind;
  /** Filesystem path the SKILL.md was loaded from (audit). */
  sourcePath: string;
  /** Frontmatter `agentskills.io` id, if declared (for registry sync). */
  registryId?: string;
  /** Loaded at (epoch ms). */
  loadedAt: number;
}

/** A loaded skill (parsed SKILL.md). */
export interface Skill {
  name: string;
  description: string;
  /** Trigger phrases (when to suggest invoking the skill). */
  triggers: string[];
  /** Full instruction body (loaded ONLY on invoke — progressive disclosure). */
  body: string;
  /** Optional: preferred model for this skill. */
  model?: string;
  /** Optional: tools this skill is allowed to use. */
  allowedTools?: string[];
  provenance: SkillProvenance;
}

/** Frontmatter shape (the YAML block at the top of SKILL.md). */
export interface SkillFrontmatter {
  name: string;
  description: string;
  triggers?: string[];
  model?: string;
  allowedTools?: string[];
  /** agentskills.io registry id. */
  "agentskills.io"?: string;
}

/**
 * Parse a SKILL.md file into a Skill. Frontmatter is the YAML block between
 * opening/closing `---` lines; the rest is the body.
 */
export function parseSkillMarkdown(
  content: string,
  sourcePath: string,
  /** Default provenance kind when not specified (caller overrides for hub/user/agent). */
  provenanceKind: SkillProvenanceKind = "Bundled",
): Skill {
  const { frontmatter, body } = splitFrontmatter(content);
  if (!frontmatter.name || !frontmatter.description) {
    throw new Error(
      `skill ${sourcePath}: frontmatter requires name + description`,
    );
  }
  return {
    name: frontmatter.name,
    description: frontmatter.description,
    triggers: frontmatter.triggers ?? [],
    body: body.trim(),
    model: frontmatter.model,
    allowedTools: frontmatter["allowedTools"],
    provenance: {
      kind: provenanceKind,
      sourcePath,
      registryId: frontmatter["agentskills.io"],
      loadedAt: nowWallclock(),
    },
  };
}

/** Split a SKILL.md into frontmatter + body. Minimal YAML parsing (key: value). */
function splitFrontmatter(content: string): {
  frontmatter: SkillFrontmatter;
  body: string;
} {
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!fmMatch) {
    return {
      frontmatter: { name: "", description: "" },
      body: content,
    };
  }
  const yaml = fmMatch[1] ?? "";
  const body = fmMatch[2] ?? "";
  return { frontmatter: parseSimpleYaml(yaml), body };
}

/** Minimal YAML parser (key: value + lists). Not a full YAML impl — SKILL.md only. */
function parseSimpleYaml(yaml: string): SkillFrontmatter {
  const fm: SkillFrontmatter & { [k: string]: unknown } = {
    name: "",
    description: "",
  };
  let currentListKey: string | null = null;
  for (const line of yaml.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    // list item under a `key:` block
    const listMatch = /^\s+-\s+(.+)$/.exec(line);
    if (listMatch && currentListKey) {
      const arr = (fm[currentListKey] as string[] | undefined) ?? [];
      arr.push((listMatch[1] ?? "").trim());
      fm[currentListKey] = arr;
      continue;
    }
    const kv = /^([a-zA-Z0-9_.-]+):\s*(.*)$/.exec(line);
    if (kv) {
      const key = kv[1] ?? "";
      const val = (kv[2] ?? "").trim();
      if (val === "") {
        // could be a list block start
        currentListKey = key;
        fm[key] = [];
      } else {
        currentListKey = null;
        // inline list: [a, b, c]
        const inlineList = /^\[(.*)\]$/.exec(val);
        if (inlineList) {
          fm[key] = (inlineList[1] ?? "")
            .split(",")
            .map((s) => s.trim().replace(/^["']|["']$/g, ""))
            .filter((s) => s.length > 0);
        } else {
          // strip quotes
          fm[key] = val.replace(/^["']|["']$/g, "");
        }
      }
    }
  }
  return fm as SkillFrontmatter;
}
