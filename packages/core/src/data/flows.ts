import type { SourceLocation } from "../diagnostics.js";
import type { Model, Target } from "../model.js";
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
  const flows: DataFlow[] = [];
  for (const rel of model.relationships) {
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
