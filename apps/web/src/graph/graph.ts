import type { JourneyNode, Model, Relationship, Target } from "@archdoc/core/browser";
import { nodeKey } from "@archdoc/core/browser";

/** What the canvas shows: which elements are open, and an optional focus. */
export interface ViewState {
  /** Element IDs whose children are shown. */
  expanded: ReadonlySet<string>;
  /** Node key (`actor:x`, `element:y`) whose neighborhood is the only thing shown. */
  focus?: string | undefined;
}

export type GraphNodeKind = "actor" | "element" | "external";

export interface GraphNode {
  /** Node key: `actor:<id>`, `element:<id>`, or `external:<ref>`. */
  id: string;
  kind: GraphNodeKind;
  /** Node key of the enclosing group, if any. */
  parentId?: string | undefined;
  /** True for an expanded element with visible children. */
  isGroup: boolean;
  /** Number of hidden children (collapsed element). */
  hiddenChildren: number;
  depth: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  /** Declared relationships this edge stands for (several when lifted to a collapsed parent). */
  relationships: Relationship[];
  /** All of them are planned. */
  planned: boolean;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface JourneyEdge {
  id: string;
  /** 0-based step index. */
  step: number;
  source: string;
  target: string;
}

/** Key of the visible node that stands for `target`: itself, or its nearest visible ancestor. */
export function liftKey(model: Model, state: ViewState, target: Target): string {
  if (target.type !== "element") return nodeKey(target);
  const chain = ancestorsOf(model, target.id);
  // The first collapsed ancestor (from the top) hides everything below it.
  for (const id of chain) {
    if (!state.expanded.has(id)) return `element:${id}`;
  }
  return `element:${target.id}`;
}

/** IDs from the top-level element down to the parent of `id`. */
export function ancestorsOf(model: Model, id: string): string[] {
  const out: string[] = [];
  for (let p = model.elements.get(id)?.parentId; p; p = model.elements.get(p)?.parentId) {
    out.unshift(p);
  }
  return out;
}

export function buildGraph(model: Model, state: ViewState): Graph {
  const nodes = new Map<string, GraphNode>();

  for (const actor of model.actors.values()) {
    nodes.set(`actor:${actor.id}`, {
      id: `actor:${actor.id}`,
      kind: "actor",
      isGroup: false,
      hiddenChildren: 0,
      depth: 0,
    });
  }

  for (const el of model.elements.values()) {
    const ancestors = ancestorsOf(model, el.id);
    if (!ancestors.every((a) => state.expanded.has(a))) continue;
    const open = state.expanded.has(el.id) && el.childIds.length > 0;
    nodes.set(`element:${el.id}`, {
      id: `element:${el.id}`,
      kind: "element",
      parentId: el.parentId ? `element:${el.parentId}` : undefined,
      isGroup: open,
      hiddenChildren: open ? 0 : el.childIds.length,
      depth: el.depth,
    });
  }

  const edges = new Map<string, GraphEdge>();
  for (const rel of model.relationships) {
    const source = liftKey(model, state, rel.from);
    const target = liftKey(model, state, rel.to);
    if (
      source === target ||
      isAncestorKey(nodes, target, source) ||
      isAncestorKey(nodes, source, target)
    ) {
      continue;
    }
    if (rel.to.type === "external" && !nodes.has(target)) {
      nodes.set(target, {
        id: target,
        kind: "external",
        isGroup: false,
        hiddenChildren: 0,
        depth: 0,
      });
    }
    const id = `${source}->${target}`;
    const edge = edges.get(id);
    if (edge) {
      edge.relationships.push(rel);
      edge.planned &&= rel.status === "planned";
    } else {
      edges.set(id, {
        id,
        source,
        target,
        relationships: [rel],
        planned: rel.status === "planned",
      });
    }
  }

  const graph = { nodes: [...nodes.values()], edges: [...edges.values()] };
  return state.focus ? focusGraph(model, graph, state.focus) : graph;
}

/** Keeps the focused node, its direct neighbors, what it owns (for actors), and their groups. */
function focusGraph(model: Model, graph: Graph, focus: string): Graph {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  if (!byId.has(focus)) return graph;

  const keep = new Set<string>([focus]);
  for (const e of graph.edges) {
    if (e.source === focus) keep.add(e.target);
    if (e.target === focus) keep.add(e.source);
  }
  if (focus.startsWith("actor:")) {
    const actorId = focus.slice("actor:".length);
    for (const el of model.elements.values()) {
      if (el.spec.owners?.includes(actorId) && byId.has(`element:${el.id}`)) {
        keep.add(`element:${el.id}`);
      }
    }
  }
  // A kept group also keeps its visible children, so the focus reads in context.
  for (const id of [...keep]) {
    if (byId.get(id)?.isGroup) {
      for (const n of graph.nodes) if (isAncestorKey(byId, id, n.id)) keep.add(n.id);
    }
  }
  for (const id of [...keep]) {
    for (let p = byId.get(id)?.parentId; p; p = byId.get(p)?.parentId) keep.add(p);
  }

  return {
    nodes: graph.nodes.filter((n) => keep.has(n.id)),
    edges: graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
  };
}

function isAncestorKey(
  nodes: ReadonlyMap<string, GraphNode>,
  ancestor: string,
  key: string,
): boolean {
  for (let p = nodes.get(key)?.parentId; p; p = nodes.get(p)?.parentId) {
    if (p === ancestor) return true;
  }
  return false;
}

/** The steps of a journey as edges between visible nodes. */
export function journeyEdges(model: Model, state: ViewState, journey: JourneyNode): JourneyEdge[] {
  return journey.steps.flatMap((step) => {
    if (!step.from || !step.to) return [];
    return [
      {
        id: `${journey.id}#${step.index}`,
        step: step.index,
        source: liftKey(model, state, step.from),
        target: liftKey(model, state, step.to),
      },
    ];
  });
}

/** Element IDs to expand so every step endpoint of a journey is visible on its own. */
export function journeyExpansion(model: Model, journey: JourneyNode): string[] {
  const out = new Set<string>();
  for (const step of journey.steps) {
    for (const t of [step.from, step.to]) {
      if (t?.type === "element") for (const a of ancestorsOf(model, t.id)) out.add(a);
    }
  }
  return [...out];
}

/** Default view: top-level systems open, everything else closed. */
export function defaultExpanded(model: Model): Set<string> {
  return new Set(
    [...model.elements.values()]
      .filter((e) => e.depth === 0 && e.spec.kind === "system" && e.childIds.length > 0)
      .map((e) => e.id),
  );
}
