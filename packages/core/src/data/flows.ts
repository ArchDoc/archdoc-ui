import type { SourceLocation } from "../diagnostics.js";
import { otherModels } from "../federation/consumers.js";
import type { JourneyStep, Model, Relationship, Target } from "../model.js";
import { DataRegistry } from "./registry.js";
import { findContract, namespaceOf, providesOf, qualifyData } from "./resolve.js";

/** Data going from one actor or element to another. */
export interface DataFlow {
  /** The data reference, resolvable from this model (qualified when it was written in another repo). */
  data: string;
  from: Target;
  to: Target;
  /**
   * sends: on a relationship; accepts and returns: an api contract the
   * relationship goes through; carries: a topic or event it subscribes to;
   * step: a journey step's sends.
   */
  how: "sends" | "accepts" | "returns" | "carries" | "step";
  /** The contract, for accepts, returns, and carries. */
  via?: string | undefined;
  journey?: string | undefined;
  /** 1-based. */
  step?: number | undefined;
  location?: SourceLocation | undefined;
}

/** A table or collection in a datastore, and the entry stored there. */
export interface DataStore {
  element: string;
  table: string;
  data: string;
  location?: SourceLocation | undefined;
}

/**
 * Every declared flow of data in the model: what relationships send, what
 * goes in and out through the contracts they use (including contracts of
 * elements in synced imports), and what journey steps send.
 */
export function dataFlows(model: Model): DataFlow[] {
  const flows = relationshipFlows(model, model.relationships);
  for (const j of model.journeys.values()) {
    for (const s of j.steps) {
      if (!s.from || !s.to || s.spec.sends === undefined) continue;
      for (const data of [s.spec.sends].flat()) {
        flows.push({
          data,
          from: s.from,
          to: s.to,
          how: "step",
          journey: j.id,
          step: s.index + 1,
          location: s.location,
        });
      }
    }
  }
  return flows;
}

/** A relationship, as far as data goes. */
type Carrier = Pick<Relationship, "sends" | "via" | "location"> & { from: Target; to: Target };

/** What relationships send, and what goes in and out through the contracts they use. */
function relationshipFlows(model: Model, relationships: readonly Carrier[]): DataFlow[] {
  const flows: DataFlow[] = [];
  for (const rel of relationships) {
    const at = { location: rel.location };
    for (const data of rel.sends)
      flows.push({ data, from: rel.from, to: rel.to, how: "sends", ...at });
    const contract = findContract(providesOf(model, rel.to), rel.via);
    if (!contract) continue;
    const scope = namespaceOf(model, rel.to);
    const q = (ref: string) => (scope === model.namespace ? ref : qualifyData(ref, scope));
    const list = (v: string | string[] | undefined) => (v === undefined ? [] : [v].flat());
    const event = "topic" in contract || "event" in contract;
    for (const data of list(contract.accepts)) {
      if (event) continue;
      flows.push({
        data: q(data),
        from: rel.from,
        to: rel.to,
        how: "accepts",
        via: rel.via,
        ...at,
      });
    }
    for (const data of list(contract.returns)) {
      if (event) continue;
      flows.push({
        data: q(data),
        from: rel.to,
        to: rel.from,
        how: "returns",
        via: rel.via,
        ...at,
      });
    }
    // A subscription: the publisher's messages go to the subscriber.
    for (const data of list(contract.carries)) {
      flows.push({
        data: q(data),
        from: rel.to,
        to: rel.from,
        how: "carries",
        via: rel.via,
        ...at,
      });
    }
  }
  return flows;
}

/** Every table or collection the model's datastores map to an entry. */
export function dataStores(model: Model): DataStore[] {
  return [...model.elements.values()].flatMap((e) =>
    Object.entries(e.spec.stores ?? {}).map(([table, s]) => ({
      element: e.id,
      table,
      data: s.entity,
      location: e.location,
    })),
  );
}

/** What a journey step carries, and where the model says so. */
export interface StepMessage {
  /** Data references, resolvable from this model. */
  data: string[];
  /**
   * step: the step's sends; sends, accepts, returns, carries: the
   * relationship between the same boxes (or their parents), or the contract
   * it goes through; writes: what a mapping the step goes through produces,
   * and the entries it creates or changes.
   */
  how: "step" | "sends" | "accepts" | "returns" | "carries" | "writes";
}

/**
 * The message a journey step carries: what it sends, or else what the
 * relationship it travels along sends (or its contract accepts, returns, or
 * carries, in the step's direction), or else the entries it creates or
 * changes. Undefined when the model says none of these.
 */
export function stepMessage(
  model: Model,
  step: JourneyStep,
  flows: readonly DataFlow[] = dataFlows(model),
): StepMessage | undefined {
  if (step.spec.sends !== undefined) return { data: [step.spec.sends].flat(), how: "step" };
  const { from, to } = step;
  // A step from a box in another repo travels along that repo's relationships,
  // through contracts this model can see.
  const home =
    from?.type === "external" ? otherModels(model).get(from.namespace)?.model : undefined;
  if (home) {
    const lift = (t: Target): Target =>
      t.type === "external"
        ? t
        : { type: "external", namespace: home.namespace, ref: `${home.namespace}.${t.id}` };
    flows = relationshipFlows(
      model,
      home.relationships.map((r) => ({
        ...r,
        from: lift(r.from),
        to: lift(r.to),
        sends: r.sends.map((d) => qualifyData(d, home.namespace)),
      })),
    );
  }
  if (from && to) {
    // The nearest relationship: between the boxes themselves, or else their parents.
    const fromChain = chainOf(model, from);
    const toChain = chainOf(model, to);
    for (let depth = 0; depth < Math.max(fromChain.length, toChain.length); depth++) {
      const a = fromChain[Math.min(depth, fromChain.length - 1)] as string;
      const b = toChain[Math.min(depth, toChain.length - 1)] as string;
      const found = flows.filter((f) => f.how !== "step" && key(f.from) === a && key(f.to) === b);
      if (found.length) return pick(found);
      // A call whose contract only says what it answers carries the answer.
      const answers = flows.filter(
        (f) => f.how === "returns" && key(f.from) === b && key(f.to) === a,
      );
      if (answers.length) return pick(answers);
    }
    // A coarse step backed by finer relationships: between what's inside the boxes.
    const inside = flows.filter(
      (f) =>
        f.how !== "step" &&
        chainOf(model, f.from).includes(key(from)) &&
        chainOf(model, f.to).includes(key(to)),
    );
    if (inside.length) return pick(inside);
  }
  // What a mapping the step writes through produces.
  const registry = step.spec.via ? new DataRegistry(model) : undefined;
  const mapping = step.spec.via ? registry?.mapping(step.spec.via) : undefined;
  const mapped = mapping && registry?.target(mapping.node.spec.to, mapping.namespace);
  const effects = [
    ...(mapped ? [mapped.entry] : []),
    ...writes(step.spec),
    ...Object.values(step.spec.branches ?? {}).flatMap((b) => writes(b)),
  ];
  return effects.length ? { data: [...new Set(effects)], how: "writes" } : undefined;
}

/** The flows of one kind, a request through a contract before its response. */
function pick(found: DataFlow[]): StepMessage {
  const order = ["sends", "accepts", "carries", "returns"] as const;
  const how = order.find((h) => found.some((f) => f.how === h)) ?? "sends";
  return { data: [...new Set(found.filter((f) => f.how === how).map((f) => f.data))], how };
}

/** A step's journey-level key for a target: `id` of an element or actor, the ref of an external. */
function key(t: Target): string {
  return t.type === "external" ? t.ref : `${t.type}:${t.id}`;
}

/** A target, then each element above it. */
function chainOf(model: Model, t: Target): string[] {
  const out = [key(t)];
  if (t.type !== "element") return out;
  for (let p = model.elements.get(t.id)?.parentId; p; p = model.elements.get(p)?.parentId) {
    out.push(`element:${p}`);
  }
  return out;
}

/** The entries a step (or branch) creates or changes. */
function writes(spec: {
  creates?: string | string[] | Record<string, unknown> | undefined;
  changes?: Record<string, unknown> | undefined;
}) {
  const created =
    typeof spec.creates === "string"
      ? [spec.creates]
      : Array.isArray(spec.creates)
        ? spec.creates
        : Object.keys(spec.creates ?? {});
  return [
    ...created,
    ...Object.keys(spec.changes ?? {}).map((k) => k.slice(0, k.lastIndexOf("."))),
  ];
}
