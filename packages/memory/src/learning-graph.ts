/**
 * @my-agent/memory — Learning graph (concept→concept derivation).
 * D2: derives a learning graph from memory entities + conversations.
 * Source: §08 Memory, PLAN-FEATURES D2.
 */
import type { Brain } from "./brain.js";

export interface LearningNode { id: string; label: string; type: string; weight: number; }
export interface LearningEdge { from: string; to: string; kind: "learned-from" | "related-to" | "built-on"; }
export interface LearningGraph { nodes: LearningNode[]; edges: LearningEdge[]; }

/** Derive a learning graph from Brain facts. */
export function deriveLearningGraph(brain: Brain, topic?: string): LearningGraph {
  const nodes: LearningNode[] = [];
  const edges: LearningEdge[] = [];
  const nodeMap = new Map<string, LearningNode>();

  // Get all facts from the brain (returns { factId, kind, value })
  const facts = brain.extractFacts();

  // Create nodes from fact values
  for (const f of facts) {
    if (topic && !f.value.toLowerCase().includes(topic.toLowerCase())) continue;
    const label = f.value.split(" ").slice(0, 3).join(" ");
    const id = label.toLowerCase().replace(/\s+/g, "-");
    if (!nodeMap.has(id)) {
      const node: LearningNode = { id, label, type: f.kind, weight: 1 };
      nodeMap.set(id, node);
      nodes.push(node);
    } else {
      nodeMap.get(id)!.weight++;
    }
  }

  // Create edges from backlinks
  const backlinks = brain.backlinks();
  for (const link of backlinks) {
    if (link.kind === "bare") continue;
    const fromId = link.from.toLowerCase().replace(/\s+/g, "-");
    const toId = link.to.toLowerCase().replace(/\s+/g, "-");
    if (nodeMap.has(fromId) || nodeMap.has(toId)) {
      edges.push({ from: fromId, to: toId, kind: "related-to" });
    }
  }

  // Create learned-from edges based on kind grouping
  const byKind = new Map<string, string[]>();
  for (const f of facts) {
    const group = byKind.get(f.kind) ?? [];
    const id = f.value.split(" ").slice(0, 3).join(" ").toLowerCase().replace(/\s+/g, "-");
    if (nodeMap.has(id)) group.push(id);
    byKind.set(f.kind, group);
  }
  for (const [, group] of byKind) {
    for (let i = 1; i < group.length; i++) {
      edges.push({ from: group[0]!, to: group[i]!, kind: "learned-from" });
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
