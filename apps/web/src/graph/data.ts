import {
  type DataNode,
  DataRegistry,
  dataFlows,
  dataStores,
  fieldReferences,
  type JourneyNode,
  lineage,
  type Model,
  nodeKey,
  qualifyData,
  SIMULATED_NOW,
  type Simulation,
  type StepMessage,
  stepMessage,
} from "@archdoc/core/browser";
import { liftKey, type RowInfo, rowKey, type ViewState } from "./graph.js";

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

/** A field as the explorer shows it, with its value in a simulation. */
export interface FieldInfo {
  name: string;
  type?: string | undefined;
  classification?: string | undefined;
  value?: string | undefined;
}

/** What a journey step carries, and the records it writes. */
export interface StepData {
  message?:
    | {
        how: StepMessage["how"];
        entries: { entry: string; label: string; kind?: string | undefined; fields: FieldInfo[] }[];
      }
    | undefined;
  /** Records it creates or changes: as simulated, or else as declared. */
  writes: StepWrite[];
}

export interface StepWrite {
  /** Qualified entry. */
  entry: string;
  created: boolean;
  /** Field to its new value, or "from → to". */
  values: Map<string, string>;
  /** The branch it's in, when declared and not simulated. */
  when?: string | undefined;
}

/** What step `index` of a journey sends and writes, with values when it's simulated. */
export function stepData(
  model: Model,
  journey: JourneyNode,
  index: number,
  simulation?: Simulation,
): StepData {
  const step = journey.steps[index];
  if (!step) return { writes: [] };
  const registry = new DataRegistry(model);
  const ns = model.namespace;
  const sim = simulation?.journey === journey.id ? simulation.steps[index] : undefined;
  const sent = new Map(
    (sim?.events ?? []).filter((e) => e.kind === "sent").map((e) => [e.entry, e.record]),
  );
  const msg = stepMessage(model, step);
  const message = msg && {
    how: msg.how,
    entries: msg.data.map((ref) => {
      const entry = qualifyData(ref, ns);
      const node = registry.entry(entry)?.node;
      const record = sent.get(entry);
      return {
        entry,
        label: shortRef(entry, ns),
        kind: node?.spec.kind,
        fields: Object.entries(node?.spec.fields ?? {}).map(([name, f]) => ({
          name,
          type: f.type,
          classification: f.classification,
          value: record && name in record ? show(record[name]) : undefined,
        })),
      };
    }),
  };

  if (sim) {
    const writes = sim.events
      .filter((e) => e.kind !== "sent")
      .map((e) => ({
        entry: e.entry,
        created: e.kind === "created",
        values: new Map(
          e.fields.map((f) => [
            f.field,
            f.from === undefined ? show(f.to) : `${show(f.from)} → ${show(f.to)}`,
          ]),
        ),
      }));
    return { message, writes };
  }
  const writes: StepWrite[] = [];
  const declare = (spec: Effects, when?: string) => {
    const creates = spec.creates;
    const created: [string, Record<string, unknown>][] =
      typeof creates === "string"
        ? [[creates, {}]]
        : Array.isArray(creates)
          ? creates.map((c) => [c, {}])
          : Object.entries(creates ?? {});
    for (const [ref, fields] of created) {
      writes.push({
        entry: qualifyData(ref, ns),
        created: true,
        values: new Map(Object.entries(fields).map(([k, v]) => [k, show(v)])),
        when,
      });
    }
    for (const [key, change] of Object.entries(spec.changes ?? {})) {
      const dot = key.lastIndexOf(".");
      const entry = qualifyData(key.slice(0, dot), ns);
      const value = String(change).replace(/\s*->\s*/, " → ");
      const existing = writes.find((w) => w.entry === entry && !w.created && w.when === when);
      if (existing) existing.values.set(key.slice(dot + 1), value);
      else
        writes.push({
          entry,
          created: false,
          values: new Map([[key.slice(dot + 1), value]]),
          when,
        });
    }
  };
  // What a mapping the step writes through produces.
  if (step.spec.via) {
    const m = registry.mapping(step.spec.via);
    const t = m && registry.target(m.node.spec.to, m.namespace);
    if (t) {
      writes.push({
        entry: t.entry,
        created: true,
        values: new Map(Object.entries(m.node.spec.fields).map(([k, v]) => [k, `= ${v}`])),
      });
    }
  }
  declare(step.spec);
  for (const [outcome, b] of Object.entries(step.spec.branches ?? {})) declare(b, outcome);
  return { message, writes: merge(writes) };
}

/** One write per record and branch: a record the step also changes is updated, not created. */
function merge(writes: StepWrite[]): StepWrite[] {
  const out: StepWrite[] = [];
  for (const w of writes) {
    const same = out.find((o) => o.entry === w.entry && o.when === w.when);
    if (!same) {
      out.push({ ...w, values: new Map(w.values) });
      continue;
    }
    same.created &&= w.created;
    for (const [k, v] of w.values) same.values.set(k, v);
  }
  return out;
}

type Effects = {
  creates?: string | string[] | Record<string, Record<string, unknown>> | undefined;
  changes?: Record<string, string> | undefined;
};

/** Datastores that hold what a journey writes or sends, to open their tables. */
export function journeyStores(model: Model, journey: JourneyNode): string[] {
  const entries = new Set<string>();
  for (const s of journey.steps) {
    const d = stepData(model, journey, s.index);
    for (const w of d.writes) entries.add(w.entry);
    for (const e of d.message?.entries ?? []) entries.add(e.entry);
  }
  return [...new Set([...entries].flatMap((e) => dataPlaces(model, e).stores))];
}

function shortRef(entry: string, ns: string): string {
  return entry.startsWith(`${ns}.`) ? entry.slice(ns.length + 1) : entry;
}

function show(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

/**
 * The rows a journey has by step `index`, by qualified entry: the sample's
 * rows, then every record a step created or changed. Without a simulation,
 * the records the steps declare, from steps that always run.
 */
export function journeyRows(
  model: Model,
  journey: JourneyNode,
  index: number,
  simulation?: Simulation,
): Map<string, RowInfo[]> {
  const registry = new DataRegistry(model);
  const keyOf = (entry: string) => {
    const at = registry.storedIn(entry)[0];
    if (!at) return "id";
    const store = registry.models.get(at.namespace)?.elements.get(at.element);
    return store?.spec.stores?.[at.table]?.key ?? "id";
  };
  const rows = new Map<string, RowInfo[]>();
  const list = (entry: string) => {
    const l = rows.get(entry) ?? [];
    rows.set(entry, l);
    return l;
  };
  const idOf = (entry: string, record: Record<string, unknown>) => {
    const v = record[keyOf(entry)];
    return v === undefined || v === null ? undefined : String(v);
  };
  const sim = simulation?.journey === journey.id ? simulation : undefined;

  if (sim) {
    for (const [entry, seeded] of Object.entries(sim.seed)) {
      for (const record of seeded) {
        list(entry).push({
          entry,
          id: idOf(entry, record),
          record: { ...record },
          origin: "existing",
          changed: new Set(),
          isNew: false,
        });
      }
    }
    for (const s of sim.steps.slice(0, index + 1)) {
      if (!s.ran) continue;
      const current = s.step - 1 === index;
      for (const e of s.events) {
        if (e.kind === "sent") continue;
        const l = list(e.entry);
        const id = idOf(e.entry, e.record);
        // The row it is, by key; a change with no key changes the row the journey reads.
        const existing =
          (id !== undefined ? l.find((r) => r.id === id) : undefined) ??
          (e.kind === "changed" ? l[0] : undefined);
        const changed = new Set(e.fields.map((f) => f.field));
        if (existing) {
          existing.record = { ...existing.record, ...e.record };
          existing.id = idOf(e.entry, existing.record);
          existing.step = s.step - 1;
          existing.changed = current ? changed : new Set();
          existing.isNew = current && e.kind === "created" && existing.origin === "created";
        } else {
          l.push({
            entry: e.entry,
            id,
            record: { ...e.record },
            origin: "created",
            step: s.step - 1,
            changed: current ? changed : new Set(),
            isNew: current,
          });
        }
      }
    }
    return new Map([...rows].filter(([, l]) => l.length));
  }

  for (const s of journey.steps.slice(0, index + 1)) {
    if (s.spec.when) continue;
    const current = s.index === index;
    for (const w of stepData(model, journey, s.index).writes) {
      if (w.when) continue;
      const record = Object.fromEntries(w.values);
      const l = list(w.entry);
      const existing = !w.created ? l[l.length - 1] : undefined;
      if (existing) {
        Object.assign(existing.record, record);
        existing.step = s.index;
        existing.changed = current ? new Set(w.values.keys()) : new Set();
        continue;
      }
      l.push({
        entry: w.entry,
        id: idOf(w.entry, record),
        record,
        origin: "created",
        step: s.index,
        changed: current ? new Set(w.values.keys()) : new Set(),
        isNew: current,
        declared: true,
      });
    }
  }
  return new Map([...rows].filter(([, l]) => l.length));
}

/** What a journey uses in its datastores, so the rest can be folded away. */
export interface Involvement {
  /** Qualified entries it writes, sends, or reads. */
  entries: Set<string>;
  /** Rows it wrote and the rows they point at, as entry#id; set when there are rows. */
  rows?: Set<string> | undefined;
}

/**
 * The entries a journey uses: what its steps write and send, and what its
 * decisions and mappings read. With rows, the ones it wrote by now and the
 * rows its decisions and mappings read, and the rows those point at.
 */
export function journeyInvolvement(
  model: Model,
  journey: JourneyNode,
  rows?: ReadonlyMap<string, RowInfo[]>,
): Involvement {
  const registry = new DataRegistry(model);
  const ns = model.namespace;
  const entries = new Set<string>();
  const read = new Set<string>();
  for (const s of journey.steps) {
    const d = stepData(model, journey, s.index);
    for (const w of d.writes) entries.add(w.entry);
    for (const e of d.message?.entries ?? []) entries.add(e.entry);
    const inputs = [
      ...Object.entries(
        (s.spec.decides && registry.logic(s.spec.decides)?.node.spec.input) || {},
      ).map(([, ref]) => qualifyData(ref, registry.logic(s.spec.decides ?? "")?.namespace ?? ns)),
      ...Object.entries((s.spec.via && registry.mapping(s.spec.via)?.node.spec.from) || {}).map(
        ([, ref]) => qualifyData(ref, registry.mapping(s.spec.via ?? "")?.namespace ?? ns),
      ),
    ];
    for (const e of inputs) {
      entries.add(e);
      read.add(e);
    }
  }
  if (!rows) return { entries };

  const involved = new Set<string>();
  // The rows the journey writes and reads; what they point at is added, one hop out.
  const queue: { entry: string; row: RowInfo }[] = [];
  const add = (entry: string, row: RowInfo, index: number, used = true) => {
    const key = rowKey(entry, row.id, index);
    if (involved.has(key)) return;
    involved.add(key);
    if (used) queue.push({ entry, row });
  };
  for (const [entry, list] of rows) {
    list.forEach((row, i) => {
      if (row.origin === "created" || row.step !== undefined) add(entry, row, i);
    });
    // The row the journey's decisions and mappings read: the first of each.
    const first = list[0];
    if (first && read.has(entry)) add(entry, first, 0);
  }
  const references = fieldReferences(model, registry);
  while (queue.length) {
    const { entry, row } = queue.shift() as { entry: string; row: RowInfo };
    for (const r of references) {
      if (r.entry !== entry) continue;
      const value = row.record[r.field];
      if (value === undefined || value === null || value === "") continue;
      const targets = rows.get(r.to.entry) ?? [];
      const i = targets.findIndex((t) => String(t.record[r.to.field]) === String(value));
      const target = targets[i];
      if (target) add(r.to.entry, target, i, false);
    }
  }
  return { entries, rows: involved };
}
