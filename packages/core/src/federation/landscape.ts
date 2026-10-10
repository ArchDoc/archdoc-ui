import type {
  ActorSpec,
  ElementSpec,
  JourneySpec,
  ModelFile,
  RelationshipSpec,
  UsesSpec,
} from "@archdoc/spec";
import { buildModel, type ModelSource } from "../load/build.js";
import type { ElementNode, ExternalRef, Model, NodeRef, Target } from "../model.js";
import { nodeKey } from "../model.js";

/** A repo in a composed landscape. */
export interface LandscapeRepo {
  namespace: string;
  name?: string | undefined;
  description?: string | undefined;
  version?: string | undefined;
  commit?: string | undefined;
  source?: string | undefined;
}

/** A business domain, with its members as IDs in the composed model. */
export interface LandscapeDomain {
  id: string;
  name?: string | undefined;
  description?: string | undefined;
  owners: string[];
  /** Element IDs in the composed model: whole repos (their namespace) and single elements. */
  members: string[];
}

export interface ComposedLandscape {
  /** Every repo's model and the landscape's own, as one model. */
  model: Model;
  /** The composed model as a single source, for the explorer. */
  sources: ModelSource[];
  root: string;
  repos: LandscapeRepo[];
  domains: LandscapeDomain[];
}

/**
 * Composes a landscape repo's model and the models it imports into one model,
 * so relationships and journeys across repos connect for real. Each repo
 * becomes a top-level system named by its namespace, with its elements
 * inside (payments.charges keeps its ID). The landscape's own actors,
 * elements, journeys, rules, and domains stay at the top, and its actors
 * (enterprise teams and roles) stand in for repo actors with the same ID.
 * Repo actors and journeys keep their IDs unless two repos use the same
 * one; then they're prefixed with the namespace. Owners that resolve to no
 * actor are errors here, unlike in a single repo.
 */
export function composeLandscape(landscape: Model): ComposedLandscape {
  const L = landscape.namespace;
  const deps = [...(landscape.imported?.values() ?? [])].sort((a, b) =>
    a.namespace.localeCompare(b.namespace),
  );
  const models = new Map<string, Model>([
    [L, landscape],
    ...deps.map((d) => [d.namespace, d.model] as const),
  ]);

  // Composite IDs for actors and journeys: landscape first, then unique repo IDs, then prefixed.
  const unique = (pick: (m: Model) => Iterable<string>) => {
    const count = new Map<string, number>();
    for (const d of deps) for (const id of pick(d.model)) count.set(id, (count.get(id) ?? 0) + 1);
    return (ns: string, id: string, taken: ReadonlySet<string>) =>
      ns === L || (!taken.has(id) && count.get(id) === 1) ? id : `${ns}-${id}`;
  };
  const actorIdOf = unique((m) => m.actors.keys());
  const journeyIdOf = unique((m) => m.journeys.keys());
  const landscapeActors = new Set(landscape.actors.keys());
  const landscapeJourneys = new Set(landscape.journeys.keys());
  const actorId = (ns: string, id: string) =>
    landscapeActors.has(id) ? id : actorIdOf(ns, id, landscapeActors);

  /** A reference in the composed model: its ID there, which resolves from the top. */
  const elementRef = (ns: string, id: string) => (ns === L ? id : `${ns}.${id}`);
  const target = (ns: string, t: Target): string | undefined => {
    if (t.type === "element") return elementRef(ns, t.id);
    if (t.type === "actor") return actorId(ns, t.id);
    const ext = t as ExternalRef;
    const other = models.get(ext.namespace);
    const id = ext.ref.slice(ext.namespace.length + 1);
    if (other?.elements.has(id)) return elementRef(ext.namespace, id);
    if (other?.actors.has(id)) return actorId(ext.namespace, id);
    return undefined;
  };
  const owner = (ns: string, o: string) => {
    const m = models.get(ns);
    if (landscapeActors.has(o)) return o;
    return m?.actors.has(o) ? actorId(ns, o) : o;
  };
  const outside: string[] = [];

  const usesOf = (ns: string, m: Model, from: NodeRef): UsesSpec | undefined => {
    const uses: Record<string, RelationshipSpec> = {};
    for (const r of m.relationships) {
      if (nodeKey(r.from) !== nodeKey(from)) continue;
      const to = target(ns, r.to);
      if (!to) {
        outside.push(`${ns}.${r.from.id} → ${r.to.type === "external" ? r.to.ref : r.to.id}`);
        continue;
      }
      uses[to] = {
        ...(r.description ? { description: r.description } : {}),
        ...(r.technology ? { technology: r.technology } : {}),
        ...(r.via ? { via: r.via } : {}),
        ...(r.status !== "active" ? { status: r.status } : {}),
        ...(r.provenance ? { provenance: r.provenance } : {}),
      };
    }
    return Object.keys(uses).length ? uses : undefined;
  };

  const elementSpec = (ns: string, m: Model, node: ElementNode, keepCode: boolean): ElementSpec => {
    const { uses: _u, elements: _e, owners, code, ...rest } = node.spec;
    const children = Object.fromEntries(
      node.childIds.flatMap((id) => {
        const child = m.elements.get(id);
        return child ? [[child.key, elementSpec(ns, m, child, keepCode)]] : [];
      }),
    );
    const uses = usesOf(ns, m, node);
    return {
      ...rest,
      ...(owners?.length ? { owners: owners.map((o) => owner(ns, o)) } : {}),
      ...(keepCode && code ? { code } : {}),
      ...(uses ? { uses } : {}),
      ...(Object.keys(children).length ? { elements: children } : {}),
    };
  };
  const topLevel = (m: Model) => [...m.elements.values()].filter((e) => !e.parentId);

  const actors: Record<string, ActorSpec> = {};
  const elements: Record<string, ElementSpec> = {};
  const journeys: Record<string, JourneySpec> = {};

  const addActors = (ns: string, m: Model) => {
    for (const a of m.actors.values()) {
      const id = actorId(ns, a.id);
      const { uses: _u, ...rest } = a.spec;
      const uses = usesOf(ns, m, a);
      const existing = actors[id];
      if (existing) {
        // A repo's copy of a landscape team: the landscape's definition wins; uses add up.
        if (uses) existing.uses = { ...(existing.uses ?? {}), ...uses };
        continue;
      }
      actors[id] = {
        ...rest,
        ...(ns !== L && id !== a.id ? { name: a.spec.name ?? `${a.id} (${ns})` } : {}),
        ...(ns !== L ? { tags: [...(a.spec.tags ?? []), `repo:${ns}`] } : {}),
        ...(uses ? { uses } : {}),
      };
    }
  };
  const addJourneys = (ns: string, m: Model) => {
    for (const j of m.journeys.values()) {
      const id = ns === L ? j.id : journeyIdOf(ns, j.id, landscapeJourneys);
      const refOf = (t: Target | undefined, raw: string) => (t && target(ns, t)) ?? `${ns}.${raw}`;
      journeys[id] = {
        ...j.spec,
        actor: refOf(j.actor, j.spec.actor),
        ...(j.spec.owners ? { owners: j.spec.owners.map((o) => owner(ns, o)) } : {}),
        ...(ns !== L ? { tags: [...(j.spec.tags ?? []), `repo:${ns}`] } : {}),
        steps: j.steps.map((s) => ({
          ...s.spec,
          from: refOf(s.from, s.spec.from),
          to: refOf(s.to, s.spec.to),
        })),
      };
    }
  };

  addActors(L, landscape);
  for (const d of deps) addActors(d.namespace, d.model);
  for (const e of topLevel(landscape)) elements[e.key] = elementSpec(L, landscape, e, true);
  for (const d of deps) {
    elements[d.namespace] = {
      kind: "system",
      ...(d.model.name ? { name: d.model.name } : {}),
      ...(d.model.description ? { description: d.model.description } : {}),
      documentation: `From ${d.namespace}@${d.version ?? d.commit?.slice(0, 7) ?? "?"}${d.source ? ` (${d.source})` : ""}.`,
      tags: ["repo"],
      elements: Object.fromEntries(
        topLevel(d.model).map((e) => [e.key, elementSpec(d.namespace, d.model, e, false)]),
      ),
    };
  }
  addJourneys(L, landscape);
  for (const d of deps) addJourneys(d.namespace, d.model);

  const spec: ModelFile = {
    archdoc: "2.0",
    namespace: L,
    ...(landscape.name ? { name: landscape.name } : {}),
    ...(landscape.description ? { description: landscape.description } : {}),
    actors,
    elements,
    journeys,
    ...(landscape.rules.length ? { rules: landscape.rules } : {}),
  };
  const root = `${L}.landscape.json`;
  const sources = [{ path: root, text: `${JSON.stringify(spec, null, 2)}\n` }];
  const model = buildModel(sources, { root });
  for (const d of model.diagnostics) {
    // Every team should be defined somewhere in the landscape.
    if (d.code === "ref/unresolved-owner") d.severity = "error";
  }
  for (const rel of outside) {
    model.diagnostics.push({
      severity: "warning",
      code: "landscape/outside-reference",
      message: `${rel} points outside the landscape. Import that namespace in the landscape to include it.`,
    });
  }

  const domains: LandscapeDomain[] = [...(landscape.domains?.values() ?? [])].map((d) => ({
    id: d.id,
    name: d.spec.name,
    description: d.spec.description,
    owners: d.spec.owners ?? [],
    members: [
      ...(d.spec.namespaces ?? []).filter((ns) => model.elements.has(ns)),
      ...(d.spec.elements ?? [])
        .map((ref) => (ref.startsWith(`${L}.`) ? ref.slice(L.length + 1) : ref))
        .filter((id) => model.elements.has(id)),
    ],
  }));

  return {
    model,
    sources,
    root,
    repos: deps.map((d) => ({
      namespace: d.namespace,
      name: d.model.name,
      description: d.model.description,
      version: d.version,
      commit: d.commit,
      source: d.source,
    })),
    domains,
  };
}
