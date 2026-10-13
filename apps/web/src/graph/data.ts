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
import { liftKey, type ViewState } from "./graph.js";

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
  // An API or topic that accepts, returns, or carries it, even when nothing here sends it.
  for (const e of model.elements.values()) {
    for (const p of e.spec.provides ?? []) {
      const names = [p.accepts, p.returns, p.carries].flat().filter((d): d is string => !!d);
      if (names.some((d) => same(d)))
        focus.nodes.add(liftKey(model, view, { type: "element", id: e.id }));
    }
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

/** What a field's lineage lights up: every entry on the way, where they're stored and sent, and the fields themselves. */
export interface LineageFocus extends DataFocus {
  /** Qualified entries on the way, the field's own first. */
  entries: string[];
  /** entry.field for every field on the way. */
  fields: Set<string>;
}

export function lineageFocus(model: Model, view: ViewState, ref: string): LineageFocus | undefined {
  const l = lineage(model, ref);
  if (!l) return undefined;
  const fields = new Set<string>([`${l.field.entry}.${l.field.field}`]);
  for (const e of [...l.upstream, ...l.downstream]) {
    fields.add(`${e.to.entry}.${e.to.field}`);
    for (const f of e.from) fields.add(`${f.entry}.${f.field}`);
  }
  const entries = [...new Set([...fields].map((f) => f.slice(0, f.lastIndexOf("."))))];
  const focus: LineageFocus = {
    entries,
    fields,
    stores: new Set(),
    nodes: new Set(),
    edges: new Set(),
  };
  for (const entry of entries) {
    const f = dataFocus(model, view, entry);
    for (const k of f.stores) focus.stores.add(k);
    for (const k of f.nodes) focus.nodes.add(k);
    for (const k of f.edges) focus.edges.add(k);
  }
  return focus;
}

/** Element IDs where an entry is stored, and the elements it travels between, to open on the canvas. */
export function dataPlaces(model: Model, entry: string): { stores: string[]; ends: string[] } {
  const same = (data: string) => qualifyData(data, model.namespace) === entry;
  const stores = dataStores(model)
    .filter((s) => same(s.data))
    .map((s) => s.element);
  const providers = [...model.elements.values()]
    .filter((e) =>
      (e.spec.provides ?? []).some((p) =>
        [p.accepts, p.returns, p.carries].flat().some((d) => !!d && same(d)),
      ),
    )
    .map((e) => e.id);
  const ends = dataFlows(model)
    .filter((f) => same(f.data))
    .flatMap((f) => [f.from, f.to])
    .flatMap((t) => (t.type === "element" ? [t.id] : []));
  return { stores: [...new Set(stores)], ends: [...new Set([...ends, ...providers])] };
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
