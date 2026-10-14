import type { BranchSpec, JourneyStepSpec } from "@archdoc/spec";
import type { Model, Target } from "../model.js";
import { CelDouble, evaluate } from "./cel.js";
import { DataRegistry, type StoredIn } from "./registry.js";
import { parseChange, qualifyData, splitField } from "./resolve.js";
import { normalizeType } from "./schemas.js";

export type DataRecord = Record<string, unknown>;

/** What happened to a record at one step. */
export interface RecordEvent {
  kind: "sent" | "created" | "changed";
  /** Qualified entry, such as payments.Refund. */
  entry: string;
  /** The record after the step. */
  record: DataRecord;
  /** Fields that changed, for kind changed (and fields set, for created). */
  fields: { field: string; from?: unknown; to: unknown }[];
  /** Where the record lands. */
  tables: StoredIn[];
  /** The mapping that produced it. */
  via?: string | undefined;
}

export interface SimulatedDecision {
  /** The logic block, qualified. */
  logic: string;
  outcome?: string | undefined;
  /** 1-based rule that matched, or "else". */
  rule?: number | "else" | undefined;
  /** The condition that matched. */
  when?: string | undefined;
}

export interface SimulatedStep {
  /** 1-based. */
  step: number;
  from: string;
  to: string;
  action?: string | undefined;
  ran: boolean;
  /** Why it didn't run. */
  skipped?: string | undefined;
  decision?: SimulatedDecision | undefined;
  events: RecordEvent[];
  /** Another journey the path continues as. */
  next?: string | undefined;
  /** What couldn't be evaluated, such as a missing input. */
  problems: string[];
}

export interface Simulation {
  journey: string;
  steps: SimulatedStep[];
  /** Outcomes decided along the way, in order. */
  outcomes: string[];
  /** Every record at the end, by qualified entry. */
  records: Record<string, DataRecord>;
  /** The journey this one continues as, if a branch says so. */
  next?: string | undefined;
  /** The rows the sample starts with, by qualified entry; the first of each is the one the journey reads. */
  seed: Record<string, DataRecord[]>;
}

/**
 * Runs a journey against a sample, without running the system. At each
 * step: the record its mapping (`via`) produces (or updates, when one
 * exists), what it sends, the logic it decides with and the branch that
 * picks, then what it creates and changes, and which tables each record
 * lands in. What a branch creates is merged
 * into the record the step's mapping produced. The sample holds the records
 * that exist when the journey starts, keyed by data entry, such as
 * { "payments.RefundRequest": {...}, "payments.Charge": {...} }. An entry can
 * have a list of rows instead: the first is the one logic and mappings read,
 * and the rest are other rows already there, which `seed` passes on.
 * Deterministic: now() is a fixed time.
 */
export function simulate(
  model: Model,
  journeyId: string,
  sample: Record<string, unknown>,
): Simulation | undefined {
  const journey = model.journeys.get(journeyId);
  if (!journey) return undefined;
  const registry = new DataRegistry(model);
  const ns = model.namespace;
  const records = new Map<string, DataRecord>();
  const seed: Record<string, DataRecord[]> = {};
  for (const [key, value] of Object.entries(sample)) {
    // An entry's rows: one record, or a list whose first is the one the journey reads.
    const rows = (Array.isArray(value) ? value : [value]).filter(
      (r): r is DataRecord => !!r && typeof r === "object" && !Array.isArray(r),
    );
    const first = rows[0];
    if (!first) continue;
    const entry = qualifyData(key, ns);
    records.set(entry, { ...first });
    seed[entry] = rows.map((r) => ({ ...r }));
  }
  const outcomes: string[] = [];
  const steps: SimulatedStep[] = [];
  let next: string | undefined;
  const name = (t: Target | undefined, raw: string) =>
    t ? (t.type === "external" ? t.ref : t.id) : raw;
  const short = (entry: string) =>
    entry.startsWith(`${ns}.`) ? entry.slice(ns.length + 1) : entry;

  for (const s of journey.steps) {
    const spec = s.spec;
    const out: SimulatedStep = {
      step: s.index + 1,
      from: name(s.from, spec.from),
      to: name(s.to, spec.to),
      action: spec.action,
      ran: false,
      events: [],
      problems: [],
    };
    steps.push(out);
    if (next) {
      out.skipped = `the journey continues as ${next}`;
      continue;
    }
    if (spec.when && !outcomes.includes(spec.when)) {
      out.skipped = `runs only when ${spec.when}${outcomes.length ? `; the decision was ${outcomes.join(", ")}` : ""}`;
      continue;
    }
    out.ran = true;

    if (spec.via) {
      const mapping = registry.mapping(spec.via);
      const target = mapping && registry.target(mapping.node.spec.to, mapping.namespace);
      if (!mapping || !target) {
        out.problems.push(`${spec.via} isn't a mapping this repo knows (run archdoc sync?)`);
      } else {
        const context = bind(mapping.node.spec.from, mapping.namespace, out.problems);
        const record: DataRecord = {};
        for (const [field, expr] of Object.entries(mapping.node.spec.fields)) {
          const r = evaluate(expr, context);
          if (r.ok) record[field] = r.value;
          else out.problems.push(`${field} = ${expr}: ${r.error}`);
        }
        // Writing to the record that exists updates it, unless the mapping gives it another key.
        const key = keyOf(target.entry);
        const current = records.get(target.entry);
        const existing =
          current &&
          (record[key] === undefined ||
            current[key] === undefined ||
            String(current[key]) === String(record[key]))
            ? current
            : undefined;
        const merged = { ...(existing ?? {}), ...record };
        records.set(target.entry, merged);
        out.events.push({
          kind: existing ? "changed" : "created",
          entry: target.entry,
          record: { ...merged },
          fields: Object.entries(record)
            .filter(([field, to]) => !existing || existing[field] !== to)
            .map(([field, to]) =>
              existing ? { field, from: existing[field], to } : { field, to },
            ),
          tables: target.table ? [target.table] : registry.storedIn(target.entry),
          via: mapping.ref,
        });
      }
    }

    for (const data of [spec.sends ?? []].flat()) {
      const entry = qualifyData(data, ns);
      const record = records.get(entry);
      if (!record) out.problems.push(`no ${short(entry)} in the sample to send`);
      out.events.push({
        kind: "sent",
        entry,
        record: { ...(record ?? {}) },
        fields: [],
        tables: [],
      });
    }

    if (spec.decides) {
      const logic = registry.logic(spec.decides);
      if (!logic) {
        out.problems.push(
          `${spec.decides} isn't a logic block this repo knows (run archdoc sync?)`,
        );
      } else {
        const before = out.problems.length;
        const context = bind(logic.node.spec.input, logic.namespace, out.problems);
        const decision: SimulatedDecision = { logic: logic.ref };
        for (const [i, rule] of logic.node.spec.rules.entries()) {
          if ("else" in rule) {
            Object.assign(decision, { outcome: rule.else, rule: "else" });
            break;
          }
          const r = evaluate(rule.when, context);
          if (!r.ok) {
            out.problems.push(`rule ${i + 1} (${rule.when}): ${r.error}`);
            continue;
          }
          if (r.value === true) {
            Object.assign(decision, { outcome: rule.then, rule: i + 1, when: rule.when });
            break;
          }
        }
        out.decision = decision;
        if (decision.outcome) {
          outcomes.push(decision.outcome);
          const branch = spec.branches?.[decision.outcome];
          if (branch) apply(branch, out);
          if (branch?.next) next = out.next = branch.next;
        } else if (out.problems.length === before) {
          out.problems.push(`no rule of ${logic.ref} matched, and it has no else`);
        }
      }
    }

    apply(spec, out);
  }

  return {
    journey: journey.id,
    steps,
    outcomes,
    records: Object.fromEntries(records),
    seed,
    ...(next ? { next } : {}),
  };

  /** Records for a block's named inputs. */
  function bind(
    inputs: Record<string, string>,
    at: string,
    problems: string[],
  ): Record<string, unknown> {
    const context: Record<string, unknown> = {};
    for (const [alias, ref] of Object.entries(inputs)) {
      const entry = qualifyData(ref, at);
      const record = records.get(entry);
      if (record) context[alias] = typed(entry, record);
      else problems.push(`no ${short(entry)} to read as ${alias}; add it to the sample`);
    }
    return context;
  }

  /** The field an entry's records are keyed by: its datastore's key, or id. */
  function keyOf(entry: string): string {
    const at = registry.storedIn(entry)[0];
    if (!at) return "id";
    return (
      registry.models.get(at.namespace)?.elements.get(at.element)?.spec.stores?.[at.table]?.key ??
      "id"
    );
  }

  /** A record with its `number` fields kept as doubles, so 300 * 24.5 works in CEL. */
  function typed(entry: string, record: DataRecord): Record<string, unknown> {
    const fields = registry.entry(entry)?.node.spec.fields ?? {};
    return Object.fromEntries(
      Object.entries(record).map(([k, v]) => [
        k,
        typeof v === "number" && fields[k]?.type && normalizeType(fields[k].type) === "number"
          ? new CelDouble(v)
          : v,
      ]),
    );
  }

  /** What a step or branch creates and changes. */
  function apply(
    spec: Pick<JourneyStepSpec | BranchSpec, "creates" | "changes">,
    out: SimulatedStep,
  ) {
    const creates = spec.creates;
    const created =
      creates === undefined
        ? []
        : typeof creates === "string" || Array.isArray(creates)
          ? [creates].flat().map((n) => [n, {}] as const)
          : Object.entries(creates);
    for (const [name, values] of created) {
      const entry = qualifyData(name, ns);
      // A record this step's mapping just wrote gets these values too.
      const existing = out.events.find(
        (e) => e.entry === entry && (e.kind === "created" || e.via !== undefined),
      );
      const record = { ...(existing ? records.get(entry) : {}), ...values };
      records.set(entry, record);
      if (existing) {
        existing.record = { ...record };
        for (const [field, to] of Object.entries(values)) existing.fields.push({ field, to });
        continue;
      }
      out.events.push({
        kind: "created",
        entry,
        record: { ...record },
        fields: Object.entries(values).map(([field, to]) => ({ field, to })),
        tables: registry.storedIn(entry),
      });
    }
    for (const [key, value] of Object.entries(spec.changes ?? {})) {
      const split = splitField(key);
      const change = parseChange(value);
      if (!split || !change) continue;
      const entry = qualifyData(split.entry, ns);
      const record = records.get(entry);
      if (!record) {
        out.problems.push(`no ${short(entry)} to change; add it to the sample`);
        continue;
      }
      const before = record[split.field];
      if (before !== undefined && String(before) !== change.from) {
        out.problems.push(
          `${short(entry)}.${split.field} is ${String(before)}, not ${change.from}`,
        );
      }
      record[split.field] = change.to;
      const event = out.events.find((e) => e.kind === "changed" && e.entry === entry);
      const field = { field: split.field, from: before ?? change.from, to: change.to };
      if (event) {
        event.fields.push(field);
        event.record = { ...record };
      } else {
        out.events.push({
          kind: "changed",
          entry,
          record: { ...record },
          fields: [field],
          tables: registry.storedIn(entry),
        });
      }
    }
  }
}
