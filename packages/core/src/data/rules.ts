import type { RuleSpec } from "@archdoc/spec";
import { selectorMatcher } from "../check/rules.js";
import type { SourceLocation } from "../diagnostics.js";
import { type Model, nodeKey, type Target } from "../model.js";
import { type DataFlow, dataFlows, dataStores } from "./flows.js";
import { classifiedFields, resolveData } from "./resolve.js";

export interface DataRuleViolation {
  rule: RuleSpec;
  /** "stored-in" or "not-sent-to". */
  clause: string;
  message: string;
  /** The element the violation is about. */
  element?: string | undefined;
  location?: SourceLocation | undefined;
}

/**
 * Evaluates data rules: data with a classification stored outside where the
 * rule allows (`stored-in`), or sent somewhere it may never go
 * (`not-sent-to`). Classifications come from the entries' fields, including
 * entries in synced imports.
 */
export function evaluateDataRules(
  model: Model,
  rules: readonly RuleSpec[] = model.rules,
  onUnknown: (rule: string, selector: string) => void = () => {},
): DataRuleViolation[] {
  const matcher = selectorMatcher(model, onUnknown);
  const out: DataRuleViolation[] = [];
  const flows = rules.some((r) => r.data?.["not-sent-to"] !== undefined) ? dataFlows(model) : [];
  const stores = dataStores(model);

  /** The entry's fields with one of these classifications. */
  const classified = (data: string, classes: readonly string[]) => {
    const r = resolveData(model, data);
    if (r.status !== "found") return [];
    return classifiedFields(r.node).filter((f) => classes.includes(f.classification));
  };
  const fieldList = (fields: { field: string; classification: string }[]) =>
    fields.map((f) => `${f.field} (${f.classification})`).join(", ");

  for (const rule of rules) {
    const clause = rule.data;
    if (!clause) continue;
    const classes = [clause.classification].flat();
    const tail = `which breaks rule "${rule.id}"${rule.description ? `: ${rule.description}` : "."}`;

    if (clause["stored-in"] !== undefined) {
      const allowed = matcher(rule, clause["stored-in"]);
      for (const s of stores) {
        const fields = classified(s.data, classes);
        if (!fields.length || allowed(`element:${s.element}`)) continue;
        out.push({
          rule,
          clause: "stored-in",
          element: s.element,
          location: s.location,
          message: `${s.element} stores ${s.data} (${fieldList(fields)}) in ${s.table}, ${tail}`,
        });
      }
    }

    if (clause["not-sent-to"] !== undefined) {
      const denied = matcher(rule, clause["not-sent-to"]);
      const seen = new Set<string>();
      for (const f of flows) {
        const fields = classified(f.data, classes);
        if (!fields.length || !denied(nodeKey(f.to))) continue;
        const key = `${nodeKey(f.from)}>${nodeKey(f.to)}>${f.data}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          rule,
          clause: "not-sent-to",
          element: f.from.type === "element" ? f.from.id : undefined,
          location: f.location,
          message: `${describeFlow(f)} sends ${f.data} (${fieldList(fields)}) to ${name(f.to)}, ${tail}`,
        });
      }
    }
  }
  return out;
}

/** Who sends it, and how, for a message: "rides.app" or "Journey "x", step 2: rides.app". */
export function describeFlow(f: DataFlow): string {
  const from = name(f.from);
  if (f.how === "step") return `Journey "${f.journey}", step ${f.step}: ${from}`;
  if (f.how === "sends") return from;
  return `${from} (through ${f.via})`;
}

function name(t: Target): string {
  return t.type === "external" ? t.ref : t.id;
}
