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
  /**
   * The data goes from the step's target to its source: a subscriber's step to
   * what it subscribes to, or a call whose contract only says what it answers.
   */
  against?: boolean | undefined;
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
      if (found.length) return pick(found, writtenBy(model, step));
      // A call whose contract only says what it answers carries the answer, and a
      // subscription carries what the topic does.
      const answers = flows.filter(
        (f) => (f.how === "returns" || f.how === "carries") && key(f.from) === b && key(f.to) === a,
      );
      if (answers.length) return { ...pick(answers), against: true };
    }
    // A coarse step backed by finer relationships: between what's inside the boxes.
    const inside = flows.filter(
      (f) =>
        f.how !== "step" &&
        chainOf(model, f.from).includes(key(from)) &&
        chainOf(model, f.to).includes(key(to)),
    );
    if (inside.length) return pick(inside, writtenBy(model, step));
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

/**
 * The flows of one kind, a request through a contract before its response;
 * of what a relationship sends, the entries the step writes, when it says.
 */
function pick(found: DataFlow[], written: readonly string[] = []): StepMessage {
  const order = ["sends", "accepts", "carries", "returns"] as const;
  const how = order.find((h) => found.some((f) => f.how === h)) ?? "sends";
  const data = [...new Set(found.filter((f) => f.how === how).map((f) => f.data))];
  const narrowed = data.filter((d) => written.includes(d));
  return { data: narrowed.length ? narrowed : data, how };
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

/** The entries a step writes, as written in it (unqualified when they're local). */
function writtenBy(model: Model, step: JourneyStep): string[] {
  const all = [
    ...writes(step.spec),
    ...Object.values(step.spec.branches ?? {}).flatMap((b) => writes(b)),
  ];
  const mapping = step.spec.via ? new DataRegistry(model).mapping(step.spec.via) : undefined;
  if (mapping) {
    const t = new DataRegistry(model).target(mapping.node.spec.to, mapping.namespace);
    if (t) all.push(t.entry);
  }
  const ns = `${model.namespace}.`;
  return all.flatMap((e) => (e.startsWith(ns) ? [e, e.slice(ns.length)] : [e, `${ns}${e}`]));
}

/** A relationship that subscribes to a topic or event: the channel, and how it travels. */
export interface Subscription {
  /** The topic or event the target provides. */
  channel: string;
  kind: "topic" | "event";
  transport?: string | undefined;
}

/**
 * Whether a relationship subscribes to a topic or event its target provides.
 * Its messages then go the other way, from the publisher to the subscriber.
 */
export function subscriptionOf(
  model: Model,
  rel: Pick<Relationship, "to" | "via" | "transport">,
): Subscription | undefined {
  const contract = findContract(providesOf(model, rel.to), rel.via);
  if (!contract || !rel.via) return undefined;
  if (!("topic" in contract) && !("event" in contract)) return undefined;
  return {
    channel: rel.via,
    kind: "topic" in contract ? "topic" : "event",
    transport: rel.transport ?? contract.transport,
  };
}

/** A datastore a journey step writes into without going to it. */
export interface StepStore {
  /** The datastore: an element ID in this model, or a qualified ref in another repo's. */
  store: string;
  /**
   * Who stores it: the step's target, unless only the step's source has a
   * relationship to the datastore (a service recording what an external one answered).
   */
  writer: Target;
  /** Whether it's in another repo. */
  external: boolean;
  /** Qualified entries the step writes there. */
  entries: string[];
}

/**
 * The datastores a step writes into that it doesn't go to: where what it
 * creates and changes (in any branch), and what a mapping it goes through
 * produces, are stored, other than the step's target and what that's inside.
 * Storing them is an interaction of its own, from the step's target to the
 * datastore. Empty when the target isn't an element, which can't store.
 */
export function stepStores(model: Model, step: JourneyStep): StepStore[] {
  const { from, to } = step;
  if (!to || to.type === "actor") return [];
  const registry = new DataRegistry(model);
  const ns = model.namespace;
  const entries = [
    ...writes(step.spec),
    ...Object.values(step.spec.branches ?? {}).flatMap((b) => writes(b)),
  ].map((e) => qualifyData(e, ns));
  const mapping = step.spec.via ? registry.mapping(step.spec.via) : undefined;
  const mapped = mapping && registry.target(mapping.node.spec.to, mapping.namespace);
  if (mapped) entries.unshift(mapped.entry);
  // The target, and what it's inside: writing there is the step itself.
  const at = new Set(chainOf(model, to));
  const out = new Map<string, StepStore>();
  for (const entry of new Set(entries)) {
    for (const s of registry.storedIn(entry)) {
      const local = s.namespace === ns;
      const store = local ? s.element : `${s.namespace}.${s.element}`;
      if (at.has(local ? `element:${store}` : store)) continue;
      const target = local ? `element:${store}` : store;
      const reaches = (t: Target | undefined) =>
        !!t &&
        model.relationships.some(
          (r) => chainOf(model, r.from).includes(key(t)) && key(r.to) === target,
        );
      const writer = !reaches(to) && from && from.type !== "actor" && reaches(from) ? from : to;
      const found = out.get(store) ?? { store, writer, external: !local, entries: [] };
      found.entries.push(entry);
      out.set(store, found);
    }
  }
  return [...out.values()];
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
