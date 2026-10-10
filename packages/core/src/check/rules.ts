import type { RuleSpec } from "@archdoc/spec";
import { Resolver } from "../load/resolve.js";
import type { Model } from "../model.js";

/** One side of a rule: an ID (with everything inside it), a list, or element properties. */
type Selector = string | Selector[] | { kind?: string; tag?: string; id?: string };

export interface RuleEdge {
  /** Node keys, such as element:toolchain.cli or actor:developer. */
  from: string;
  to: string;
  /** "declared" for the model, or the analyzer that observed it. */
  source: string;
  evidence: string[];
  files: string[];
}

export interface RuleViolation {
  rule: RuleSpec;
  edge: RuleEdge;
  /** "deny" or "allow-only". */
  clause: string;
}

/**
 * Evaluates `deny` and `allow-only` rules against relationships, declared or
 * observed. Other rule kinds (data, require-review) arrive with later phases
 * and are reported as not evaluated.
 */
export function evaluateRules(
  model: Model,
  edges: RuleEdge[],
  rules: readonly RuleSpec[] = model.rules,
  /** Rules whose selectors may name things outside this model, such as org rules: unknown ones are skipped quietly. */
  quiet: ReadonlySet<string> = new Set(),
): {
  violations: RuleViolation[];
  unknownSelectors: { rule: string; selector: string }[];
  skipped: string[];
} {
  const resolver = new Resolver(
    model.namespace,
    new Set(Object.keys(model.imports)),
    new Set(model.elements.keys()),
    new Set(model.actors.keys()),
  );
  const unknownSelectors: { rule: string; selector: string }[] = [];
  const violations: RuleViolation[] = [];
  const skipped: string[] = [];

  /** Returns which selector entry a node falls under (its root), or undefined. */
  const matcher = (rule: RuleSpec, sel: unknown): ((key: string) => string | undefined) => {
    if (Array.isArray(sel)) {
      const parts = sel.map((s) => matcher(rule, s));
      return (k) => {
        for (const p of parts) {
          const root = p(k);
          if (root) return root;
        }
        return undefined;
      };
    }
    if (typeof sel === "string") {
      const r = resolver.endpoint(sel);
      if (r.status !== "resolved") {
        if (!quiet.has(rule.id)) unknownSelectors.push({ rule: rule.id, selector: sel });
        return () => undefined;
      }
      const key = `${r.target.type}:${r.target.id}`;
      return (k) =>
        k === key || (r.target.type === "element" && k.startsWith(`element:${r.target.id}.`))
          ? key
          : undefined;
    }
    if (sel && typeof sel === "object") {
      const s = sel as { kind?: string; tag?: string; id?: string };
      if (s.id) return matcher(rule, s.id);
      return (k) => {
        if (!k.startsWith("element:")) return undefined;
        const e = model.elements.get(k.slice(8));
        if (!e) return undefined;
        const ok =
          (!s.kind || e.spec.kind === s.kind) && (!s.tag || (e.spec.tags ?? []).includes(s.tag));
        return ok ? k : undefined;
      };
    }
    return () => undefined;
  };

  for (const rule of rules) {
    const deny = rule.deny as { from?: Selector; to?: Selector } | undefined;
    const allowOnly = rule["allow-only"] as { from?: Selector; to?: Selector } | undefined;
    if (!deny && !allowOnly) {
      skipped.push(rule.id);
      continue;
    }
    if (deny) {
      const from = matcher(rule, deny.from ?? []);
      const to = matcher(rule, deny.to ?? []);
      for (const e of edges) {
        const a = from(e.from);
        const b = to(e.to);
        // Parts of the same element may depend on each other.
        if (a && b && a !== b) violations.push({ rule, edge: e, clause: "deny" });
      }
    }
    if (allowOnly) {
      const to = matcher(rule, allowOnly.to ?? []);
      const from = matcher(rule, allowOnly.from ?? []);
      for (const e of edges) {
        // The target's own parts may use it freely.
        if (to(e.to) && !from(e.from) && !to(e.from))
          violations.push({ rule, edge: e, clause: "allow-only" });
      }
    }
  }
  return { violations, unknownSelectors, skipped };
}
