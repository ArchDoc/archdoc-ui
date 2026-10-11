import type { Diagnostic, SourceLocation } from "../diagnostics.js";
import type { Model, Target } from "../model.js";
import {
  type DataResolution,
  findContract,
  isImportedData,
  namespaceOf,
  parseChange,
  parseStates,
  providesOf,
  qualifyData,
  resolveData,
  splitField,
} from "./resolve.js";

/**
 * Checks the model's data: references to data entries, lifecycles, fields
 * that steps change or create, and data sent to an element that doesn't
 * accept it. "local" checks what this model alone can answer; "imported"
 * checks what needs another repo's model, once it's synced. Each problem is
 * reported by exactly one of them.
 */
export function checkData(model: Model, scope: "local" | "imported"): Diagnostic[] {
  const out: Diagnostic[] = [];
  const mine = (imported: boolean) => (scope === "imported") === imported;
  const short = (t: Target) => (t.type === "external" ? t.ref : t.id);

  /** Resolves a reference in this scope, reporting it when it's missing. */
  const ref = (
    data: string,
    subject: string,
    location: SourceLocation | undefined,
  ): Extract<DataResolution, { status: "found" }> | undefined => {
    if (!mine(isImportedData(model, data))) return undefined;
    const r = resolveData(model, data);
    if (r.status === "found") return r;
    if (r.status === "not-synced") return undefined;
    if (r.local) {
      out.push({
        severity: "warning",
        code: "ref/unresolved-data",
        message: `${subject} "${data}", which is not defined under data.${r.hint ? ` ${r.hint}` : ""}`,
        location,
      });
    } else {
      const dep = model.imported?.get(r.namespace);
      out.push({
        severity: "error",
        code: "ref/unknown-in-import",
        message: `${subject} ${data}, which ${r.namespace}@${dep?.version ?? "?"} doesn't have.${r.hint ? ` ${r.hint}` : ""}`,
        location,
      });
    }
    return undefined;
  };

  for (const rel of model.relationships) {
    for (const data of rel.sends) ref(data, `${rel.from.id} → ${rel.ref} sends`, rel.location);
  }
  for (const e of model.elements.values()) {
    for (const p of e.spec.provides ?? []) {
      const name = "api" in p ? p.api : "topic" in p ? p.topic : p.event;
      for (const key of ["accepts", "returns", "carries"] as const) {
        for (const data of [p[key] ?? []].flat()) {
          ref(data, `${e.id} provides ${name}, which ${key}`, e.location);
        }
      }
    }
    for (const [table, s] of Object.entries(e.spec.stores ?? {})) {
      ref(s.entity, `${e.id} stores ${table} as`, e.location);
    }
  }

  if (scope === "local") {
    for (const d of model.data.values()) {
      const { invalid } = parseStates(d.spec.states ?? []);
      for (const line of invalid) {
        out.push({
          severity: "error",
          code: "data/invalid-states",
          message: `${d.id} has the state line "${line}", which isn't "a -> b" (or "a -> b | c").`,
          location: d.location,
        });
      }
    }
  }

  for (const j of model.journeys.values()) {
    for (const s of j.steps) {
      const label = `Journey "${j.id}", step ${s.index + 1}`;
      for (const data of [s.spec.sends ?? []].flat()) ref(data, `${label} sends`, s.location);

      const creates = s.spec.creates;
      const created =
        creates === undefined
          ? []
          : typeof creates === "string" || Array.isArray(creates)
            ? [creates].flat().map((name) => [name, {}] as const)
            : Object.entries(creates);
      for (const [name, values] of created) {
        const entry = ref(name, `${label} creates`, s.location);
        if (!entry) continue;
        for (const [field, value] of Object.entries(values)) {
          const problem = fieldProblem(entry, field, value === null ? undefined : String(value));
          if (problem)
            out.push({
              ...problem,
              message: `${label} creates ${name}: ${problem.message}`,
              location: s.location,
            });
        }
      }

      for (const [key, value] of Object.entries(s.spec.changes ?? {})) {
        const split = splitField(key);
        if (!split) {
          if (scope === "local")
            out.push({
              severity: "error",
              code: "data/invalid-change",
              message: `${label} changes "${key}". Name the entry and the field, such as Charge.status.`,
              location: s.location,
            });
          continue;
        }
        const entry = ref(split.entry, `${label} changes`, s.location);
        if (!entry) continue;
        const change = parseChange(value);
        if (!change) {
          out.push({
            severity: "error",
            code: "data/invalid-change",
            message: `${label} changes ${key} to "${value}". Write it as "before -> after".`,
            location: s.location,
          });
          continue;
        }
        const problem =
          fieldProblem(entry, split.field, change.from) ??
          fieldProblem(entry, split.field, change.to);
        if (problem) {
          out.push({
            ...problem,
            message: `${label} changes ${key}: ${problem.message}`,
            location: s.location,
          });
          continue;
        }
        const life = parseStates(entry.node.spec.states ?? []);
        if (!life.states.has(change.from) && !life.states.has(change.to)) continue;
        if (life.next.get(change.from)?.has(change.to)) continue;
        const allowed = [...(life.next.get(change.from) ?? [])];
        out.push({
          severity: "error",
          code: "data/invalid-transition",
          message: `${label} changes ${key} from ${change.from} to ${change.to}, which ${entry.node.id}'s states don't allow.${allowed.length ? ` From ${change.from} it can go to ${allowed.join(", ")}.` : life.states.has(change.from) ? ` ${change.from} is a final state.` : ` ${change.from} isn't one of its states.`}`,
          location: s.location,
        });
      }

      // Data sent to an element that declares what it accepts.
      if (!s.from || !s.to || s.spec.sends === undefined) continue;
      for (const data of [s.spec.sends].flat()) {
        const problem = notAccepted(data, s.from, s.to, undefined, true);
        if (problem)
          out.push({
            severity: "error",
            code: "data/not-accepted",
            message: `${label}: ${short(s.from)} → ${short(s.to)} sends ${data}, ${problem}`,
            location: s.location,
          });
      }
    }
  }

  for (const rel of model.relationships) {
    for (const data of rel.sends) {
      const problem = notAccepted(data, rel.from, rel.to, rel.via, false);
      if (problem)
        out.push({
          severity: "error",
          code: "data/not-accepted",
          message: `${rel.from.id} → ${rel.ref} sends ${data}, ${problem}`,
          location: rel.location,
        });
    }
  }
  return out;

  /**
   * Why the target doesn't accept the data, if it declares what it accepts.
   * A step may also carry what the sender publishes or returns.
   */
  function notAccepted(
    data: string,
    from: Target,
    to: Target,
    via: string | undefined,
    step: boolean,
  ): string | undefined {
    if (to.type === "actor" || !mine(to.type === "external")) return undefined;
    const provides = providesOf(model, to);
    if (!provides) return undefined;
    const ns = namespaceOf(model, to);
    const q = (list: string | string[] | undefined, at: string) =>
      [list ?? []].flat().map((d) => qualifyData(d, at));
    const contract = findContract(provides, via);
    if (contract && ("topic" in contract || "event" in contract)) return undefined;
    const accepted = contract
      ? q(contract.accepts, ns)
      : provides.flatMap((p) => ("api" in p ? q(p.accepts, ns) : []));
    if (accepted.length === 0) return undefined;
    // Data that doesn't resolve is reported as such.
    if (resolveData(model, data).status === "missing") return undefined;
    const sent = qualifyData(data, model.namespace);
    if (accepted.includes(sent)) return undefined;
    if (step) {
      const fromNs = from.type === "actor" ? model.namespace : namespaceOf(model, from);
      const out = (providesOf(model, from) ?? []).flatMap((p) => [
        ...q(p.carries, fromNs),
        ...q(p.returns, fromNs),
      ]);
      if (out.includes(sent)) return undefined;
    }
    const name = to.type === "external" ? to.ref : to.id;
    const strip = (d: string) =>
      d.startsWith(`${model.namespace}.`) ? d.slice(model.namespace.length + 1) : d;
    return `which ${name} doesn't accept${contract ? ` through ${via}` : ""}. It accepts: ${accepted.map(strip).join(", ")}.`;
  }
}

/** A field that the entry doesn't have, or a value its enum doesn't allow. */
function fieldProblem(
  entry: Extract<DataResolution, { status: "found" }>,
  field: string,
  value: string | undefined,
): Omit<Diagnostic, "location"> | undefined {
  const fields = entry.node.spec.fields;
  if (!fields) return undefined;
  const spec = fields[field];
  if (!spec) {
    return {
      severity: "error",
      code: "data/unknown-field",
      message: `${entry.node.id} has no field "${field}".`,
    };
  }
  if (value !== undefined && spec.values && !spec.values.map(String).includes(value)) {
    return {
      severity: "error",
      code: "data/invalid-value",
      message: `"${value}" isn't one of ${field}'s values: ${spec.values.join(", ")}.`,
    };
  }
  return undefined;
}
