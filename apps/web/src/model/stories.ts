import {
  DataRegistry,
  type JourneyNode,
  journeyBranches,
  type Model,
  nodeKey,
  type Relationship,
  type Target,
} from "@archdoc/core/browser";
import { type Interaction, sensitivity, stepData } from "../graph/data.js";
import type { LandscapeInfo } from "./useModel.js";

/** Journeys, most important first. */
export const IMPORTANCE = ["critical", "high", "normal", "low"] as const;

const rankOf = (importance: string | undefined) => {
  const i = IMPORTANCE.indexOf((importance ?? "normal") as (typeof IMPORTANCE)[number]);
  return i < 0 ? IMPORTANCE.length : i;
};

/** The model's journeys, most important first, then in the order the model lists them. */
export function journeysByImportance(model: Model): JourneyNode[] {
  return [...model.journeys.values()]
    .map((j, i) => ({ j, i }))
    .sort((a, b) => rankOf(a.j.spec.importance) - rankOf(b.j.spec.importance) || a.i - b.i)
    .map(({ j }) => j);
}

/** A readable name for a step's end: the actor's or element's name, or another repo's element's. */
export function targetLabel(model: Model, t: Target): string {
  if (t.type !== "external") {
    return (
      (t.type === "actor"
        ? model.actors.get(t.id)?.spec.name
        : (model.elements.get(t.id)?.spec.name ?? model.elements.get(t.id)?.key)) ?? t.id
    );
  }
  const local = t.ref.slice(t.namespace.length + 1);
  const other = new DataRegistry(model).models.get(t.namespace);
  return other?.elements.get(local)?.spec.name ?? local;
}

/**
 * The repo a step's end lives in, by namespace: another repo's, the repo box
 * it sits in on a landscape, or this model's. Undefined for actors.
 */
export function repoOf(
  model: Model,
  t: Target,
  landscape?: LandscapeInfo | undefined,
): string | undefined {
  if (t.type === "external") return t.namespace;
  if (t.type === "actor") return undefined;
  if (landscape) {
    let top = model.elements.get(t.id);
    while (top?.parentId) top = model.elements.get(top.parentId);
    if (top && landscape.repos.some((r) => r.namespace === top?.id)) return top.id;
  }
  return model.namespace;
}

/** A repo's name, as the landscape or the model names it. */
export function repoName(
  model: Model,
  namespace: string,
  landscape?: LandscapeInfo | undefined,
): string {
  const r = landscape?.repos.find((x) => x.namespace === namespace);
  if (r) return r.name ?? r.namespace;
  if (namespace === model.namespace) return model.name ?? namespace;
  return new DataRegistry(model).models.get(namespace)?.name ?? namespace;
}

/** What a journey card on the Overview says about a journey. */
export interface JourneyCard {
  id: string;
  /** The goal, or the journey's ID when it has none. */
  title: string;
  name?: string | undefined;
  importance: string;
  /** The actor, then each element it goes through, once: at most five names. */
  path: string[];
  steps: number;
  repos: number;
  decisions: number;
}

/** The names a journey goes through, actor first, each once; long paths keep the first three and the last. */
export function journeyPath(model: Model, journey: JourneyNode, max = 5): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const add = (t: Target | undefined) => {
    if (!t || seen.has(nodeKey(t))) return;
    seen.add(nodeKey(t));
    names.push(targetLabel(model, t));
  };
  add(journey.actor);
  for (const s of journey.steps) {
    add(s.from);
    add(s.to);
  }
  if (names.length <= max) return names;
  return [...names.slice(0, max - 2), "…", names[names.length - 1] as string];
}

export function journeyCards(model: Model, landscape?: LandscapeInfo | undefined): JourneyCard[] {
  return journeysByImportance(model).map((j) => {
    const repos = new Set(
      j.steps
        .flatMap((s) => [s.from, s.to])
        .flatMap((t) => (t ? [repoOf(model, t, landscape)] : []))
        .filter((r): r is string => !!r),
    );
    return {
      id: j.id,
      title: j.spec.goal || j.id,
      name: j.spec.name,
      importance: j.spec.importance ?? "normal",
      path: journeyPath(model, j),
      steps: j.steps.length,
      repos: repos.size,
      decisions: j.steps.filter((s) => s.spec.decides).length,
    };
  });
}

/** "10 steps · 3 repos · 1 decision", leaving out a single repo and no decisions. */
export function journeyFacts(card: Pick<JourneyCard, "steps" | "repos" | "decisions">): string {
  const n = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  return [
    n(card.steps, "step"),
    card.repos > 1 ? n(card.repos, "repo") : "",
    card.decisions ? n(card.decisions, "decision") : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Who owns what: each owner with how many elements name them, most first. */
export function ownership(model: Model): { id: string; name: string; elements: number }[] {
  const counts = new Map<string, number>();
  for (const e of model.elements.values()) {
    for (const o of e.spec.owners ?? []) counts.set(o, (counts.get(o) ?? 0) + 1);
  }
  return [...counts]
    .map(([id, elements]) => ({ id, name: model.actors.get(id)?.spec.name ?? id, elements }))
    .sort((a, b) => b.elements - a.elements || a.name.localeCompare(b.name));
}

/** A participant in a journey: one column of its lanes. */
export interface Lane {
  key: string;
  label: string;
  /** The repo it's in, or an actor's kind. */
  sub?: string | undefined;
  actor: boolean;
}

/** One arrow of a journey in its lanes. */
export interface LaneStep {
  kind: "step";
  /** The interaction it draws. */
  at: number;
  step: number;
  /** "4", or "4.1" for what step 4's writer stores. */
  label: string;
  from: number;
  to: number;
  action: string;
  /** The data it carries: short names, and sensitive classifications. */
  data: { entry: string; label: string; marks: string[] }[];
  /** Its writer storing what the step wrote. */
  stores: boolean;
  /** A key of its own, when several rows draw the same interaction. */
  key?: string | undefined;
  /** How it reads in a trace: where it goes wrong, where that spreads, where it shows. */
  tone?: "cause" | "spreads" | "symptom" | "missing" | undefined;
  /** Short notes on the row, such as "cause" or "not in the model". */
  tags?: { label: string; kind: "cause" | "spreads" | "symptom" | "undeclared" | "missing" }[];
  /** Drawn dashed: a hop the model doesn't declare, or a call that didn't happen. */
  dashed?: boolean | undefined;
}

/** A band across every lane, such as the modeled step a trace opens up. */
export interface LaneBand {
  kind: "band";
  key: string;
  tone: "modeled" | "works";
  text: string;
  /** Lanes to draw a faint arrow between, when the band is about a hop. */
  from?: number | undefined;
  to?: number | undefined;
}

export interface LaneDecision {
  kind: "decision";
  /** The step that decides. */
  step: number;
  logic: string;
}

export interface LaneBranch {
  kind: "branch";
  outcome: string;
  /** The rule's CEL condition, "otherwise", or undefined when no rule names it. */
  condition?: string | undefined;
  rows: LaneStep[];
  /** No steps follow: this outcome ends the journey, or continues as `next`. */
  ends: boolean;
  next?: string | undefined;
}

export interface LaneBranches {
  kind: "branches";
  /** The step that decides, whose outcome picks the branch. */
  decidedAt?: number | undefined;
  branches: LaneBranch[];
}

export type LaneRow = LaneStep | LaneDecision | LaneBranches | LaneBand;

export interface Lanes {
  lanes: Lane[];
  rows: LaneRow[];
}

/**
 * A journey as lanes: a column per participant, in the order they first take
 * part, and its interactions as rows. After a decision, steps that run for one
 * outcome are grouped, a block per outcome, in the order of the decision's rules.
 */
export function journeyLanes(
  model: Model,
  journey: JourneyNode,
  interactions: readonly Interaction[],
  landscape?: LandscapeInfo | undefined,
): Lanes {
  const lanes: Lane[] = [];
  const index = new Map<string, number>();
  const lane = (t: Target) => {
    const key = nodeKey(t);
    let i = index.get(key);
    if (i === undefined) {
      i = lanes.length;
      index.set(key, i);
      const repo = repoOf(model, t, landscape);
      lanes.push({
        key,
        label: targetLabel(model, t),
        sub:
          t.type === "actor"
            ? model.actors.get(t.id)?.spec.kind
            : repo
              ? repoName(model, repo, landscape)
              : undefined,
        actor: t.type === "actor",
      });
    }
    return i;
  };
  if (journey.actor) lane(journey.actor);
  // Columns in the order the steps are written, whichever branch they're in.
  for (const x of interactions) {
    const own = x.store ? undefined : journey.steps[x.step];
    lane(own?.from ?? x.from);
    lane(own?.to ?? x.to);
  }
  const registry = new DataRegistry(model);
  const ns = `${model.namespace}.`;
  const short = (e: string) => (e.startsWith(ns) ? e.slice(ns.length) : e);
  // A chip names the entry alone; the repo it's from is in its tooltip.
  const name = (e: string) => e.slice(e.lastIndexOf(".") + 1);
  const marks = (entry: string) => {
    const node = registry.entry(entry)?.node;
    return node ? sensitivity(node) : [];
  };
  const rowsOf = (step: number): LaneStep[] =>
    interactions.flatMap((x, at): LaneStep[] => {
      if (x.step !== step) return [];
      // A step's own arrow goes the way the step says, even when what it carries comes back.
      const own = x.store ? undefined : journey.steps[step];
      const from = own?.from ?? x.from;
      const to = own?.to ?? x.to;
      const carries = x.store
        ? x.writes
        : (stepData(model, journey, step).message?.entries.map((e) => e.entry) ?? []);
      return [
        {
          kind: "step",
          at,
          step,
          label: x.label,
          from: lane(from),
          to: lane(to),
          action: x.action ?? (carries.length ? `Sends ${carries.map(short).join(", ")}` : ""),
          data: carries.map((entry) => ({ entry, label: name(entry), marks: marks(entry) })),
          stores: !!x.store,
        },
      ];
    });
  const rows: LaneRow[] = [];
  for (const item of journeyBranches(model, journey.id)) {
    if (item.kind === "step") {
      rows.push(...rowsOf(item.index));
      const decides = journey.steps[item.index]?.spec.decides;
      if (decides) rows.push({ kind: "decision", step: item.index, logic: decides });
      continue;
    }
    rows.push({
      kind: "branches",
      decidedAt: item.decidedAt,
      branches: item.outcomes.map((o) => ({
        kind: "branch",
        outcome: o.name,
        condition: o.condition,
        rows: o.steps.flatMap(rowsOf),
        ends: item.last,
        next: o.next,
      })),
    });
  }
  return { lanes, rows };
}

/** How a step travels: the relationship between its ends, from this model or the one it's declared in. */
export function stepUses(model: Model, from: Target, to: Target): Relationship | undefined {
  const same = (r: Relationship, a: Target, b: Target) =>
    nodeKey(r.from) === nodeKey(a) && nodeKey(r.to) === nodeKey(b);
  const local = model.relationships.find((r) => same(r, from, to) || same(r, to, from));
  if (local) return local;
  // Both ends in another repo: that repo's model declares it.
  if (from.type !== "external" || to.type !== "external" || from.namespace !== to.namespace)
    return undefined;
  const other = new DataRegistry(model).models.get(from.namespace);
  const strip = (t: Target): Target =>
    t.type === "external"
      ? { type: "element", id: t.ref.slice(t.namespace.length + 1) }
      : (t as Target);
  return other?.relationships.find(
    (r) => same(r, strip(from), strip(to)) || same(r, strip(to), strip(from)),
  );
}
