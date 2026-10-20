import type { Model, ModelDiff, RelationshipView, Target } from "@archdoc/core/browser";
import { nodeKey, subscriptionOf } from "@archdoc/core/browser";
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
  /** Boxes with changes inside them, and how many: they count as changed too. */
  inside: Map<string, number>;
  /** Node keys that exist only in the base. */
  ghosts: Set<string>;
}

/**
 * Overlays a model diff on the graph: what was added, changed, or removed,
 * by node and by edge. Removed elements and relationships appear as ghosts
 * where their place is still visible. A box with changes inside it changed
 * too, whether it's open or not.
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
  const inside = new Map<string, number>();
  const ghosts = new Set<string>();

  const mark = (key: string, kind: ChangeKind) => {
    if (visible.has(key)) nodes.set(key, kind);
  };
  // Every box that holds a change, open or collapsed, changed with it.
  const markAncestors = (id: string, model: Model) => {
    for (const a of ancestorsOf(model, id)) {
      const key = `element:${a}`;
      if (!head.elements.has(a) || !visible.has(key)) continue;
      inside.set(key, (inside.get(key) ?? 0) + 1);
      if (!nodes.has(key)) nodes.set(key, "changed");
    }
  };
  for (const c of diff.elements) {
    if (c.kind === "removed") continue;
    mark(`element:${c.id}`, c.kind === "added" ? "added" : "changed");
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

  // What changed inside a box changes the box: its elements, and the arrows they start.
  for (const c of diff.elements) markAncestors(c.id, c.kind === "removed" ? base : head);
  for (const c of diff.relationships) {
    const r = (c.after ?? c.before) as RelationshipView;
    if (r.from.type === "element") markAncestors(r.from.id, c.kind === "removed" ? base : head);
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
  const same = (a: RelationshipView, b: { from: Target; to: Target }) =>
    nodeKey(a.from) === nodeKey(b.from) && nodeKey(a.to) === nodeKey(b.to);
  for (const c of diff.relationships) {
    const r = (c.after ?? c.before) as RelationshipView;
    const kind: ChangeKind =
      c.kind === "added" ? "added" : c.kind === "removed" ? "removed" : "changed";
    // The edge that stands for it: a subscription's runs publisher to subscriber, against how it's declared.
    const was = base.relationships.find((x) => same(r, x));
    const [from, to] = was && subscriptionOf(base, was) ? [r.to, r.from] : [r.from, r.to];
    const source = endpoint(from);
    const target = endpoint(to);
    // A removed one may still be lifted onto an edge others keep.
    const existing =
      graph.edges.find((e) => e.relationships.some((x) => same(r, x))) ??
      graph.edges.find((e) => e.id === `${source}->${target}`);
    if (!existing && (!source || !target || source === target)) continue;
    const id = existing?.id ?? `${source}->${target}`;
    if (existing) {
      const counts = added.get(id) ?? { added: 0, other: 0 };
      if (kind === "added") counts.added++;
      else counts.other++;
      added.set(id, counts);
    } else if (kind === "removed" && source && target) {
      graph.edges.push({ id, source, target, relationships: [], planned: false });
      edges.set(id, "removed");
    }
  }
  // An edge stands for every relationship lifted onto it: "added" only if all of them are new.
  for (const [id, counts] of added) {
    const total = graph.edges.find((e) => e.id === id)?.relationships.length ?? 0;
    edges.set(id, counts.other === 0 && counts.added === total ? "added" : "changed");
  }

  return { graph, nodes, edges, inside, ghosts };
}
