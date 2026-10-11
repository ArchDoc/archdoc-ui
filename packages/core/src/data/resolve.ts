import type { DataFieldSpec, ProvideSpec } from "@archdoc/spec";
import type { DataNode, ElementNode, Model, Target } from "../model.js";

/** What a data reference (Charge, payments.Charge, trips.Trip) points to. */
export type DataResolution =
  | {
      status: "found";
      /** The namespace that defines it. */
      namespace: string;
      /** Qualified, such as payments.Charge. */
      ref: string;
      node: DataNode;
      /** Defined in this model, not an imported one. */
      local: boolean;
    }
  | { status: "missing"; namespace: string; ref: string; local: boolean; hint?: string | undefined }
  /** In an imported namespace that isn't synced, so it can't be checked. */
  | { status: "not-synced"; namespace: string; ref: string };

/**
 * Resolves a data reference as written in a model: a local entry (Charge),
 * one qualified with this model's namespace (payments.Charge), or one in an
 * imported namespace (trips.Trip), which needs the import synced.
 */
export function resolveData(model: Model, ref: string): DataResolution {
  const dot = ref.indexOf(".");
  const ns = dot > 0 ? ref.slice(0, dot) : model.namespace;
  const id = dot > 0 ? ref.slice(dot + 1) : ref;
  if (ns === model.namespace) {
    const node = model.data.get(id);
    const qualified = `${ns}.${id}`;
    if (node) return { status: "found", namespace: ns, ref: qualified, node, local: true };
    return { status: "missing", namespace: ns, ref: qualified, local: true, hint: near(model, id) };
  }
  if (!model.imports[ns]) {
    return {
      status: "missing",
      namespace: ns,
      ref,
      local: true,
      hint: `"${ns}" isn't imported. Add it to imports, or use a local data entry.`,
    };
  }
  const dep = model.imported?.get(ns);
  if (!dep) return { status: "not-synced", namespace: ns, ref };
  const node = dep.model.data.get(id);
  if (node) return { status: "found", namespace: ns, ref, node, local: false };
  return { status: "missing", namespace: ns, ref, local: false, hint: near(dep.model, id, ns) };
}

/** A data reference in a canonical form, so Refund and payments.Refund compare equal. */
export function qualifyData(ref: string, namespace: string): string {
  return ref.includes(".") ? ref : `${namespace}.${ref}`;
}

/** True when a data reference names an imported namespace. */
export function isImportedData(model: Model, ref: string): boolean {
  const dot = ref.indexOf(".");
  return dot > 0 && ref.slice(0, dot) !== model.namespace && !!model.imports[ref.slice(0, dot)];
}

/** Splits Charge.status (or payments.Charge.status) into the entry and the field. */
export function splitField(ref: string): { entry: string; field: string } | undefined {
  const dot = ref.lastIndexOf(".");
  if (dot <= 0 || dot === ref.length - 1) return undefined;
  return { entry: ref.slice(0, dot), field: ref.slice(dot + 1) };
}

/** Fields that carry a classification, such as card_last4 (pci). */
export function classifiedFields(
  node: DataNode,
): { field: string; classification: string; spec: DataFieldSpec }[] {
  return Object.entries(node.spec.fields ?? {}).flatMap(([field, spec]) =>
    spec.classification ? [{ field, classification: spec.classification, spec }] : [],
  );
}

export interface Lifecycle {
  states: Set<string>;
  /** Allowed next states, by state. */
  next: Map<string, Set<string>>;
  /** Entries that couldn't be read. */
  invalid: string[];
}

/** Reads `states`: lines such as authorized -> captured, or captured -> partially_refunded | refunded. */
export function parseStates(lines: readonly string[]): Lifecycle {
  const states = new Set<string>();
  const next = new Map<string, Set<string>>();
  const invalid: string[] = [];
  for (const line of lines) {
    const parts = line.split("->").map((p) =>
      p
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    if (parts.length < 2 || parts.some((p) => p.length === 0)) {
      invalid.push(line);
      continue;
    }
    for (const [i, from] of parts.entries()) {
      for (const s of from) states.add(s);
      const to = parts[i + 1];
      if (!to) continue;
      for (const a of from) {
        const set = next.get(a) ?? new Set<string>();
        for (const b of to) set.add(b);
        next.set(a, set);
      }
    }
  }
  return { states, next, invalid };
}

/** Reads a change such as captured -> refunded. */
export function parseChange(value: string): { from: string; to: string } | undefined {
  const [from, to, ...rest] = value.split("->").map((s) => s.trim());
  return from && to && rest.length === 0 ? { from, to } : undefined;
}

/** The element a target names, here or in a synced import. */
export function elementOf(model: Model, t: Target | undefined): ElementNode | undefined {
  if (!t) return undefined;
  if (t.type === "element") return model.elements.get(t.id);
  if (t.type !== "external") return undefined;
  return model.imported?.get(t.namespace)?.model.elements.get(t.ref.slice(t.namespace.length + 1));
}

/** The namespace an element's own references are relative to. */
export function namespaceOf(model: Model, t: Target): string {
  return t.type === "external" ? t.namespace : model.namespace;
}

/** Contracts a target provides, here or in a synced import. */
export function providesOf(model: Model, t: Target | undefined): ProvideSpec[] | undefined {
  return elementOf(model, t)?.spec.provides;
}

function near(model: Model, id: string, ns?: string): string | undefined {
  const lower = id.toLowerCase();
  const hits = [...model.data.keys()].filter((k) => k.toLowerCase() === lower);
  return hits.length
    ? `Did you mean ${hits.map((h) => (ns ? `${ns}.${h}` : h)).join(" or ")}?`
    : undefined;
}

/** The contract a relationship or step goes through, by its name. */
export function findContract(
  provides: readonly ProvideSpec[] | undefined,
  name: string | undefined,
): ProvideSpec | undefined {
  if (!name) return undefined;
  return (provides ?? []).find(
    (p) => ("api" in p ? p.api : "topic" in p ? p.topic : p.event) === name,
  );
}
