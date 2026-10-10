import type { Resolution } from "../load/resolve.js";
import { Resolver } from "../load/resolve.js";
import type {
  ActorNode,
  ElementNode,
  JourneyNode,
  Model,
  NodeRef,
  Relationship,
  Target,
} from "../model.js";
import { nodeKey } from "../model.js";

export interface ElementView {
  element: ElementNode;
  /** From the top of the model down to the parent. */
  ancestors: ElementNode[];
  children: ElementNode[];
  uses: Relationship[];
  /** Relationships into this element, from elements and actors. */
  usedBy: Relationship[];
  /** Owners, including those inherited from ancestors. */
  owners: string[];
  /** Journeys with a step that touches this element or one of its descendants. */
  journeys: JourneyNode[];
}

export interface ActorView {
  actor: ActorNode;
  uses: Relationship[];
  /** Elements that list this actor (usually a team) as an owner. */
  owns: ElementNode[];
  /** Journeys this actor is the subject of, or takes a step in. */
  journeys: { journey: JourneyNode; role: "actor" | "participant" }[];
}

function resolverFor(model: Model): Resolver {
  return new Resolver(
    model.namespace,
    new Set(Object.keys(model.imports)),
    new Set(model.elements.keys()),
    new Set(model.actors.keys()),
  );
}

/** Resolves a reference the same way the model does. */
export function resolveRef(model: Model, ref: string): Resolution {
  return resolverFor(model).endpoint(ref);
}

export function getElement(model: Model, ref: string): ElementView | undefined {
  const r = resolverFor(model).element(ref);
  if (r.status !== "resolved") return undefined;
  const element = model.elements.get(r.target.id);
  if (!element) return undefined;

  const ancestors: ElementNode[] = [];
  for (let p = element.parentId; p; p = model.elements.get(p)?.parentId) {
    const parent = model.elements.get(p);
    if (parent) ancestors.unshift(parent);
  }
  const owners = [...new Set([...ancestors, element].flatMap((e) => e.spec.owners ?? []))];
  const key = nodeKey(element);
  const subtree = subtreeKeys(model, element);

  return {
    element,
    ancestors,
    children: element.childIds.flatMap((id) => model.elements.get(id) ?? []),
    uses: model.relationships.filter((rel) => nodeKey(rel.from) === key),
    usedBy: model.relationships.filter((rel) => nodeKey(rel.to) === key),
    owners,
    journeys: [...model.journeys.values()].filter((j) =>
      j.steps.some((s) => touches(s.from, subtree) || touches(s.to, subtree)),
    ),
  };
}

export function getActor(model: Model, ref: string): ActorView | undefined {
  const r = resolverFor(model).actor(ref);
  if (r.status !== "resolved") return undefined;
  const actor = model.actors.get(r.target.id);
  if (!actor) return undefined;
  const key = nodeKey(actor);

  const journeys: ActorView["journeys"] = [];
  for (const journey of model.journeys.values()) {
    if (journey.actor && nodeKey(journey.actor) === key) {
      journeys.push({ journey, role: "actor" });
    } else if (journey.steps.some((s) => isNode(s.from, key) || isNode(s.to, key))) {
      journeys.push({ journey, role: "participant" });
    }
  }

  return {
    actor,
    uses: model.relationships.filter((rel) => nodeKey(rel.from) === key),
    owns: [...model.elements.values()].filter((e) => e.spec.owners?.includes(actor.id)),
    journeys,
  };
}

export interface Overview {
  namespace: string;
  name?: string | undefined;
  actors: { id: string; kind: string; description?: string | undefined }[];
  elements: { id: string; kind: string; depth: number; description?: string | undefined }[];
  journeys: { id: string; actor: string; goal: string; importance: string }[];
  counts: { actors: number; elements: number; relationships: number; journeys: number };
}

/** A compact summary, down to `maxDepth` levels of elements (0 = top level only). */
export function overview(model: Model, maxDepth = Number.POSITIVE_INFINITY): Overview {
  return {
    namespace: model.namespace,
    name: model.name,
    actors: [...model.actors.values()].map((a) => ({
      id: a.id,
      kind: a.spec.kind,
      description: a.spec.description,
    })),
    elements: [...model.elements.values()]
      .filter((e) => e.depth <= maxDepth)
      .map((e) => ({
        id: e.id,
        kind: e.spec.kind,
        depth: e.depth,
        description: e.spec.description,
      })),
    journeys: [...model.journeys.values()].map((j) => ({
      id: j.id,
      actor: j.spec.actor,
      goal: j.spec.goal,
      importance: j.spec.importance ?? "normal",
    })),
    counts: {
      actors: model.actors.size,
      elements: model.elements.size,
      relationships: model.relationships.length,
      journeys: model.journeys.size,
    },
  };
}

function subtreeKeys(model: Model, root: ElementNode): Set<string> {
  const out = new Set<string>();
  const stack: NodeRef[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as NodeRef;
    out.add(nodeKey(node));
    for (const child of model.elements.get(node.id)?.childIds ?? []) {
      stack.push({ type: "element", id: child });
    }
  }
  return out;
}

function touches(target: Target | undefined, keys: Set<string>): boolean {
  return target !== undefined && keys.has(nodeKey(target));
}

function isNode(target: Target | undefined, key: string): boolean {
  return target !== undefined && nodeKey(target) === key;
}
