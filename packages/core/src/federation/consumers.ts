import type { ImportedModel, JourneyNode, Model, Relationship, Target } from "../model.js";

/** A relationship in another repo's model that points into this one. */
export interface RemoteConsumer {
  namespace: string;
  version?: string | undefined;
  /** Who uses it, fully qualified, such as rides.api-gateway. */
  from: string;
  fromType: "element" | "actor";
  /** The element of this model it uses, by local ID. */
  target: string;
  relationship: Relationship;
  /** How it reaches what changed: directly, through a parent of it, or through something that uses it. */
  reach: "direct" | "parent" | "indirect";
}

/** A journey in another repo's model with steps on this one. */
export interface RemoteJourney {
  namespace: string;
  version?: string | undefined;
  journey: JourneyNode;
  /** 1-based steps that touch it. */
  steps: number[];
}

export interface Elsewhere {
  consumers: RemoteConsumer[];
  journeys: RemoteJourney[];
}

/**
 * Every other repo's model this one knows: the landscape, the models it
 * imports, and the ones this repo imports directly (which win when both pin
 * a namespace, since they're what this repo is checked against).
 */
export function otherModels(model: Model): Map<string, ImportedModel> {
  const out = new Map<string, ImportedModel>();
  if (model.landscape) {
    out.set(model.landscape.namespace, model.landscape);
    for (const [ns, m] of model.landscape.members) out.set(ns, m);
  }
  for (const [ns, m] of model.imported ?? []) out.set(ns, m);
  out.delete(model.namespace);
  return out;
}

/**
 * What other repos have on some of this model's elements: who uses them, and
 * which journeys pass through them. `direct` is what changed (with its
 * parts); `indirect` is what uses it here, so a repo that uses one of those
 * is affected too. Empty without a landscape or imports that point back.
 */
export function consumersElsewhere(
  model: Model,
  direct: ReadonlySet<string>,
  indirect: ReadonlySet<string> = new Set(),
): Elsewhere {
  const prefix = `${model.namespace}.`;
  const ancestors = new Set<string>();
  for (const id of direct) {
    for (let p = model.elements.get(id)?.parentId; p; p = model.elements.get(p)?.parentId) {
      if (!direct.has(p)) ancestors.add(p);
    }
  }
  const reachOf = (t: Target | undefined): RemoteConsumer["reach"] | undefined => {
    if (t?.type !== "external" || !t.ref.startsWith(prefix)) return undefined;
    const id = t.ref.slice(prefix.length);
    if (direct.has(id)) return "direct";
    if (ancestors.has(id)) return "parent";
    if (indirect.has(id)) return "indirect";
    return undefined;
  };

  const consumers: RemoteConsumer[] = [];
  const journeys: RemoteJourney[] = [];
  for (const [ns, dep] of otherModels(model)) {
    for (const rel of dep.model.relationships) {
      const reach = reachOf(rel.to);
      if (!reach || rel.to.type !== "external") continue;
      consumers.push({
        namespace: ns,
        version: dep.version,
        from: `${ns}.${rel.from.id}`,
        fromType: rel.from.type,
        target: rel.to.ref.slice(prefix.length),
        relationship: rel,
        reach,
      });
    }
    for (const journey of dep.model.journeys.values()) {
      const steps = journey.steps
        .filter((s) => {
          const r = [reachOf(s.from), reachOf(s.to)];
          return r.includes("direct") || r.includes("parent");
        })
        .map((s) => s.index + 1);
      if (steps.length) journeys.push({ namespace: ns, version: dep.version, journey, steps });
    }
  }
  const rank = { direct: 0, parent: 1, indirect: 2 };
  consumers.sort((a, b) => rank[a.reach] - rank[b.reach] || a.from.localeCompare(b.from));
  const importance = { critical: 0, high: 1, normal: 2 };
  journeys.sort(
    (a, b) =>
      importance[a.journey.spec.importance ?? "normal"] -
        importance[b.journey.spec.importance ?? "normal"] ||
      `${a.namespace}.${a.journey.id}`.localeCompare(`${b.namespace}.${b.journey.id}`),
  );
  return { consumers, journeys };
}
