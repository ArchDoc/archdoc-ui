import type { RuleSpec } from "@archdoc/spec";
import { locate } from "../codemap/codemap.js";
import { Resolver } from "../load/resolve.js";
import type { ElementNode, JourneyNode, Model, Relationship, Target } from "../model.js";
import { nodeKey } from "../model.js";

export interface ImpactConsumer {
  relationship: Relationship;
  /** 1 for direct consumers, 2 for consumers of those, and so on. */
  depth: number;
  /** The relationship points at a parent of the target, so the change may or may not reach it. */
  viaParent: boolean;
}

export interface AffectedJourney {
  journey: JourneyNode;
  /** 1-based step numbers that touch the target (or a parent of it). */
  steps: number[];
}

export interface Impact {
  /** What the question was about, as resolved. */
  target: Target;
  /** For a file path: the element that owns it. */
  path?: string | undefined;
  element?: ElementNode | undefined;
  /** Elements and actors that use the target, directly or transitively. */
  consumers: ImpactConsumer[];
  /** What the target itself uses. */
  dependencies: Relationship[];
  /** Actors that use the target or one of its consumers, and why. */
  actors: { id: string; kind: string; via: string }[];
  /** Journeys with a step on the target or a parent, most important first. */
  journeys: AffectedJourney[];
  /** Owners, including inherited ones. */
  owners: string[];
  /** Rules that mention the target or a parent. Checked from roadmap Phase 3. */
  rules: RuleSpec[];
  code: string[];
}

export type ImpactResult =
  | { ok: true; impact: Impact }
  | { ok: false; reason: string; candidates?: string[] | undefined };

const IMPORTANCE = { critical: 0, high: 1, normal: 2 } as const;

/**
 * The blast radius of a change, before it's made. `target` can be an element
 * or actor reference, or a file path (which resolves to its owning element).
 */
export function impact(model: Model, target: string, maxDepth = 3): ImpactResult {
  const resolver = new Resolver(
    model.namespace,
    new Set(Object.keys(model.imports)),
    new Set(model.elements.keys()),
    new Set(model.actors.keys()),
  );

  let path: string | undefined;
  let resolved = resolver.endpoint(target);
  if (resolved.status === "unresolved" && /[/.]/.test(target)) {
    const located = locate(model, target);
    if (located.element) {
      path = located.path;
      resolved = { status: "resolved", target: { type: "element", id: located.element.id } };
    } else if (target.includes("/")) {
      return {
        ok: false,
        reason: `No element maps ${located.path}. Add it to an element's code: paths in the model.`,
      };
    }
  }
  if (resolved.status === "ambiguous") {
    return { ok: false, reason: `"${target}" is ambiguous.`, candidates: resolved.candidates };
  }
  if (resolved.status === "unresolved") {
    return {
      ok: false,
      reason: `"${target}" is not an element, actor, or mapped file.${resolved.hint ? ` ${resolved.hint}` : ""}`,
    };
  }

  const t = resolved.target;
  const element = t.type === "element" ? model.elements.get(t.id) : undefined;
  const subtree = new Set<string>([nodeKey(t)]);
  const ancestors = new Set<string>();
  if (element) {
    for (const id of descendants(model, element.id)) subtree.add(`element:${id}`);
    for (let p = element.parentId; p; p = model.elements.get(p)?.parentId)
      ancestors.add(`element:${p}`);
  }

  // Walk consumers breadth-first: direct ones first, then who uses them.
  const consumers: ImpactConsumer[] = [];
  const seen = new Set<string>(subtree);
  let frontier = new Set<string>([...subtree, ...ancestors]);
  for (let depth = 1; depth <= maxDepth && frontier.size > 0; depth++) {
    const next = new Set<string>();
    for (const rel of model.relationships) {
      const to = nodeKey(rel.to);
      const from = nodeKey(rel.from);
      if (!frontier.has(to) || seen.has(from) || subtree.has(from) || ancestors.has(from)) continue;
      // An ancestor's own children aren't consumers of the ancestor in any useful sense.
      if (depth === 1 && ancestors.has(to) && isInside(model, rel.from, to)) continue;
      consumers.push({ relationship: rel, depth, viaParent: depth === 1 && ancestors.has(to) });
      next.add(from);
    }
    for (const k of next) seen.add(k);
    frontier = next;
  }

  const dependencies = model.relationships.filter(
    (r) => subtree.has(nodeKey(r.from)) && !subtree.has(nodeKey(r.to)),
  );

  const actors = new Map<string, { id: string; kind: string; via: string }>();
  for (const c of consumers) {
    const from = c.relationship.from;
    if (from.type !== "actor" || actors.has(from.id)) continue;
    const via = c.viaParent
      ? `uses ${describe(c.relationship.to)}, which contains it`
      : c.depth === 1
        ? "uses it directly"
        : `uses ${describe(c.relationship.to)}`;
    actors.set(from.id, {
      id: from.id,
      kind: model.actors.get(from.id)?.spec.kind ?? "actor",
      via,
    });
  }
  if (t.type === "actor") {
    const a = model.actors.get(t.id);
    if (a) actors.set(a.id, { id: a.id, kind: a.spec.kind, via: "is the target" });
  }

  const touches = new Set([...subtree, ...ancestors]);
  const journeys: AffectedJourney[] = [];
  for (const j of model.journeys.values()) {
    const steps = j.steps
      .filter(
        (s) => (s.from && touches.has(nodeKey(s.from))) || (s.to && touches.has(nodeKey(s.to))),
      )
      .map((s) => s.index + 1);
    if (steps.length || (t.type === "actor" && j.actor && nodeKey(j.actor) === nodeKey(t))) {
      journeys.push({ journey: j, steps });
    }
  }
  journeys.sort(
    (a, b) =>
      IMPORTANCE[a.journey.spec.importance ?? "normal"] -
      IMPORTANCE[b.journey.spec.importance ?? "normal"],
  );

  const chain = element ? [...ancestorIds(model, element.id), element.id] : [];
  const owners = [...new Set(chain.flatMap((id) => model.elements.get(id)?.spec.owners ?? []))];
  const names = new Set(chain.flatMap((id) => [id, id.split(".").pop() as string]));
  if (t.type === "actor") names.add(t.id);
  const rules = model.rules.filter((r) => mentions(r, names));

  return {
    ok: true,
    impact: {
      target: t,
      path,
      element,
      consumers,
      dependencies,
      actors: [...actors.values()],
      journeys,
      owners,
      rules,
      code: element?.code.map((c) => c.path) ?? [],
    },
  };
}

function descendants(model: Model, id: string): string[] {
  const out: string[] = [];
  const stack = [...(model.elements.get(id)?.childIds ?? [])];
  while (stack.length) {
    const c = stack.pop() as string;
    out.push(c);
    stack.push(...(model.elements.get(c)?.childIds ?? []));
  }
  return out;
}

function ancestorIds(model: Model, id: string): string[] {
  const out: string[] = [];
  for (let p = model.elements.get(id)?.parentId; p; p = model.elements.get(p)?.parentId)
    out.unshift(p);
  return out;
}

function isInside(model: Model, node: Target, ancestorKey: string): boolean {
  if (node.type !== "element") return false;
  return ancestorIds(model, node.id).some((a) => `element:${a}` === ancestorKey);
}

function describe(t: Target): string {
  return t.type === "external" ? t.ref : t.id;
}

/** True when any string in the rule names one of the IDs. */
function mentions(rule: RuleSpec, names: ReadonlySet<string>): boolean {
  const strings: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") strings.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object")
      Object.entries(v).forEach(([k, x]) => k !== "description" && walk(x));
  };
  walk(rule);
  return strings.some((s) => names.has(s));
}
