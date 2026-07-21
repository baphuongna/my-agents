/**
 * @my-agent/memory — Learning graph (concept→concept derivation).
 * D2: derives a learning graph from memory entities + conversations.
 * Source: §08 Memory, PLAN-FEATURES D2.
 */
import type { Brain } from "./brain.js";
import type { Fact } from "./brain.js";

export interface LearningNode { id: string; label: string; type: string; weight: number; }
export interface LearningEdge { from: string; to: string; kind: "learned-from" | "related-to" | "built-on"; }
export interface LearningGraph { nodes: LearningNode[]; edges: LearningEdge[]; }

/** Derive a learning graph from Brain facts. */
export function deriveLearningGraph(brain: Brain, topic?: string): LearningGraph {
  const nodes: LearningNode[] = [];
  const edges: LearningEdge[] = [];
  const nodeMap = new Map<string, LearningNode>();

  // Get all facts from the brain
  const facts = brain.extractFacts("");
  const entityFacts: Fact[] = [];
  // Access internal facts via backlinks/extractFacts
  for (const f of facts) {
    if (topic && !f.entity.toLowerCase().includes(topic.toLowerCase())) continue;
    entityFacts.push(f);
  }

  // Create nodes from entities
  for (const f of entityFacts) {
    if (!nodeMap.has(f.entity)) {
      const node: LearningNode = {
        id: f.entity.toLowerCase().replace(/\s+/g, "-"),
        label: f.entity,
        type: f.kind,
        weight: 1,
      };
      nodeMap.set(f.entity, node);
      nodes.push(node);
    } else {
      nodeMap.get(f.entity)!.weight++;
    }
  }

  // Create edges from backlinks
  const backlinks = brain.backlinks();
  for (const link of backlinks) {
    if (link.kind === "bare") continue;
    const fromId = link.from.toLowerCase().replace(/\s+/g, "-");
    const toId = link.to.toLowerCase().replace(/\s+/g, "-");
    if (nodeMap.has(link.from) || nodeMap.has(link.to)) {
      edges.push({ from: fromId, to: toId, kind: "related-to" });
    }
  }

  // Create learned-from edges based on source grouping
  const bySource = new Map<string, Fact[]>();
  for (const f of entityFacts) {
    const group = bySource.get(f.source) ?? [];
    group.push(f);
    bySource.set(f.source, group);
  }
  for (const [, group] of bySource) {
    for (let i = 1; i < group.length; i++) {
      edges.push({
        from: group[0]!.entity.toLowerCase().replace(/\s+/g, "-"),
        to: group[i]!.entity.toLowerCase().replace(/\s+/g, "-"),
        kind: "learned-from",
      });
    }
  }

  return { nodes, edges };
}

/** Export learning graph as DOT format for visualization. */
export function graphToDot(graph: LearningGraph): string {
  const lines = ["digraph learning {"];
  for (const node of graph.nodes) {
    lines.push(`  "${node.id}" [label="${node.label}", weight=${node.weight}];`);
  }
  for (const edge of graph.edges) {
    lines.push(`  "${edge.from}" -> "${edge.to}" [label="${edge.kind}"];`);
  }
  lines.push("}");
  return lines.join("\n");
}
