import type { ElementSpec } from "@archdoc/spec";
import { otherModels } from "../federation/consumers.js";
import { lookupImported } from "../federation/federate.js";
import { isEventContract } from "../load/build.js";
import { Resolver } from "../load/resolve.js";
import type { ExternalRef, Model, NodeRef, Target } from "../model.js";

/** A trace step's `from` or `to` (or a missing hop's, or `works-in`'s), resolved against the model. */
export interface TraceEnd {
  /** As written in the trace. */
  written: string;
  /**
   * resolved: in this model. external: in another repo's synced model.
   * not-synced: in an imported repo that isn't synced, so it can't be checked.
   * unknown: nowhere. ambiguous: could mean more than one.
   */
  status: "resolved" | "external" | "not-synced" | "unknown" | "ambiguous";
  /** How the model names it: a local ID (toolchain.core.loader) or another repo's (payments.charges). */
  id?: string | undefined;
  type?: "actor" | "element" | undefined;
  /** The other repo's namespace, for an end that lives there. */
  namespace?: string | undefined;
  /** The model's own reference, as journeys resolve it. */
  target?: Target | undefined;
  /** For ambiguous ends. */
  candidates?: string[] | undefined;
  hint?: string | undefined;
}

/**
 * How a hop relates to the model.
 * same: within one element. inside: between an element and one of its parts.
 * uses: follows a declared relationship. returns: answers one (the reverse).
 * subscribed: follows a topic or event the target subscribes to.
 * undeclared: the model has no relationship for it (drift found while debugging).
 * unverified: an end is in a repo that isn't synced. unknown: an end doesn't resolve.
 */
export type HopKind =
  | "same"
  | "inside"
  | "uses"
  | "returns"
  | "subscribed"
  | "undeclared"
  | "unverified"
  | "unknown";

export interface TraceHop {
  kind: HopKind;
  /** The relationship it follows, by the model's IDs (another repo's prefixed with its namespace). */
  relationship?:
    | {
        from: string;
        to: string;
        description?: string | undefined;
        /** The repo that declares it. */
        namespace: string;
      }
    | undefined;
  /** The relationship is declared between parents of the hop's ends: the model is coarser here. */
  lifted?: boolean | undefined;
}

interface Edge {
  from: string;
  to: string;
  namespace: string;
  description?: string | undefined;
  subscription: boolean;
}

interface Graph {
  namespace: string;
  edges: Edge[];
  resolver: Resolver;
}

const graphs = new WeakMap<Model, Graph>();

/** Every relationship this model and the other repos' models it knows declare, by qualified ID. */
function graphOf(model: Model): Graph {
  const cached = graphs.get(model);
  if (cached) return cached;
  const models: [string, Model][] = [
    [model.namespace, model],
    ...[...otherModels(model)].map(([ns, m]) => [ns, m.model] as [string, Model]),
  ];
  const specs = new Map<string, ElementSpec>();
  for (const [ns, m] of models)
    for (const e of m.elements.values()) specs.set(`${ns}.${e.id}`, e.spec);

  const edges: Edge[] = [];
  for (const [ns, m] of models) {
    const q = (t: Target) => (t.type === "external" ? t.ref : `${ns}.${t.id}`);
    for (const rel of m.relationships) {
      const from = q(rel.from);
      const to = q(rel.to);
      edges.push({ from, to, namespace: ns, description: rel.description, subscription: false });
      // A subscriber uses the publisher via a topic or event: the message goes the other way.
      if (rel.via && isEventContract(specs.get(to)?.provides, rel.via)) {
        edges.push({
          from: to,
          to: from,
          namespace: ns,
          description: rel.description,
          subscription: true,
        });
      }
    }
  }
  const graph: Graph = {
    namespace: model.namespace,
    edges,
    resolver: new Resolver(
      model.namespace,
      new Set(Object.keys(model.imports)),
      new Set(model.elements.keys()),
      new Set(model.actors.keys()),
    ),
  };
  graphs.set(model, graph);
  return graph;
}

/** Resolves a reference in a trace the way journey steps resolve theirs. */
export function resolveTraceEnd(
  model: Model,
  written: string,
  as: "endpoint" | "element" | "actor" = "endpoint",
): TraceEnd {
  const { resolver } = graphOf(model);
  const r =
    as === "element"
      ? resolver.element(written)
      : as === "actor"
        ? resolver.actor(written)
        : resolver.endpoint(written);
  if (r.status === "resolved") {
    return { written, status: "resolved", id: r.target.id, type: r.target.type, target: r.target };
  }
  if (r.status === "ambiguous") return { written, status: "ambiguous", candidates: r.candidates };
  const others = otherModels(model);
  let target: ExternalRef;
  if (r.status === "unresolved") {
    // A repo this one doesn't import, but knows through the landscape.
    const dot = written.indexOf(".");
    const namespace = dot > 0 ? written.slice(0, dot) : "";
    if (!others.has(namespace)) return { written, status: "unknown", hint: r.hint };
    target = { type: "external", namespace, ref: written };
  } else {
    target = r.target;
  }
  const found = lookupImported(others, target.ref);
  const base = { written, id: target.ref, namespace: target.namespace, target };
  if (found.status === "found") return { ...base, status: "external", type: found.node.type };
  if (found.status === "missing") {
    return {
      ...base,
      status: "unknown",
      hint: `${found.dep.namespace}@${found.dep.version ?? "?"} has no "${found.id}".${found.hint ? ` ${found.hint}` : ""}`,
    };
  }
  return { ...base, status: "not-synced" };
}

/** The namespace-qualified ID of a resolved end, such as archdoc.toolchain.cli or payments.charges. */
export function qualified(model: Model, end: TraceEnd): string | undefined {
  if (!end.id) return undefined;
  return end.status === "resolved" ? `${model.namespace}.${end.id}` : end.id;
}

/** An ID as this model shows it: its own without the namespace, other repos' with theirs. */
export function localId(model: Model, id: string): string {
  const prefix = `${model.namespace}.`;
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

/** `a` is `b` or inside it. */
export function covers(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}.`);
}

/** One contains the other (or they're the same). */
export function related(a: string, b: string): boolean {
  return covers(a, b) || covers(b, a);
}

/** How far a relationship's end is from a hop's: 0 the same, 1 a part of it, 2 a parent (lifted). */
function distance(edgeEnd: string, hopEnd: string): number | undefined {
  if (edgeEnd === hopEnd) return 0;
  if (covers(edgeEnd, hopEnd)) return 1;
  if (covers(hopEnd, edgeEnd)) return 2;
  return undefined;
}

/**
 * How a hop between two ends relates to the model. A hop follows a
 * relationship when an end (or a part, or a parent, of it) uses the other's,
 * since a trace is often told at a finer level than the model.
 */
export function classifyHop(model: Model, from: TraceEnd, to: TraceEnd): TraceHop {
  if (isUnknown(from) || isUnknown(to)) return { kind: "unknown" };
  if (from.status === "not-synced" || to.status === "not-synced") return { kind: "unverified" };
  const a = qualified(model, from) as string;
  const b = qualified(model, to) as string;
  if (a === b) return { kind: "same" };
  if (from.type === "element" && to.type === "element" && related(a, b)) return { kind: "inside" };

  const { edges } = graphOf(model);
  const best = (x: string, y: string, subscription: boolean) => {
    let found: { edge: Edge; score: number; lifted: boolean } | undefined;
    for (const e of edges) {
      if (e.subscription !== subscription) continue;
      const df = distance(e.from, x);
      const dt = distance(e.to, y);
      if (df === undefined || dt === undefined) continue;
      const score = df + dt;
      if (!found || score < found.score) found = { edge: e, score, lifted: df === 2 || dt === 2 };
    }
    return found;
  };
  const view = (kind: HopKind, f: { edge: Edge; lifted: boolean }): TraceHop => ({
    kind,
    relationship: {
      from: localId(model, f.edge.from),
      to: localId(model, f.edge.to),
      description: f.edge.description,
      namespace: f.edge.namespace,
    },
    ...(f.lifted ? { lifted: true } : {}),
  });
  const forward = best(a, b, false);
  if (forward) return view("uses", forward);
  const subscribed = best(a, b, true);
  if (subscribed) return view("subscribed", subscribed);
  const reverse = best(b, a, false);
  if (reverse) return view("returns", reverse);
  return { kind: "undeclared" };
}

function isUnknown(end: TraceEnd): boolean {
  return end.status === "unknown" || end.status === "ambiguous";
}

/** A modeled journey step's end, in the same terms as a trace's. */
export function endOfTarget(
  model: Model,
  written: string,
  t: Target | undefined,
  namespace?: string,
): TraceEnd {
  if (!t) return { written, status: "unknown" };
  if (t.type !== "external") {
    if (!namespace || namespace === model.namespace) {
      return { written, status: "resolved", id: t.id, type: t.type, target: t };
    }
    // A step in another repo's journey: its local ends are in that repo.
    return resolveTraceEnd(model, `${namespace}.${t.id}`);
  }
  if (t.namespace === model.namespace) {
    const id = t.ref.slice(model.namespace.length + 1);
    const type = model.elements.has(id) ? "element" : model.actors.has(id) ? "actor" : undefined;
    const target: NodeRef | undefined = type ? { type, id } : undefined;
    return type
      ? { written, status: "resolved", id, type, target }
      : { written, status: "unknown" };
  }
  return resolveTraceEnd(model, t.ref);
}
