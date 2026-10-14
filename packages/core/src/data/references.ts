import type { Diagnostic } from "../diagnostics.js";
import type { Model } from "../model.js";
import { DataRegistry } from "./registry.js";
import { isImportedData, qualifyData, splitField } from "./resolve.js";
import { normalizeType } from "./schemas.js";

/** One field pointing at another entry's field, like a foreign key. */
export interface FieldReference {
  /** Qualified entry, such as payments.Refund. */
  entry: string;
  field: string;
  to: { entry: string; field: string };
  /** references: written on the field; type: the field's type names the entry. */
  how: "references" | "type";
}

const SCALARS = new Set([
  "int",
  "number",
  "string",
  "bool",
  "uuid",
  "timestamp",
  "date",
  "json",
  "bytes",
  "enum",
]);

/**
 * Where a field points: Entry.field, or Entry for its key. The whole
 * reference is tried as an entry first, so payments.Charge is the entry, not
 * field Charge of an entry payments.
 */
export function resolveReference(
  registry: DataRegistry,
  ref: string,
  ns: string,
): { entry: string; field: string } | { problem: string } {
  const whole = registry.entry(ref, ns);
  if (whole) return { entry: whole.ref, field: keyOf(registry, whole.ref) };
  const split = splitField(ref);
  const entry = split && registry.entry(split.entry, ns);
  if (!split || !entry) return { problem: `"${ref}", which isn't a data entry or Entry.field` };
  if (!entry.node.spec.fields?.[split.field]) {
    return { problem: `${ref}, but ${split.entry} has no field ${split.field}` };
  }
  return { entry: entry.ref, field: split.field };
}

/** An entry's key: the key a datastore stores it by, or id. */
function keyOf(registry: DataRegistry, entry: string): string {
  const stored = registry.storedIn(entry)[0];
  const key = stored
    ? registry.models.get(stored.namespace)?.elements.get(stored.element)?.spec.stores?.[
        stored.table
      ]?.key
    : undefined;
  return key ?? "id";
}

/** The references between this model's entries' fields: written, or read from a type that names an entry. */
export function fieldReferences(
  model: Model,
  registry = new DataRegistry(model),
): FieldReference[] {
  const out: FieldReference[] = [];
  for (const [ns, m] of registry.models) {
    for (const d of m.data.values()) {
      for (const [name, f] of Object.entries(d.spec.fields ?? {})) {
        const to = targetOf(registry, f.references, f.type, ns);
        if (to && !("problem" in to)) {
          out.push({
            entry: `${ns}.${d.id}`,
            field: name,
            to,
            how: f.references ? "references" : "type",
          });
        }
      }
    }
  }
  return out;
}

function targetOf(
  registry: DataRegistry,
  references: string | undefined,
  type: string | undefined,
  ns: string,
) {
  if (references) return resolveReference(registry, references, ns);
  if (!type) return undefined;
  const t = type.replace(/\[\]$/, "");
  if (SCALARS.has(normalizeType(t))) return undefined;
  const entry = registry.entry(t, ns);
  return entry ? { entry: entry.ref, field: keyOf(registry, entry.ref) } : undefined;
}

/**
 * References that don't resolve. "local" checks the ones within this model;
 * "imported", the ones into another repo, once it's synced.
 */
export function checkReferences(model: Model, scope: "local" | "imported"): Diagnostic[] {
  const registry = new DataRegistry(model);
  const out: Diagnostic[] = [];
  for (const d of model.data.values()) {
    for (const [name, f] of Object.entries(d.spec.fields ?? {})) {
      if (!f.references) continue;
      const imported = isImportedData(model, f.references);
      if (imported !== (scope === "imported")) continue;
      // Into another repo that isn't synced yet: nothing to check against.
      if (imported && !registry.models.has(f.references.slice(0, f.references.indexOf("."))))
        continue;
      const r = resolveReference(registry, f.references, model.namespace);
      if ("problem" in r) {
        out.push({
          severity: "warning",
          code: "data/unknown-reference",
          message: `${d.id}.${name} references ${r.problem}.`,
          location: d.location,
        });
      }
    }
  }
  return out;
}

/** The reference an imported foreign key names (a table or type, and a column) as a model reference. */
export function referenceFromSchema(
  model: Model,
  target: { name: string; field?: string | undefined },
): string | undefined {
  const name = target.name.toLowerCase();
  // An entry whose source names the type or table, or that a datastore stores in a table by that name.
  const bySource = [...model.data.values()].find((d) =>
    Object.values(d.spec.source ?? {}).some((ref) => {
      const hash = ref.indexOf("#");
      return hash >= 0 && ref.slice(hash + 1).toLowerCase() === name;
    }),
  );
  const byTable = [...model.elements.values()]
    .flatMap((e) => Object.entries(e.spec.stores ?? {}))
    .find(([table]) => table.toLowerCase() === name)?.[1].entity;
  const entry = bySource?.id ?? (byTable ? qualifyData(byTable, model.namespace) : undefined);
  if (!entry) return undefined;
  const short = entry.startsWith(`${model.namespace}.`)
    ? entry.slice(model.namespace.length + 1)
    : entry;
  return target.field ? `${short}.${target.field}` : short;
}
