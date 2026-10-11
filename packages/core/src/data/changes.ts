import type { Model, Target } from "../model.js";
import { nodeKey } from "../model.js";
import { type DataFlow, dataFlows, dataStores } from "./flows.js";
import { classifiedFields, elementOf, qualifyData, resolveData } from "./resolve.js";

/** Classifications that don't need a reviewer's attention when they move. */
const ROUTINE = new Set(["public", "internal"]);

export interface SensitiveField {
  field: string;
  classification: string;
}

/** Sensitive data that goes somewhere it didn't before. */
export interface NewSensitiveFlow {
  flow: DataFlow;
  /** The sensitive fields that are new on this path. */
  fields: SensitiveField[];
  /** The target is an external element (here or in another repo). */
  external: boolean;
}

/** Sensitive data stored somewhere it wasn't before. */
export interface NewSensitiveStore {
  element: string;
  table: string;
  data: string;
  fields: SensitiveField[];
}

/**
 * Where a change starts sending or storing sensitive data (any classification
 * but public and internal): a new flow or store of a classified entry, or a
 * field newly classified on one that already existed. For the PR report.
 */
export function sensitiveDataChanges(
  baseModel: Model,
  head: Model,
): { flows: NewSensitiveFlow[]; stores: NewSensitiveStore[] } {
  // A base read from git isn't synced: read other repos' data from the head's imports.
  const base: Model = baseModel.imported ? baseModel : { ...baseModel, imported: head.imported };
  const sensitive = (model: Model, data: string): SensitiveField[] => {
    const r = resolveData(model, data);
    if (r.status !== "found") return [];
    return classifiedFields(r.node)
      .filter((f) => !ROUTINE.has(f.classification))
      .map(({ field, classification }) => ({ field, classification }));
  };
  const flowKey = (m: Model, f: DataFlow) =>
    `${nodeKey(f.from)}>${nodeKey(f.to)}>${qualifyData(f.data, m.namespace)}`;
  const fieldKey = (f: SensitiveField) => `${f.field}:${f.classification}`;

  const before = new Map<string, Set<string>>();
  for (const f of dataFlows(base)) {
    const set = before.get(flowKey(base, f)) ?? new Set<string>();
    for (const s of sensitive(base, f.data)) set.add(fieldKey(s));
    before.set(flowKey(base, f), set);
  }
  const flows: NewSensitiveFlow[] = [];
  const seen = new Set<string>();
  for (const f of dataFlows(head)) {
    const key = flowKey(head, f);
    if (seen.has(key)) continue;
    const had = before.get(key) ?? new Set<string>();
    const fields = sensitive(head, f.data).filter((s) => !had.has(fieldKey(s)));
    if (!fields.length) continue;
    seen.add(key);
    flows.push({ flow: f, fields, external: isExternal(head, f.to) });
  }

  const stored = new Map<string, Set<string>>();
  for (const s of dataStores(base)) {
    stored.set(`${s.element}>${s.table}`, new Set(sensitive(base, s.data).map(fieldKey)));
  }
  const stores: NewSensitiveStore[] = [];
  for (const s of dataStores(head)) {
    const had = stored.get(`${s.element}>${s.table}`) ?? new Set<string>();
    const fields = sensitive(head, s.data).filter((f) => !had.has(fieldKey(f)));
    if (fields.length) stores.push({ element: s.element, table: s.table, data: s.data, fields });
  }
  // Sensitive data leaving for an external element comes first.
  flows.sort((a, b) => Number(b.external) - Number(a.external));
  return { flows, stores };
}

function isExternal(model: Model, t: Target): boolean {
  return elementOf(model, t)?.spec.kind === "external";
}
