import {
  type DataNode,
  DataRegistry,
  dataFlows,
  dataStores,
  type JourneyNode,
  lineage,
  type Model,
  nodeKey,
  qualifyData,
  SIMULATED_NOW,
} from "@archdoc/core/browser";
import { type Graph, type GraphNode, liftKey, type ViewState } from "./graph.js";

/** Classifications that don't need a reviewer's attention. */
const ROUTINE = new Set(["public", "internal"]);

/** The sensitive classifications among an entry's fields, such as ["pii"]. */
export function sensitivity(node: DataNode): string[] {
  return [
    ...new Set(
      Object.values(node.spec.fields ?? {})
        .map((f) => f.classification)
        .filter((c): c is string => !!c && !ROUTINE.has(c)),
    ),
  ];
}

/** What to light up on the canvas for a data entry: where it's stored, and where it travels. */
export interface DataFocus {
  /** Visible boxes that store it. */
  stores: Set<string>;
  /** Visible boxes it travels between. */
  nodes: Set<string>;
  /** Visible edges it travels along, as source->target. */
  edges: Set<string>;
}

export function dataFocus(model: Model, view: ViewState, entry: string): DataFocus {
  const focus: DataFocus = { stores: new Set(), nodes: new Set(), edges: new Set() };
  const same = (data: string) => qualifyData(data, model.namespace) === entry;
  for (const s of dataStores(model)) {
    if (same(s.data)) focus.stores.add(liftKey(model, view, { type: "element", id: s.element }));
  }
  for (const f of dataFlows(model)) {
    if (!same(f.data)) continue;
    const a = liftKey(model, view, f.from);
    const b = liftKey(model, view, f.to);
    focus.nodes.add(a);
    focus.nodes.add(b);
    // Edges point along declared relationships, which may run against the data (a response).
    focus.edges.add(`${a}->${b}`);
    focus.edges.add(`${b}->${a}`);
  }
  return focus;
}

/** Labels and details for the boxes of a lineage graph. */
export interface LineageInfo {
  graph: Graph;
  /** By node key: entry:<ref> or field:<ref>.<field>. */
  nodes: Map<
    string,
    {
      label: string;
      kind: "entry" | "field";
      classification?: string | undefined;
      detail?: string | undefined;
      focus?: boolean;
    }
  >;
  /** By edge ID: the expression and the mapping. */
  edges: Map<string, { expression: string; mapping: string; copy: boolean }>;
}

/**
 * A field's lineage as a graph: one box per entry, holding the fields on the
 * way, with an edge per mapping expression. `ref` is entry.field.
 */
export function lineageGraph(model: Model, ref: string): LineageInfo | undefined {
  const l = lineage(model, ref);
  if (!l) return undefined;
  const nodes: LineageInfo["nodes"] = new Map();
  const graphNodes = new Map<string, GraphNode>();
  const edges: LineageInfo["edges"] = new Map();
  const graphEdges: Graph["edges"] = [];
  const short = (entry: string) =>
    entry.startsWith(`${model.namespace}.`) ? entry.slice(model.namespace.length + 1) : entry;

  const addField = (f: { entry: string; field: string }) => {
    const entryKey = `entry:${f.entry}`;
    if (!graphNodes.has(entryKey)) {
      graphNodes.set(entryKey, {
        id: entryKey,
        kind: "group",
        isGroup: true,
        hiddenChildren: 0,
        depth: 0,
      });
      const tables = l.stored.get(f.entry) ?? [];
      nodes.set(entryKey, {
        label: short(f.entry),
        kind: "entry",
        detail: tables.length
          ? tables
              .map(
                (t) =>
                  `${t.namespace === model.namespace ? "" : `${t.namespace}.`}${t.element} (${t.table})`,
              )
              .join(", ")
          : undefined,
      });
    }
    const key = `field:${f.entry}.${f.field}`;
    if (!graphNodes.has(key)) {
      graphNodes.set(key, {
        id: key,
        kind: "element",
        parentId: entryKey,
        isGroup: false,
        hiddenChildren: 0,
        depth: 1,
      });
      nodes.set(key, {
        label: f.field,
        kind: "field",
        classification: l.classifications.get(`${f.entry}.${f.field}`),
        focus: f.entry === l.field.entry && f.field === l.field.field,
      });
    }
    return key;
  };

  addField(l.field);
  for (const e of [...l.upstream, ...l.downstream]) {
    const to = addField(e.to);
    for (const f of e.from) {
      const from = addField(f);
      const id = `${from}->${to}`;
      if (edges.has(id)) continue;
      edges.set(id, { expression: e.expression, mapping: e.mapping, copy: e.copy });
      graphEdges.push({ id, source: from, target: to, relationships: [], planned: false });
    }
  }
  return { graph: { nodes: [...graphNodes.values()], edges: graphEdges }, nodes, edges };
}

/** True when a journey says anything about data: what steps send, decide, map, create, or change. */
export function hasData(journey: JourneyNode): boolean {
  return journey.steps.some((s) => {
    const x = s.spec;
    return x.sends || x.decides || x.via || x.creates || x.changes || x.branches;
  });
}

/**
 * A starting sample for simulating a journey: a record for each entry its
 * steps send, its logic and mappings read, and its changes need, with a
 * placeholder value for each field by type.
 */
export function sampleSkeleton(
  model: Model,
  journey: JourneyNode,
): Record<string, Record<string, unknown>> {
  const registry = new DataRegistry(model);
  const ns = model.namespace;
  const produced = new Set<string>();
  const needed: string[] = [];
  const need = (ref: string, at = ns) => {
    const q = qualifyData(ref, at);
    if (!produced.has(q) && !needed.includes(q)) needed.push(q);
  };
  for (const s of journey.steps) {
    if (s.spec.via) {
      const m = registry.mapping(s.spec.via);
      if (m) {
        for (const ref of Object.values(m.node.spec.from)) need(ref, m.namespace);
        const t = registry.target(m.node.spec.to, m.namespace);
        if (t) produced.add(t.entry);
      }
    }
    for (const data of [s.spec.sends ?? []].flat()) need(data);
    if (s.spec.decides) {
      const l = registry.logic(s.spec.decides);
      for (const ref of Object.values(l?.node.spec.input ?? {})) need(ref, l?.namespace);
    }
    for (const key of Object.keys(s.spec.changes ?? {})) need(key.slice(0, key.lastIndexOf(".")));
    for (const b of Object.values(s.spec.branches ?? {})) {
      for (const key of Object.keys(b.changes ?? {})) need(key.slice(0, key.lastIndexOf(".")));
    }
  }
  const short = (q: string) => (q.startsWith(`${ns}.`) ? q.slice(ns.length + 1) : q);
  return Object.fromEntries(
    needed.map((q) => {
      const entry = registry.entry(q);
      const record = Object.fromEntries(
        Object.entries(entry?.node.spec.fields ?? {}).map(([name, f]) => [
          name,
          example(f.type, f.values),
        ]),
      );
      return [short(q), record];
    }),
  );
}

function example(type: string | undefined, values: (string | number)[] | undefined): unknown {
  if (values?.length) return values[0];
  switch (type) {
    case "int":
    case "number":
      return 0;
    case "bool":
      return false;
    case "timestamp":
      return SIMULATED_NOW;
    case "date":
      return SIMULATED_NOW.slice(0, 10);
    case "uuid":
      return "id-1";
    default:
      return "";
  }
}

/** Node key for a target, for use outside the graph module. */
export { nodeKey };
