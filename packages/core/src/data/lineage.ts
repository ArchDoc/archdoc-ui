import type { Model } from "../model.js";
import { compile } from "./cel.js";
import { DataRegistry, type StoredIn } from "./registry.js";
import { qualifyData, splitField } from "./resolve.js";

/** A field of an entry, qualified: payments.Refund.amount_cents. */
export interface FieldId {
  entry: string;
  field: string;
}

/** One target field a mapping computes, and the input fields it reads. */
export interface LineageEdge {
  /** The mapping, qualified, such as payments.refund-to-ledger. */
  mapping: string;
  namespace: string;
  from: FieldId[];
  to: FieldId;
  expression: string;
  /** The table the mapping writes, when it names one. */
  table?: StoredIn | undefined;
  /** The expression only copies its input (refund.id), rather than deriving a value. */
  copy: boolean;
}

export interface Lineage {
  field: FieldId;
  /** Where the value comes from, nearest first. */
  upstream: LineageEdge[];
  /** Where it's copied or derived to, nearest first. */
  downstream: LineageEdge[];
  /** Tables each entry on the way is stored in, by qualified entry. */
  stored: Map<string, StoredIn[]>;
  /** Classifications of the fields on the way, by "entry.field". */
  classifications: Map<string, string>;
}

/** Every field-to-field edge the mappings in every known model declare. */
export function lineageEdges(model: Model): LineageEdge[] {
  const registry = new DataRegistry(model);
  const edges: LineageEdge[] = [];
  for (const m of registry.allMappings()) {
    const target = registry.target(m.node.spec.to, m.namespace);
    if (!target) continue;
    const inputs = new Map(
      Object.entries(m.node.spec.from).map(([alias, ref]) => [
        alias,
        qualifyData(ref, m.namespace),
      ]),
    );
    for (const [field, expression] of Object.entries(m.node.spec.fields)) {
      const compiled = compile(expression, new Set(inputs.keys()));
      if (!compiled.ok) continue;
      const from = compiled.refs.flatMap((r) => {
        const entry = inputs.get(r.input);
        return entry ? [{ entry, field: r.field }] : [];
      });
      const only = compiled.refs[0];
      edges.push({
        mapping: m.ref,
        namespace: m.namespace,
        from,
        to: { entry: target.entry, field },
        expression,
        table: target.table,
        copy:
          compiled.refs.length === 1 &&
          !!only &&
          expression.trim() === `${only.input}.${only.field}`,
      });
    }
  }
  return edges;
}

/**
 * Field-level lineage: every place a field's value comes from and goes to,
 * through the mappings of this repo and every repo it knows, with the tables
 * each step lands in. `ref` is entry.field, such as Refund.amount_cents or
 * payments.Refund.amount_cents.
 */
export function lineage(model: Model, ref: string): Lineage | undefined {
  const split = splitField(ref);
  if (!split) return undefined;
  const registry = new DataRegistry(model);
  const entry = registry.entry(split.entry);
  if (!entry) return undefined;
  const start: FieldId = { entry: entry.ref, field: split.field };
  const edges = lineageEdges(model);
  const key = (f: FieldId) => `${f.entry}.${f.field}`;

  const walk = (dir: "up" | "down"): LineageEdge[] => {
    const out: LineageEdge[] = [];
    const seen = new Set([key(start)]);
    const used = new Set<LineageEdge>();
    let frontier = [start];
    while (frontier.length) {
      const next: FieldId[] = [];
      for (const f of frontier) {
        for (const e of edges) {
          if (used.has(e)) continue;
          const hit = dir === "down" ? e.from.some((x) => key(x) === key(f)) : key(e.to) === key(f);
          if (!hit) continue;
          used.add(e);
          out.push(e);
          for (const g of dir === "down" ? [e.to] : e.from) {
            if (seen.has(key(g))) continue;
            seen.add(key(g));
            next.push(g);
          }
        }
      }
      frontier = next;
    }
    return out;
  };
  const upstream = walk("up");
  const downstream = walk("down");

  const stored = new Map<string, StoredIn[]>();
  const classifications = new Map<string, string>();
  for (const f of [
    start,
    ...upstream.flatMap((e) => [e.to, ...e.from]),
    ...downstream.flatMap((e) => [e.to, ...e.from]),
  ]) {
    if (!stored.has(f.entry)) stored.set(f.entry, registry.storedIn(f.entry));
    const c = registry.entry(f.entry)?.node.spec.fields?.[f.field]?.classification;
    if (c) classifications.set(key(f), c);
  }
  return { field: start, upstream, downstream, stored, classifications };
}
