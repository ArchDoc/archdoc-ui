import type { Model, ModelDiff, RelationshipView, Target } from "@archdoc/core/browser";
import { nodeKey } from "@archdoc/core/browser";
import {
  ancestorsOf,
  buildGraph,
  type Graph,
  type GraphNode,
  liftKey,
  type ViewState,
} from "./graph.js";

export type ChangeKind = "added" | "changed" | "removed";

export interface DiffGraph {
  /** The head graph, plus ghost nodes and edges for what was removed. */
  graph: Graph;
  nodes: Map<string, ChangeKind>;
  edges: Map<string, ChangeKind>;
  /** Collapsed boxes that hide changes inside them. */
  containsChanges: Set<string>;
  /** Node keys that exist only in the base. */
  ghosts: Set<string>;
}

/**
 * Overlays a model diff on the graph: what was added, changed, or removed,
 * by node and by edge. Removed elements and relationships appear as ghosts
 * where their place is still visible; changes hidden inside a collapsed box
 * mark the box instead.
 */
export function buildDiffGraph(
  head: Model,
  base: Model,
  diff: ModelDiff,
  view: ViewState,
): DiffGraph {
  const graph = buildGraph(head, view);
  const visible = new Set(graph.nodes.map((n) => n.id));
  const nodes = new Map<string, ChangeKind>();
  const containsChanges = new Set<string>();
  const ghosts = new Set<string>();

  const mark = (key: string, kind: ChangeKind) => {
    if (visible.has(key)) nodes.set(key, kind);
  };
  const markHidden = (id: string, model: Model) => {
    // A change inside a collapsed box: mark the nearest visible ancestor.
    for (const a of [...ancestorsOf(model, id)].reverse()) {
      const key = `element:${a}`;
      if (visible.has(key)) {
        containsChanges.add(key);
        return;
      }
    }
  };

  for (const c of diff.elements) {
    const key = `element:${c.id}`;
    if (c.kind === "removed") continue;
    if (visible.has(key)) mark(key, c.kind === "added" ? "added" : "changed");
    else markHidden(c.id, head);
  }
  for (const c of diff.actors)
    if (c.kind !== "removed") mark(`actor:${c.id}`, c.kind === "added" ? "added" : "changed");

  // Removed elements: a ghost for the top-most removed one whose parent is open (or top level).
  const removed = new Set(diff.elements.filter((c) => c.kind === "removed").map((c) => c.id));
  for (const id of removed) {
    const parent = base.elements.get(id)?.parentId;
    if (parent && removed.has(parent)) continue;
    if (
      parent &&
      (!head.elements.has(parent) ||
        !view.expanded.has(parent) ||
        !visible.has(`element:${parent}`))
    ) {
      if (head.elements.has(parent)) markHidden(id, base);
      continue;
    }
    const ghost: GraphNode = {
      id: `element:${id}`,
      kind: "element",
      parentId: parent ? `element:${parent}` : undefined,
      isGroup: false,
      hiddenChildren: 0,
      depth: base.elements.get(id)?.depth ?? 0,
    };
    graph.nodes.push(ghost);
    visible.add(ghost.id);
    ghosts.add(ghost.id);
    nodes.set(ghost.id, "removed");
  }
  for (const c of diff.actors) {
    if (c.kind !== "removed") continue;
    const key = `actor:${c.id}`;
    graph.nodes.push({ id: key, kind: "actor", isGroup: false, hiddenChildren: 0, depth: 0 });
    visible.add(key);
    ghosts.add(key);
    nodes.set(key, "removed");
  }

  // Edges: added and changed ones exist in the head graph; removed ones become ghosts.
  const edges = new Map<string, ChangeKind>();
  const added = new Map<string, { added: number; other: number }>();
  const endpoint = (t: Target): string | undefined => {
    if (t.type === "element" && !head.elements.has(t.id)) {
      // Removed element: its ghost, or the nearest visible box that holds it.
      if (visible.has(`element:${t.id}`)) return `element:${t.id}`;
      for (const a of [...ancestorsOf(base, t.id)].reverse()) {
        if (visible.has(`element:${a}`)) return `element:${a}`;
      }
      return undefined;
    }
    if (t.type === "actor" && !head.actors.has(t.id))
      return visible.has(nodeKey(t)) ? nodeKey(t) : undefined;
    return liftKey(head, view, t);
  };
  for (const c of diff.relationships) {
    const r = (c.after ?? c.before) as RelationshipView;
    const source = endpoint(r.from);
    const target = endpoint(r.to);
    if (!source || !target || source === target) continue;
    const id = `${source}->${target}`;
    const kind: ChangeKind =
      c.kind === "added" ? "added" : c.kind === "removed" ? "removed" : "changed";
    const existing = graph.edges.find((e) => e.id === id);
    if (existing) {
      const counts = added.get(id) ?? { added: 0, other: 0 };
      if (kind === "added") counts.added++;
      else counts.other++;
      added.set(id, counts);
    } else if (kind === "removed") {
      graph.edges.push({ id, source, target, relationships: [], planned: false });
      edges.set(id, "removed");
    }
  }
  // An edge stands for every relationship lifted onto it: "added" only if all of them are new.
  for (const [id, counts] of added) {
    const total = graph.edges.find((e) => e.id === id)?.relationships.length ?? 0;
    edges.set(id, counts.other === 0 && counts.added === total ? "added" : "changed");
  }

  return { graph, nodes, edges, containsChanges, ghosts };
}
