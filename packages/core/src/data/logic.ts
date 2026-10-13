import type { Diagnostic, SourceLocation } from "../diagnostics.js";
import type { Model } from "../model.js";
import { compile } from "./cel.js";
import { DataRegistry } from "./registry.js";
import { isImportedData, resolveData } from "./resolve.js";

/** Outcomes a logic block can decide: each rule's `then`, and its `else`. */
export function outcomesOf(rules: readonly ({ then: string } | { else: string })[]): string[] {
  return [...new Set(rules.map((r) => ("then" in r ? r.then : r.else)))];
}

/**
 * Checks mappings, logic blocks, and the journey steps that use them: inputs
 * and targets that don't resolve, expressions that don't parse or read
 * fields that don't exist, rules after an `else`, decisions without a
 * default, and branches, `when`, and `via` that name nothing. "local" checks
 * what this model alone can answer; "imported" what needs a synced import.
 */
export function checkLogic(model: Model, scope: "local" | "imported"): Diagnostic[] {
  const out: Diagnostic[] = [];
  const registry = new DataRegistry(model);
  const imported = (ref: string) => isImportedData(model, ref);
  const mine = (isImported: boolean) => (scope === "imported") === isImported;
  const err = (code: string, message: string, location: SourceLocation | undefined) =>
    out.push({ severity: "error", code, message, location });

  /** Resolves named inputs; returns each input's entry when it's this scope's to check. */
  const inputs = (
    label: string,
    from: Record<string, string>,
    location: SourceLocation | undefined,
  ) => {
    const entries = new Map<string, ReturnType<typeof resolveData>>();
    for (const [alias, ref] of Object.entries(from)) {
      const r = resolveData(model, ref);
      entries.set(alias, r);
      if (!mine(imported(ref)) || r.status !== "missing") continue;
      err(
        r.local ? "ref/unresolved-data" : "ref/unknown-in-import",
        `${label} reads ${alias} as "${ref}", which ${r.local ? "is not defined under data" : `${r.namespace} doesn't have`}.${r.hint ? ` ${r.hint}` : ""}`,
        location,
      );
    }
    return entries;
  };

  /** Parses an expression and checks the fields it reads. */
  const expression = (
    label: string,
    expr: string,
    entries: Map<string, ReturnType<typeof resolveData>>,
    location: SourceLocation | undefined,
  ) => {
    const compiled = compile(expr, new Set(entries.keys()));
    if (!compiled.ok) {
      if (scope === "local")
        err(
          "logic/invalid-expression",
          `${label}: "${expr}" isn't valid CEL: ${compiled.error}`,
          location,
        );
      return;
    }
    if (scope === "local" && compiled.unknownInputs.length) {
      err(
        "logic/unknown-input",
        `${label}: "${expr}" reads ${compiled.unknownInputs.join(", ")}, which ${compiled.unknownInputs.length === 1 ? "isn't an input" : "aren't inputs"}. Its inputs are ${[...entries.keys()].join(", ") || "none"}.`,
        location,
      );
    }
    for (const ref of compiled.refs) {
      const r = entries.get(ref.input);
      if (r?.status !== "found" || !mine(!r.local)) continue;
      const fields = r.node.spec.fields;
      if (fields && !fields[ref.field]) {
        err(
          "data/unknown-field",
          `${label}: "${expr}" reads ${ref.input}.${ref.field}, but ${r.node.id} has no field "${ref.field}".`,
          location,
        );
      }
    }
  };

  for (const m of model.mappings.values()) {
    const label = `Mapping "${m.id}"`;
    const entries = inputs(label, m.spec.from, m.location);
    const target = registry.target(m.spec.to, model.namespace);
    const toImported = imported(m.spec.to);
    if (!target) {
      if (mine(toImported) && (!toImported || registry.models.has(m.spec.to.split(".")[0] ?? ""))) {
        err(
          "logic/unknown-target",
          `${label} writes to "${m.spec.to}", which is neither a data entry nor a datastore table (element.table) that stores one.`,
          m.location,
        );
      }
    } else {
      const entry = registry.entry(target.entry);
      const targetImported = !target.entry.startsWith(`${model.namespace}.`);
      const fields = entry?.node.spec.fields;
      if (fields && mine(targetImported)) {
        for (const f of Object.keys(m.spec.fields)) {
          if (!fields[f])
            err(
              "data/unknown-field",
              `${label} writes ${f}, but ${entry?.node.id} has no field "${f}".`,
              m.location,
            );
        }
      }
    }
    for (const [field, expr] of Object.entries(m.spec.fields)) {
      expression(`${label}, field ${field}`, expr, entries, m.location);
    }
  }

  for (const l of model.logic.values()) {
    const label = `Logic "${l.id}"`;
    const entries = inputs(label, l.spec.input, l.location);
    const runsIn = l.spec["runs-in"];
    if (
      runsIn &&
      scope === "local" &&
      !imported(runsIn) &&
      !model.elements.has(runsIn.replace(`${model.namespace}.`, ""))
    ) {
      err("ref/unresolved", `${label} runs in "${runsIn}", which isn't an element.`, l.location);
    }
    if (runsIn && scope === "imported" && imported(runsIn)) {
      const ns = runsIn.slice(0, runsIn.indexOf("."));
      const dep = model.imported?.get(ns);
      if (dep && !dep.model.elements.has(runsIn.slice(ns.length + 1))) {
        err(
          "ref/unknown-in-import",
          `${label} runs in ${runsIn}, which ${ns}@${dep.version ?? "?"} doesn't have.`,
          l.location,
        );
      }
    }
    for (const [i, rule] of l.spec.rules.entries()) {
      if ("when" in rule) expression(`${label}, rule ${i + 1}`, rule.when, entries, l.location);
      if (scope === "local" && "else" in rule && i < l.spec.rules.length - 1) {
        err(
          "logic/unreachable",
          `${label}: rule ${i + 2} comes after "else", so it never runs. Move else last.`,
          l.location,
        );
      }
    }
    if (scope === "local" && !l.spec.rules.some((r) => "else" in r)) {
      out.push({
        severity: "warning",
        code: "logic/no-default",
        message: `${label} has no else, so a request no rule matches gets no outcome. Add else: <outcome>.`,
        location: l.location,
      });
    }
  }

  for (const j of model.journeys.values()) {
    const decided = new Set<string>();
    // Outcomes of logic in another repo are known once it's synced, so `when` is checked then.
    let unresolved = false;
    let usesImported = false;
    for (const s of j.steps) {
      const label = `Journey "${j.id}", step ${s.index + 1}`;
      if (s.spec.when && !unresolved && mine(usesImported) && !decided.has(s.spec.when)) {
        err(
          "journey/unknown-outcome",
          `${label} runs when "${s.spec.when}", but no earlier step decides it.${decided.size ? ` Earlier outcomes: ${[...decided].join(", ")}.` : ""}`,
          s.location,
        );
      }
      if (s.spec.decides) {
        const ref = s.spec.decides;
        const logic = registry.logic(ref);
        const isImp = imported(ref);
        usesImported ||= isImp;
        if (!logic) unresolved = true;
        if (!logic) {
          if (mine(isImp) && (!isImp || registry.models.has(ref.split(".")[0] ?? ""))) {
            err(
              "journey/unknown-logic",
              `${label} decides with "${ref}", which isn't a logic block.`,
              s.location,
            );
          }
        } else {
          const outcomes = outcomesOf(logic.node.spec.rules);
          for (const o of outcomes) decided.add(o);
          if (mine(isImp)) {
            for (const b of Object.keys(s.spec.branches ?? {})) {
              if (!outcomes.includes(b)) {
                err(
                  "journey/unknown-branch",
                  `${label} has a branch "${b}", which ${ref} never decides. Its outcomes: ${outcomes.join(", ")}.`,
                  s.location,
                );
              }
            }
          }
        }
      } else if (s.spec.branches && scope === "local") {
        err(
          "journey/unknown-branch",
          `${label} has branches but no decides. Name the logic block that picks one.`,
          s.location,
        );
      }
      if (s.spec.via) {
        const ref = s.spec.via;
        const isImp = imported(ref);
        if (
          !registry.mapping(ref) &&
          mine(isImp) &&
          (!isImp || registry.models.has(ref.split(".")[0] ?? ""))
        ) {
          err(
            "journey/unknown-mapping",
            `${label} writes via "${ref}", which isn't a mapping.`,
            s.location,
          );
        }
      }
    }
  }
  return out;
}
