import type { JourneyNode, Model, Relationship, Target } from "@archdoc/core/browser";
import { DataRegistry, fieldReferences, nodeKey, qualifyData } from "@archdoc/core/browser";
import type { Grouping } from "./groups.js";

/** What the canvas shows: which elements are open, and an optional focus. */
export interface ViewState {
  /** Element IDs whose children are shown. */
  expanded: ReadonlySet<string>;
  /** Node key (`actor:x`, `element:y`) whose neighborhood is the only thing shown. */
  focus?: string | undefined;
  /** For a landscape: the team or domain boxes elements are drawn in. */
  grouping?: Grouping | undefined;
  /** Datastore element IDs opened to show their tables. */
  tables?: ReadonlySet<string> | undefined;
}

export type GraphNodeKind = "actor" | "element" | "external" | "group" | "table";

/** A datastore's table, drawn inside it: the entry it stores and its fields. */
export interface TableInfo {
  element: string;
  table: string;
  /** Qualified data entry, such as payments.Charge. */
  entry: string;
  key?: string | undefined;
  fields: { name: string; type?: string | undefined; classification?: string | undefined }[];
}

export interface GraphNode {
  /** Node key: `actor:<id>`, `element:<id>`, `external:<ref>`, or `group:<by>:<id>`. */
  id: string;
  kind: GraphNodeKind;
  /** Node key of the enclosing group, if any. */
  parentId?: string | undefined;
  /** True for an expanded element with visible children. */
  isGroup: boolean;
  /** Number of hidden children (collapsed element). */
  hiddenChildren: number;
  depth: number;
  /** A box sized by its content, such as a table. Defaults to a card's size. */
  size?: { width: number; height: number } | undefined;
  /** For a table: what it stores. */
  table?: TableInfo | undefined;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  /** Declared relationships this edge stands for (several when lifted to a collapsed parent). */
  relationships: Relationship[];
  /** All of them are planned. */
  planned: boolean;
  /** A field pointing at another table's (a foreign key), rather than relationships. */
  reference?: { field: string; to: string } | undefined;
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
    if (!isOpen(state, id)) return `element:${id}`;
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

/** Open in the view: expanded, or a repo taken apart to group its elements. */
function isOpen(state: ViewState, id: string): boolean {
  return state.expanded.has(id) || (state.grouping?.dissolved.has(id) ?? false);
}

export function buildGraph(model: Model, state: ViewState): Graph {
  const nodes = new Map<string, GraphNode>();
  const grouping = state.grouping;

  for (const g of grouping?.groups.values() ?? []) {
    nodes.set(g.key, { id: g.key, kind: "group", isGroup: true, hiddenChildren: 0, depth: 0 });
  }

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
    if (grouping?.dissolved.has(el.id)) continue;
    const ancestors = ancestorsOf(model, el.id);
    if (!ancestors.every((a) => isOpen(state, a))) continue;
    const open = state.expanded.has(el.id) && el.childIds.length > 0;
    const tables = state.tables?.has(el.id) && Object.keys(el.spec.stores ?? {}).length > 0;
    nodes.set(`element:${el.id}`, {
      id: `element:${el.id}`,
      kind: "element",
      parentId:
        grouping?.parentOf.get(el.id) ?? (el.parentId ? `element:${el.parentId}` : undefined),
      isGroup: open || !!tables,
      hiddenChildren: open ? 0 : el.childIds.length,
      depth: el.depth,
    });
  }

  // Opened datastores show a table per entry they store, with lines for foreign keys.
  const tableEdges: GraphEdge[] = [];
  if (state.tables?.size) {
    const registry = new DataRegistry(model);
    const byEntry = new Map<string, string>();
    for (const id of state.tables) {
      const el = model.elements.get(id);
      if (!el || !nodes.has(`element:${id}`)) continue;
      for (const [table, s] of Object.entries(el.spec.stores ?? {})) {
        const entry = qualifyData(s.entity, model.namespace);
        const fields = Object.entries(registry.entry(entry)?.node.spec.fields ?? {}).map(
          ([name, f]) => ({ name, type: f.type, classification: f.classification }),
        );
        const key = tableKey(id, table);
        if (!byEntry.has(entry)) byEntry.set(entry, key);
        nodes.set(key, {
          id: key,
          kind: "table",
          parentId: `element:${id}`,
          isGroup: false,
          hiddenChildren: 0,
          depth: el.depth + 1,
          size: tableSize(fields.length),
          table: { element: id, table, entry, key: s.key, fields },
        });
      }
    }
    for (const r of fieldReferences(model, registry)) {
      const source = byEntry.get(r.entry);
      const target = byEntry.get(r.to.entry);
      if (!source || !target || source === target) continue;
      tableEdges.push({
        id: `ref:${source}.${r.field}->${target}`,
        source,
        target,
        relationships: [],
        planned: false,
        reference: { field: r.field, to: r.to.field },
      });
    }
  }

  const edges = new Map<string, GraphEdge>();
  for (const rel of model.relationships) {
    const source = liftKey(model, state, rel.from);
    const target = liftKey(model, state, rel.to);
    if (
      source === target ||
      // A repo taken apart has no box to point at.
      (source.startsWith("element:") && !nodes.has(source)) ||
      (target.startsWith("element:") && !nodes.has(target)) ||
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

  const graph = { nodes: [...nodes.values()], edges: [...edges.values(), ...tableEdges] };
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

export const TABLE_WIDTH = 240;
const TABLE_HEADER = 52;
const TABLE_ROW = 22;

/** Node key of a datastore's table. */
export function tableKey(element: string, table: string): string {
  return `table:${element}:${table}`;
}

function tableSize(rows: number): { width: number; height: number } {
  return { width: TABLE_WIDTH, height: TABLE_HEADER + Math.max(1, rows) * TABLE_ROW + 8 };
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
