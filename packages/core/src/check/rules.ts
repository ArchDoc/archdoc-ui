import type { RuleSpec } from "@archdoc/spec";
import { Resolver } from "../load/resolve.js";
import type { Model } from "../model.js";

/** One side of a rule: an ID (with everything inside it), a list, element properties, or a namespace. */
type Selector =
  | string
  | Selector[]
  | { kind?: string; tag?: string; id?: string; namespace?: string };

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
 * observed. Data rules run in evaluateDataRules; other kinds (require-review)
 * arrive later and are reported as not evaluated.
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
  const unknownSelectors: { rule: string; selector: string }[] = [];
  const violations: RuleViolation[] = [];
  const skipped: string[] = [];
  const matcher = selectorMatcher(model, (rule, selector) => {
    if (!quiet.has(rule)) unknownSelectors.push({ rule, selector });
  });

  for (const rule of rules) {
    const deny = rule.deny as { from?: Selector; to?: Selector } | undefined;
    const allowOnly = rule["allow-only"] as { from?: Selector; to?: Selector } | undefined;
    if (!deny && !allowOnly) {
      if (!rule.data) skipped.push(rule.id);
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

/**
 * Builds matchers for rule selectors. A matcher takes a node key
 * (element:x, actor:y, external:ns.z) and returns the selector entry it falls
 * under, or undefined. Elements in synced imports match by kind and tag too.
 */
export function selectorMatcher(
  model: Model,
  onUnknown: (rule: string, selector: string) => void = () => {},
): (rule: RuleSpec, sel: unknown) => (key: string) => string | undefined {
  const resolver = new Resolver(
    model.namespace,
    new Set(Object.keys(model.imports)),
    new Set(model.elements.keys()),
    new Set(model.actors.keys()),
  );
  /** An element's namespace and spec, here or in a synced import. */
  const info = (key: string) => {
    if (key.startsWith("element:")) {
      const e = model.elements.get(key.slice(8));
      if (!e) return undefined;
      // In a composed landscape, each repo is a top-level system tagged repo.
      const top = model.elements.get(e.id.split(".")[0] ?? "");
      const repo = top && top.id !== e.id && top.spec.tags?.includes("repo") ? top.id : undefined;
      return { namespace: repo ?? model.namespace, spec: e.spec };
    }
    if (!key.startsWith("external:")) return undefined;
    const ref = key.slice(9);
    const dot = ref.indexOf(".");
    const ns = ref.slice(0, dot);
    const e = model.imported?.get(ns)?.model.elements.get(ref.slice(dot + 1));
    return { namespace: ns, spec: e?.spec };
  };
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
      if (r.status === "external") {
        const ref = `external:${r.target.ref}`;
        return (k) => (k === ref || k.startsWith(`${ref}.`) ? ref : undefined);
      }
      if (r.status !== "resolved") {
        onUnknown(rule.id, sel);
        return () => undefined;
      }
      const key = `${r.target.type}:${r.target.id}`;
      return (k) =>
        k === key || (r.target.type === "element" && k.startsWith(`element:${r.target.id}.`))
          ? key
          : undefined;
    }
    if (sel && typeof sel === "object") {
      const s = sel as { kind?: string; tag?: string; id?: string; namespace?: string };
      if (s.id) return matcher(rule, s.id);
      return (k) => {
        const e = info(k);
        if (!e) return undefined;
        if (s.namespace && e.namespace !== s.namespace) return undefined;
        if ((s.kind || s.tag) && !e.spec) return undefined;
        const ok =
          (!s.kind || e.spec?.kind === s.kind) && (!s.tag || (e.spec?.tags ?? []).includes(s.tag));
        return ok ? k : undefined;
      };
    }
    return () => undefined;
  };
  return matcher;
}
