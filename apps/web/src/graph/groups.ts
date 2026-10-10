import type { LandscapeDomain, LandscapeRepo, Model, Target } from "@archdoc/core/browser";

/** How a landscape is arranged on the canvas. */
export type GroupBy = "repo" | "team" | "domain";

/** The parts of a composed landscape the explorer needs. */
export interface LandscapeView {
  repos: LandscapeRepo[];
  domains: LandscapeDomain[];
}

export interface Group {
  /** Node key: `group:<by>:<id>`. */
  key: string;
  by: GroupBy;
  /** The team, domain, or repo, or undefined for the box of what has none. */
  id?: string | undefined;
  label: string;
  detail?: string | undefined;
}

/**
 * Boxes a landscape is drawn in. By repo, each repo is already a system in the
 * composed model, so nothing moves. By team or domain, the repo systems are
 * taken apart and their elements go into a box per team or domain instead.
 */
export interface Grouping {
  by: GroupBy;
  /** Boxes by node key, in display order. */
  groups: Map<string, Group>;
  /** Element IDs that sit straight in a box, and the box's node key. */
  parentOf: Map<string, string>;
  /** Repo systems taken apart: not drawn, and treated as open. */
  dissolved: ReadonlySet<string>;
  /** The landscape's repos by namespace. */
  repos: ReadonlyMap<string, LandscapeRepo>;
}

export function groupLandscape(model: Model, landscape: LandscapeView, by: GroupBy): Grouping {
  const repos = new Map(
    landscape.repos.filter((r) => model.elements.has(r.namespace)).map((r) => [r.namespace, r]),
  );
  const empty: Grouping = {
    by,
    groups: new Map(),
    parentOf: new Map(),
    dissolved: new Set(),
    repos,
  };
  if (by === "repo") return empty;

  const dissolved = new Set(repos.keys());
  // What gets boxed: the elements at the top once the repo systems are gone.
  const units = [...model.elements.values()]
    .filter((e) => (e.parentId ? dissolved.has(e.parentId) : !dissolved.has(e.id)))
    .map((e) => e.id);

  const candidates: Group[] = [];
  const assign = new Map<string, string | undefined>();
  if (by === "team") {
    for (const a of model.actors.values()) {
      candidates.push({
        key: `group:team:${a.id}`,
        by,
        id: a.id,
        label: a.spec.name ?? a.id,
        detail: a.spec.kind === "team" ? undefined : a.spec.kind,
      });
    }
    for (const id of units) {
      const owner = ownersOf(model, id)[0];
      assign.set(id, owner && model.actors.has(owner) ? `group:team:${owner}` : undefined);
    }
  } else {
    for (const d of landscape.domains) {
      candidates.push({
        key: `group:domain:${d.id}`,
        by,
        id: d.id,
        label: d.name ?? d.id,
        detail: d.description,
      });
    }
    for (const id of units) assign.set(id, domainOf(model, landscape.domains, id));
  }

  const none: Group = {
    key: `group:${by}:`,
    by,
    label: by === "team" ? "No owner" : "Not in a domain",
  };
  const used = new Set([...assign.values()].map((k) => k ?? none.key));
  const groups = new Map(
    [...candidates, none].filter((g) => used.has(g.key)).map((g) => [g.key, g] as const),
  );
  const parentOf = new Map(units.map((id) => [id, assign.get(id) ?? none.key] as const));
  return { by, groups, parentOf, dissolved, repos };
}

/** An element's owners, or the nearest ancestor's. */
function ownersOf(model: Model, id: string): string[] {
  for (
    let e = model.elements.get(id);
    e;
    e = e.parentId ? model.elements.get(e.parentId) : undefined
  ) {
    if (e.spec.owners?.length) return e.spec.owners;
  }
  return [];
}

/** The first domain that lists the element, a repo or element around it, or something inside it. */
function domainOf(
  model: Model,
  domains: readonly LandscapeDomain[],
  id: string,
): string | undefined {
  const around: string[] = [];
  for (
    let e = model.elements.get(id);
    e;
    e = e.parentId ? model.elements.get(e.parentId) : undefined
  ) {
    around.push(e.id);
  }
  const inside = (member: string) => member.startsWith(`${id}.`);
  const d =
    domains.find((d) => d.members.some((m) => around.includes(m))) ??
    domains.find((d) => d.members.some(inside));
  return d ? `group:domain:${d.id}` : undefined;
}

/**
 * The box a journey endpoint belongs to: its repo when grouped by repo, or
 * the team or domain box it's drawn in. Actors from a repo belong to that
 * repo; the landscape's own actors belong to none.
 */
export function boundaryOf(model: Model, grouping: Grouping, target: Target): string | undefined {
  if (target.type === "actor") {
    if (grouping.by !== "repo") return undefined;
    const tag = model.actors.get(target.id)?.spec.tags?.find((t) => t.startsWith("repo:"));
    return tag?.slice(5);
  }
  if (target.type !== "element") return undefined;
  let top = target.id;
  for (let p = model.elements.get(top)?.parentId; p; p = model.elements.get(p)?.parentId) {
    if (grouping.by !== "repo" && grouping.parentOf.has(top)) break;
    top = p;
  }
  if (grouping.by === "repo") return grouping.repos.has(top) ? top : undefined;
  return grouping.parentOf.get(top);
}

/** The two boxes a journey step goes between, when they differ. */
export function crossingOf(
  model: Model,
  grouping: Grouping,
  from: Target,
  to: Target,
): { from: string; to: string } | undefined {
  const a = boundaryOf(model, grouping, from);
  const b = boundaryOf(model, grouping, to);
  return a && b && a !== b ? { from: a, to: b } : undefined;
}

/** The node key of a boundary's box. */
export function boundaryKey(grouping: Grouping, boundary: string): string {
  return grouping.by === "repo" ? `element:${boundary}` : boundary;
}

/** A readable name for a boundary from boundaryOf. */
export function boundaryLabel(grouping: Grouping, boundary: string): string {
  if (grouping.by === "repo") return grouping.repos.get(boundary)?.name ?? boundary;
  return grouping.groups.get(boundary)?.label ?? boundary;
}
