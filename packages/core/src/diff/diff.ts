import type { Model, NodeRef, Relationship, Target } from "../model.js";
import { nodeKey } from "../model.js";

export type ChangeKind = "added" | "removed" | "changed" | "moved";

export interface Change<T> {
  kind: ChangeKind;
  /** ID after the change (or before, for removals). */
  id: string;
  /** For moves: the ID before. */
  from?: string | undefined;
  before?: T | undefined;
  after?: T | undefined;
  /** Fields that differ, for "changed" and "moved". */
  fields: string[];
}

export interface StepChange {
  kind: "added" | "removed";
  /** 1-based step number in the version it belongs to. */
  step: number;
  from: string;
  to: string;
  action?: string | undefined;
}

export interface RelationshipView {
  from: NodeRef;
  to: Target;
  description?: string | undefined;
  status: string;
}

export interface ModelDiff {
  actors: Change<unknown>[];
  elements: Change<unknown>[];
  relationships: Change<RelationshipView>[];
  journeys: (Change<unknown> & { steps?: StepChange[] })[];
  data: Change<unknown>[];
  rules: Change<unknown>[];
}

/**
 * A semantic diff between two versions of a model: what was added, removed,
 * changed, or moved, by ID rather than by line. Used for PR comments, the
 * explorer's before/after view, and agents describing their own changes.
 */
export function diffModels(base: Model, head: Model): ModelDiff {
  return {
    // Relationships are diffed on their own, so leave `uses` out of actors and elements.
    actors: diffMaps(
      mapValues(base.actors, ({ spec: { uses: _uses, ...rest } }) => rest),
      mapValues(head.actors, ({ spec: { uses: _uses, ...rest } }) => rest),
    ),
    elements: diffElements(base, head),
    relationships: diffMaps(relationships(base), relationships(head)),
    journeys: diffJourneys(base, head),
    data: diffMaps(
      mapValues(base.data, (d) => d.spec),
      mapValues(head.data, (d) => d.spec),
    ),
    rules: diffMaps(
      new Map(base.rules.map((r) => [r.id, r])),
      new Map(head.rules.map((r) => [r.id, r])),
    ),
  };
}

export function isEmptyDiff(d: ModelDiff): boolean {
  return Object.values(d).every((list: unknown[]) => list.length === 0);
}

export function countChanges(d: ModelDiff): number {
  return Object.values(d).reduce((n: number, list: unknown[]) => n + list.length, 0);
}

function diffElements(base: Model, head: Model): Change<unknown>[] {
  // Children and relationships are diffed on their own.
  const own = (m: Model) =>
    mapValues(m.elements, (e) => {
      const { elements: _children, uses: _uses, ...rest } = e.spec;
      return rest;
    });
  const changes = diffMaps(own(base), own(head));

  // A removal and an addition with the same key and kind is a move.
  const removed = changes.filter((c) => c.kind === "removed");
  const added = changes.filter((c) => c.kind === "added");
  const moves: Change<unknown>[] = [];
  for (const r of removed) {
    const key = r.id.split(".").pop();
    const kind = base.elements.get(r.id)?.spec.kind;
    const candidates = added.filter(
      (a) => a.id.split(".").pop() === key && head.elements.get(a.id)?.spec.kind === kind,
    );
    const target = candidates[0];
    if (candidates.length !== 1 || !target) continue;
    const fields = changedFields(r.before, target.after);
    moves.push({
      kind: "moved",
      id: target.id,
      from: r.id,
      before: r.before,
      after: target.after,
      fields: ["parent", ...fields],
    });
    changes.splice(changes.indexOf(r), 1);
    changes.splice(changes.indexOf(target), 1);
  }
  return [...changes, ...moves].sort(byId);
}

function diffJourneys(base: Model, head: Model): (Change<unknown> & { steps?: StepChange[] })[] {
  const spec = (m: Model) => mapValues(m.journeys, (j) => j.spec);
  return diffMaps(spec(base), spec(head)).map((c) => {
    if (c.kind !== "changed" || !c.fields.includes("steps")) return c;
    const before = base.journeys.get(c.id);
    const after = head.journeys.get(c.id);
    const sig = (s: { from: string; to: string; action?: string | undefined }) =>
      `${s.from}→${s.to}:${s.action ?? ""}`;
    const a = (before?.spec.steps ?? []).map(sig);
    const b = (after?.spec.steps ?? []).map(sig);
    const keep = lcs(a, b);
    const steps: StepChange[] = [];
    before?.spec.steps.forEach((s, i) => {
      if (!keep.left.has(i))
        steps.push({ kind: "removed", step: i + 1, from: s.from, to: s.to, action: s.action });
    });
    after?.spec.steps.forEach((s, i) => {
      if (!keep.right.has(i))
        steps.push({ kind: "added", step: i + 1, from: s.from, to: s.to, action: s.action });
    });
    return { ...c, steps };
  });
}

function relationships(m: Model): Map<string, RelationshipView> {
  return new Map(
    m.relationships.map((r: Relationship) => [
      `${nodeKey(r.from)}->${nodeKey(r.to)}`,
      {
        from: r.from,
        to: r.to,
        description: r.description,
        status: r.status,
        ...(r.technology ? { technology: r.technology } : {}),
        ...(r.sends.length ? { sends: r.sends } : {}),
        ...(r.provenance ? { provenance: r.provenance } : {}),
      },
    ]),
  );
}

function diffMaps<T>(before: Map<string, T>, after: Map<string, T>): Change<T>[] {
  const out: Change<T>[] = [];
  for (const [id, b] of before) {
    const a = after.get(id);
    if (a === undefined) out.push({ kind: "removed", id, before: b, fields: [] });
    else {
      const fields = changedFields(b, a);
      if (fields.length) out.push({ kind: "changed", id, before: b, after: a, fields });
    }
  }
  for (const [id, a] of after) {
    if (!before.has(id)) out.push({ kind: "added", id, after: a, fields: [] });
  }
  return out.sort(byId);
}

function changedFields(a: unknown, b: unknown): string[] {
  const x = (a ?? {}) as Record<string, unknown>;
  const y = (b ?? {}) as Record<string, unknown>;
  return [...new Set([...Object.keys(x), ...Object.keys(y)])]
    .filter((k) => stable(x[k]) !== stable(y[k]))
    .sort();
}

/** JSON with sorted keys, so field order in YAML doesn't count as a change. */
function stable(v: unknown): string {
  return (
    JSON.stringify(v, (_k, val) =>
      val && typeof val === "object" && !Array.isArray(val)
        ? Object.fromEntries(Object.entries(val).sort(([p], [q]) => p.localeCompare(q)))
        : val,
    ) ?? "undefined"
  );
}

/** Indexes kept on each side by a longest common subsequence. */
function lcs(a: string[], b: string[]): { left: Set<number>; right: Set<number> } {
  const width = b.length + 1;
  // dp[i * width + j]: LCS length of a[i..] and b[j..].
  const dp = new Uint32Array((a.length + 1) * width);
  const at = (i: number, j: number) => dp[i * width + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i * width + j] =
        a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const left = new Set<number>();
  const right = new Set<number>();
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) {
      left.add(i++);
      right.add(j++);
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      i++;
    } else {
      j++;
    }
  }
  return { left, right };
}

function mapValues<V, T>(m: Map<string, V>, f: (v: V) => T): Map<string, T> {
  return new Map([...m].map(([k, v]) => [k, f(v)]));
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id.localeCompare(b.id);
}
