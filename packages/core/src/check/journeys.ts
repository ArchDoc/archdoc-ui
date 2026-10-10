import type { Diagnostic } from "../diagnostics.js";
import { isEventContract } from "../load/build.js";
import type { Resolution, Resolver } from "../load/resolve.js";
import type { YamlPath } from "../load/yaml.js";
import { describeTarget, type Model, type NodeRef, nodeKey, type Target } from "../model.js";

/**
 * Resolves journey actors and steps, and checks that every step follows a
 * declared relationship.
 *
 * A step from A to B is valid when A (or one of its descendants) uses B (or one
 * of its descendants), so a journey can be told at a coarser level than the
 * relationships. A step from an element back to an actor is valid when the
 * actor uses that element: it's the response. A step from a publisher to a
 * subscriber is valid when the subscriber uses the publisher via a topic or
 * event the publisher provides. Steps that start in another repo
 * are reported as info here, and checked against that repo's model by
 * `federate` once it's synced.
 */
export function validateJourneys(
  model: Model,
  resolver: Resolver,
  sites: ReadonlyMap<
    string,
    { file: { locate(path: YamlPath): Diagnostic["location"] }; path: YamlPath }
  >,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const outgoing = new Map<string, Target[]>();
  for (const rel of model.relationships) {
    const key = nodeKey(rel.from);
    outgoing.set(key, [...(outgoing.get(key) ?? []), rel.to]);
  }

  const selfAndDescendants = (ref: NodeRef): Set<string> => {
    const out = new Set<string>([nodeKey(ref)]);
    if (ref.type !== "element") return out;
    const stack = [ref.id];
    while (stack.length > 0) {
      const el = model.elements.get(stack.pop() as string);
      for (const child of el?.childIds ?? []) {
        out.add(nodeKey({ type: "element", id: child }));
        stack.push(child);
      }
    }
    return out;
  };

  const declared = (from: NodeRef, to: Target): boolean => {
    const targets = to.type === "external" ? new Set([nodeKey(to)]) : selfAndDescendants(to);
    for (const source of selfAndDescendants(from)) {
      for (const t of outgoing.get(source) ?? []) {
        if (targets.has(nodeKey(t))) return true;
      }
    }
    return false;
  };

  // A step from a publisher to a subscriber follows the message: the subscriber
  // uses the publisher via a topic or event the publisher provides.
  const subscribed = (from: NodeRef, to: Target): boolean => {
    if (to.type !== "element" || from.type !== "element") return false;
    const publishers = selfAndDescendants(from);
    const subscribers = selfAndDescendants(to);
    return model.relationships.some(
      (r) =>
        subscribers.has(nodeKey(r.from)) &&
        r.to.type === "element" &&
        publishers.has(nodeKey(r.to)) &&
        isEventContract(model.elements.get(r.to.id)?.spec.provides, r.via),
    );
  };

  for (const journey of model.journeys.values()) {
    const site = sites.get(journey.id);
    const at = (path: YamlPath) => site?.file.locate([...site.path, ...path]);
    const label = `Journey "${journey.id}"`;

    const actor = resolver.actor(journey.spec.actor);
    if (actor.status === "resolved" || actor.status === "external") {
      journey.actor = actor.target;
    } else {
      diagnostics.push({
        severity: "error",
        code: "journey/unknown-actor",
        message: `${label}: actor "${journey.spec.actor}" is not defined under actors.`,
        location: at(["actor"]),
      });
    }

    for (const step of journey.steps) {
      const n = step.index + 1;
      const from = endpoint(resolver.endpoint(step.spec.from), "from", step.spec.from, n);
      const to = endpoint(resolver.endpoint(step.spec.to), "to", step.spec.to, n);
      step.from = from;
      step.to = to;
      if (!from || !to) continue;

      if (from.type === "external") {
        diagnostics.push({
          severity: "info",
          code: "journey/unverified-step",
          message: `${label}, step ${n}: starts in another repo (${from.ref}), so it's checked against that repo's model once it's synced (archdoc sync).`,
          location: step.location,
        });
        continue;
      }
      if (declared(from, to)) continue;
      if (to.type === "actor" && declared(to, from)) continue;
      if (subscribed(from, to)) continue;

      diagnostics.push({
        severity: "error",
        code: "journey/broken-step",
        message: `${label}, step ${n}: ${describeTarget(from)} → ${describeTarget(to)} doesn't follow a declared relationship. Add "${step.spec.to}" to the uses of ${from.type} "${from.id}", or fix the step.`,
        location: step.location,
      });
    }

    function endpoint(
      r: Resolution,
      side: "from" | "to",
      ref: string,
      n: number,
    ): Target | undefined {
      if (r.status === "resolved" || r.status === "external") return r.target;
      const message =
        r.status === "ambiguous"
          ? `${label}, step ${n}: "${ref}" could mean ${r.candidates.join(" or ")}.`
          : `${label}, step ${n}: "${ref}" is not an actor or element.${r.hint ? ` ${r.hint}` : ""}`;
      diagnostics.push({
        severity: "error",
        code: r.status === "ambiguous" ? "ref/ambiguous" : "journey/unknown-endpoint",
        message,
        location: at(["steps", n - 1, side]),
      });
      return undefined;
    }
  }
  return diagnostics;
}
