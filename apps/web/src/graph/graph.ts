import {
  DataRegistry,
  type FieldReference,
  fieldReferences,
  type JourneyNode,
  type Model,
  nodeKey,
  qualifyData,
  type Relationship,
  subscriptionOf,
  type Target,
} from "@archdoc/core/browser";
import type { Involvement } from "./data.js";
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
  /** Qualified entries whose tables show their fields; the rest show only their names. */
  openFields?: ReadonlySet<string> | undefined;
  /**
   * During a journey, what it uses: other tables fold into one box per
   * datastore, and other rows are hidden, except in `showAll` datastores and
   * for `extra` entries brought back one at a time.
   */
  involved?: Involvement | undefined;
  showAll?: ReadonlySet<string> | undefined;
  extra?: ReadonlySet<string> | undefined;
  /** Opened datastores that show their rows instead of their tables, and the rows, by qualified entry. */
  rows?: { stores: ReadonlySet<string>; data: ReadonlyMap<string, RowInfo[]> } | undefined;
}

/** A record in a datastore, as a journey has it at the current step. */
export interface RowInfo {
  /** Qualified entry. */
  entry: string;
  /** The value of its key, when it has one. */
  id?: string | undefined;
  record: Record<string, unknown>;
  /** existing: in the sample before the journey; created: by a step. */
  origin: "existing" | "created";
  /** The step (0-based) that created or last changed it. */
  step?: number | undefined;
  /** Fields the current step set or changed. */
  changed: ReadonlySet<string>;
  /** Created by the current step. */
  isNew: boolean;
  /** Values are what the steps declare, not a simulation's. */
  declared?: boolean | undefined;
}

export type GraphNodeKind =
  | "actor"
  | "element"
  | "external"
  | "group"
  | "table"
  | "rowtable"
  | "others";

/** A datastore's table, drawn inside it: the entry it stores and its fields. */
export interface TableInfo {
  element: string;
  table: string;
  /** Qualified data entry, such as payments.Charge. */
  entry: string;
  key?: string | undefined;
  fields: { name: string; type?: string | undefined; classification?: string | undefined }[];
  /** Whether it shows its fields, or only its name and how many fields it has. */
  open: boolean;
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
  /** For a table (or a table of rows): what it stores. */
  table?: TableInfo | undefined;
  /** For a table of rows: the records, and the columns shown. */
  rows?: RowInfo[] | undefined;
  columns?: string[] | undefined;
  /** For a table of rows: each column's width in pixels, to fit its header and values. */
  columnWidths?: number[] | undefined;
  /** For a table of rows: rows the journey doesn't use, left out. */
  hiddenRows?: number | undefined;
  /** For the box of folded tables: the tables in it. */
  folded?: { entry: string; table: string }[] | undefined;
  /** ELK options for a group's own layout, such as a datastore's tables. */
  layout?: Record<string, string> | undefined;
  /** Where edges attach, relative to the node, such as each row's sides. */
  ports?: { id: string; side: "WEST" | "EAST"; x: number; y: number }[] | undefined;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  /** Declared relationships this edge stands for (several when lifted to a collapsed parent). */
  relationships: Relationship[];
  /** All of them are planned. */
  planned: boolean;
  /**
   * A subscription to a topic or event: drawn from the publisher to the
   * subscriber, the way its messages go, with the channel and how it travels.
   */
  subscription?: { channel: string; transport?: string | undefined } | undefined;
  /** A field pointing at another table's (a foreign key), rather than relationships. */
  reference?: { field: string; to: string } | undefined;
  /** Between rows: the line in each table of rows. */
  rows?: { from: number; to: number } | undefined;
  /** Ports on the source and target the edge attaches to. */
  sourcePort?: string | undefined;
  targetPort?: string | undefined;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface JourneyEdge {
  id: string;
  /** Index of the interaction it draws. */
  at: number;
  /** 0-based step index. */
  step: number;
  /** Its number on the canvas, such as "3" or "3.1". */
  label: string;
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
      // A datastore showing rows lays its tables out on their own: fewer crossings between rows.
      layout: tables && state.rows?.stores.has(el.id) ? OWN_LAYOUT : undefined,
      hiddenChildren: open ? 0 : el.childIds.length,
      depth: el.depth,
    });
  }

  // Opened datastores show a table per entry they store, with lines for foreign
  // keys; in rows mode, the rows a journey has so far, with lines between them.
  const tableEdges: GraphEdge[] = [];
  if (state.tables?.size) {
    const registry = new DataRegistry(model);
    const references = fieldReferences(model, registry);
    const byEntry = new Map<string, string>();
    const rowNodes = new Map<string, { node: string; row: RowInfo; index: number }[]>();
    for (const id of state.tables) {
      const el = model.elements.get(id);
      if (!el || !nodes.has(`element:${id}`)) continue;
      const stores = Object.entries(el.spec.stores ?? {});
      const asRows = state.rows?.stores.has(id);
      // During a journey, what it doesn't use folds away.
      const involved = state.showAll?.has(id) ? undefined : state.involved;
      const folded: { entry: string; table: string }[] = [];
      for (const [table, s] of stores) {
        const entry = qualifyData(s.entity, model.namespace);
        const key = s.key ?? "id";
        const brought = state.extra?.has(entry) ?? false;
        if (asRows) {
          const all = state.rows?.data.get(entry) ?? [];
          if (!all.length) continue;
          const rows =
            involved?.rows && !brought
              ? all.filter((r, i) => involved.rows?.has(rowKey(entry, r.id, i)))
              : all;
          if (!rows.length) {
            folded.push({ entry, table });
            continue;
          }
          // One small table per table: a line per record, with a port on each side of each line.
          const node = `rows:${id}:${table}`;
          const columns = rowColumns(rows, references, key);
          const linking = new Set(references.filter((r) => r.entry === entry).map((r) => r.field));
          const columnWidths = rowColumnWidths(columns, rows, linking);
          const hiddenRows = all.length - rows.length;
          const size = rowTableSize(columnWidths, rows.length, hiddenRows > 0, {
            label: entry.slice(entry.lastIndexOf(".") + 1),
            table,
            rows: rows.length,
          });
          nodes.set(node, {
            id: node,
            kind: "rowtable",
            parentId: `element:${id}`,
            isGroup: false,
            hiddenChildren: 0,
            depth: el.depth + 1,
            size,
            table: { element: id, table, entry, key, fields: [], open: false },
            rows,
            columns,
            columnWidths,
            hiddenRows,
            ports: rows.flatMap((_, i) => {
              const y = rowY(i);
              return [
                { id: rowPort(node, i, "in"), side: "WEST" as const, x: 0, y },
                { id: rowPort(node, i, "out"), side: "EAST" as const, x: size.width, y },
              ];
            }),
          });
          rowNodes.set(entry, [
            ...(rowNodes.get(entry) ?? []),
            ...rows.map((row, index) => ({ node, row, index })),
          ]);
          continue;
        }
        if (involved && !brought && !involved.entries.has(entry)) {
          folded.push({ entry, table });
          continue;
        }
        const fields = Object.entries(registry.entry(entry)?.node.spec.fields ?? {}).map(
          ([name, f]) => ({ name, type: f.type, classification: f.classification }),
        );
        // Tables show their names until opened, so a big schema reads at a glance.
        const open = state.openFields?.has(entry) ?? false;
        const node = tableKey(id, table);
        if (!byEntry.has(entry)) byEntry.set(entry, node);
        nodes.set(node, {
          id: node,
          kind: "table",
          parentId: `element:${id}`,
          isGroup: false,
          hiddenChildren: 0,
          depth: el.depth + 1,
          size: open ? tableSize(fields.length) : { width: TABLE_WIDTH, height: TABLE_HEADER + 4 },
          table: {
            element: id,
            table,
            entry,
            key: s.key,
            fields,
            open,
          },
        });
      }
      if (folded.length) {
        const node = `others:${id}`;
        nodes.set(node, {
          id: node,
          kind: "others",
          parentId: `element:${id}`,
          isGroup: false,
          hiddenChildren: 0,
          depth: el.depth + 1,
          size: othersSize(folded.length),
          folded,
        });
      }
    }
    for (const r of references) {
      const source = byEntry.get(r.entry);
      const target = byEntry.get(r.to.entry);
      if (source && target && source !== target) {
        tableEdges.push({
          id: `ref:${source}.${r.field}->${target}`,
          source,
          target,
          relationships: [],
          planned: false,
          reference: { field: r.field, to: r.to.field },
        });
      }
      // Row to row: the row whose key is the value this row's field holds.
      for (const from of rowNodes.get(r.entry) ?? []) {
        const value = from.row.record[r.field];
        if (value === undefined || value === null || value === "") continue;
        const to = (rowNodes.get(r.to.entry) ?? []).find(
          (t) =>
            !(t.node === from.node && t.index === from.index) &&
            String(t.row.record[r.to.field]) === String(value),
        );
        // Lines within one table (a category's parent) would loop back on it; the value shows it.
        if (!to || to.node === from.node) continue;
        tableEdges.push({
          id: `rowref:${from.node}:${from.index}.${r.field}->${to.node}:${to.index}`,
          source: from.node,
          target: to.node,
          relationships: [],
          planned: false,
          reference: { field: r.field, to: r.to.field },
          rows: { from: from.index, to: to.index },
          sourcePort: rowPort(from.node, from.index, "out"),
          targetPort: rowPort(to.node, to.index, "in"),
        });
      }
    }
  }

  const edges = new Map<string, GraphEdge>();
  for (const rel of model.relationships) {
    // A subscription is drawn the way its messages go: from the publisher to the subscriber.
    const sub = subscriptionOf(model, rel);
    const [source, target] = sub
      ? [liftKey(model, state, rel.to), liftKey(model, state, rel.from)]
      : [liftKey(model, state, rel.from), liftKey(model, state, rel.to)];
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
    const outside = liftKey(model, state, rel.to);
    if (rel.to.type === "external" && !nodes.has(outside)) {
      nodes.set(outside, {
        id: outside,
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
        ...(sub ? { subscription: { channel: sub.channel, transport: sub.transport } } : {}),
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

export const ROWS_HEADER = 40;
export const ROWS_COLUMNS = 22;
export const ROWS_LINE = 22;

/** The columns a table of rows shows: its key, what its rows point at, what changed, and status. */
export function rowColumns(
  rows: readonly RowInfo[],
  references: readonly FieldReference[],
  key: string,
): string[] {
  const present = new Set(rows.flatMap((r) => Object.keys(r.record)));
  const linked = references.filter((r) => r.entry === rows[0]?.entry).map((r) => r.field);
  const changed = rows.flatMap((r) => [...r.changed]);
  return [...new Set([key, ...linked, ...changed, "status"])]
    .filter((c) => present.has(c))
    .slice(0, 6);
}

/** The badge column at the start of each line of a table of rows. */
export const ROWS_BADGE = 62;
// Approximate character widths: monospace values and headers, the sans-serif title.
const VALUE_CHAR = 7;
const HEADER_CHAR = 6.4;
const TITLE_CHAR = 9;

/** Each column's width: enough for its header (with the arrow, if it points at a row) and its longest value. */
export function rowColumnWidths(
  columns: readonly string[],
  rows: readonly RowInfo[],
  linking: ReadonlySet<string>,
): number[] {
  return columns.map((c) => {
    const header = c.length * HEADER_CHAR + (linking.has(c) ? 12 : 0);
    const value = Math.max(0, ...rows.map((r) => showValue(r.record[c]).length)) * VALUE_CHAR;
    return Math.round(Math.min(170, Math.max(44, header, value) + 14));
  });
}

/** How a table of rows shows a value. */
export function showValue(v: unknown): string {
  return v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
}

/** A table of rows' size: its title, a badge column and its columns, and a line for hidden rows. */
export function rowTableSize(
  widths: readonly number[],
  rows: number,
  hidden = false,
  title?: { label: string; table: string; rows: number },
): { width: number; height: number } {
  const head = title
    ? 28 +
      title.label.length * TITLE_CHAR +
      `${title.table} · ${title.rows} rows`.length * VALUE_CHAR
    : 0;
  return {
    width: Math.ceil(Math.max(180, head, ROWS_BADGE + widths.reduce((a, b) => a + b, 0) + 2)),
    height: ROWS_HEADER + ROWS_COLUMNS + (rows + (hidden ? 1 : 0)) * ROWS_LINE + 6,
  };
}

const OWN_LAYOUT = {
  "elk.hierarchyHandling": "SEPARATE_CHILDREN",
  "elk.algorithm": "layered",
  "elk.edgeRouting": "ORTHOGONAL",
  // Places tables to keep lines short and straight, rather than looping around the edge.
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
};

/** The key of a row in an Involvement. */
export const rowKey = (entry: string, id: string | undefined, index: number) =>
  `${entry}#${id ?? `@${index}`}`;

/** The most folded tables the box lists by name. */
export const OTHERS_LISTED = 12;

function othersSize(count: number): { width: number; height: number } {
  const lines = Math.min(count, OTHERS_LISTED) + (count > OTHERS_LISTED ? 1 : 0);
  return { width: 220, height: 64 + lines * 20 };
}

/** The middle of line `index` in a table of rows. */
function rowY(index: number): number {
  return ROWS_HEADER + ROWS_COLUMNS + index * ROWS_LINE + ROWS_LINE / 2;
}

/**
 * The graph with each table of rows' lines in a new order (`order` lists
 * old indexes, new order first), and its ports and lines between rows to match.
 */
export function reorderRows(graph: Graph, order: ReadonlyMap<string, number[]>): Graph {
  const moved = new Map<string, Map<number, number>>();
  const nodes = graph.nodes.map((n) => {
    const o = order.get(n.id);
    if (!o || !n.rows || !n.size) return n;
    moved.set(n.id, new Map(o.map((old, i) => [old, i])));
    const width = n.size.width;
    return {
      ...n,
      rows: o.map((i) => n.rows?.[i] as RowInfo),
      ports: o.flatMap((_, i) => [
        { id: rowPort(n.id, i, "in"), side: "WEST" as const, x: 0, y: rowY(i) },
        { id: rowPort(n.id, i, "out"), side: "EAST" as const, x: width, y: rowY(i) },
      ]),
    };
  });
  const edges = graph.edges.map((e) => {
    if (!e.rows) return e;
    const from = moved.get(e.source)?.get(e.rows.from) ?? e.rows.from;
    const to = moved.get(e.target)?.get(e.rows.to) ?? e.rows.to;
    return {
      ...e,
      rows: { from, to },
      sourcePort: rowPort(e.source, from, "out"),
      targetPort: rowPort(e.target, to, "in"),
    };
  });
  return { nodes, edges };
}

function rowPort(node: string, index: number, side: "in" | "out"): string {
  return `${node}#${index}:${side}`;
}

/** A journey's interactions as edges between visible nodes. */
export function journeyEdges(
  model: Model,
  state: ViewState,
  journey: string,
  interactions: readonly { step: number; label: string; from: Target; to: Target }[],
): JourneyEdge[] {
  return interactions.map((x, at) => ({
    id: `${journey}#${x.label}`,
    at,
    step: x.step,
    label: x.label,
    source: liftKey(model, state, x.from),
    target: liftKey(model, state, x.to),
  }));
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
