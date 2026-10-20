import {
  type ChangeSummary,
  check,
  diffModels,
  type Finding,
  type MarkedFinding,
  type Model,
  type ModelDiff,
  type RelationshipView,
  summarizeChange,
} from "@archdoc/core/browser";

/** What the Changes tab shows: the model at one ref against another. */
export interface Compare {
  /** The base the changes are since, such as main. */
  ref: string;
  /** The head: a branch, or undefined for the working tree. */
  head?: string | undefined;
  base: Model;
  diff: ModelDiff;
  /** IDs of journeys the changes affect. */
  journeys: Set<string>;
  groups: ChangeGroups;
  /** The same summary the PR comment renders: verdict, headline, concerns, people to ask. */
  summary: ChangeSummary;
  /** How many things changed, for the tab's badge. */
  count: number;
}

/** What the server found comparing the two revisions with their code, as `archdoc report` does. */
export interface ChangeFindings {
  findings: MarkedFinding[];
  changedFiles: string[];
}

export interface ChangeItem {
  /** What to select on the canvas: element:<id>, actor:<id>, journey:<id>, or data:<entry>. */
  key: string;
  kind: "added" | "removed" | "changed" | "moved" | "error" | "warning";
  label: string;
  hint: string;
  detail?: string | undefined;
}

export interface ChangeGroups {
  /** Findings the head has that the base didn't: rules it breaks, references it loses. */
  breaks: ChangeItem[];
  journeys: ChangeItem[];
  elements: ChangeItem[];
  data: ChangeItem[];
  /** Facts an agent suggested, waiting for a person to review. */
  suggested: ChangeItem[];
}

/**
 * Compares two revisions the way `archdoc report` does, from the same
 * summary. With what the server found in the code (`change`), its findings
 * and changed files; without (a static site, two model files), the findings
 * the models alone have.
 */
export function compareModels(
  ref: string,
  base: Model,
  head: string | undefined,
  after: Model,
  change?: ChangeFindings | undefined,
): Compare {
  const diff = diffModels(base, after);
  let findings: MarkedFinding[];
  if (change) {
    findings = change.findings;
  } else {
    const key = (f: Finding) => `${f.code} ${f.message}`;
    const before = new Set(check(base).findings.map(key));
    findings = check(after).findings.map((f) => ({ ...f, introduced: !before.has(key(f)) }));
  }
  const summary = summarizeChange({
    model: after,
    base,
    changedFiles: change?.changedFiles ?? [],
    diff,
    findings,
    diagrams: false,
  });
  const concern = (kind: "error" | "warning") => (c: ChangeSummary["blocking"][number]) => ({
    key: c.element ? `element:${c.element}` : "",
    kind,
    label: c.detail,
    hint: c.rule ? `rule ${c.rule}` : (c.code.split("/").pop() ?? c.code),
  });
  const groups: ChangeGroups = {
    breaks: [
      ...summary.blocking.map(concern("error")),
      ...summary.attention
        .filter((c) => c.code !== "data/sensitive" && c.code !== "model/suggested")
        .map(concern("warning")),
    ],
    journeys: journeyItems(summary, diff),
    elements: elementItems(diff),
    data: dataItems(after, summary, diff),
    suggested: suggestedItems(diff),
  };
  return {
    ref,
    head,
    base,
    diff,
    journeys: new Set(summary.journeys.filter((j) => !j.namespace).map((j) => j.id)),
    groups,
    summary,
    count:
      groups.breaks.length + groups.journeys.length + groups.elements.length + groups.data.length,
  };
}

function journeyItems(report: ChangeSummary, diff: ModelDiff): ChangeItem[] {
  const own = report.journeys.filter((j) => !j.namespace);
  const items: ChangeItem[] = own.map((j) => {
    const change = diff.journeys.find((c) => c.id === j.id);
    return {
      key: `journey:${j.id}`,
      kind: change?.kind ?? "changed",
      label: j.goal || j.id,
      hint: j.importance,
      detail: j.steps.length
        ? `step${j.steps.length === 1 ? "" : "s"} ${j.steps.join(", ")}`
        : change?.kind === "added"
          ? "new journey"
          : undefined,
    };
  });
  // Removed journeys are gone from the head, so the report doesn't list them.
  for (const c of diff.journeys) {
    if (c.kind === "removed") {
      items.push({ key: "", kind: "removed", label: c.id, hint: "removed" });
    }
  }
  return items;
}

function elementItems(diff: ModelDiff): ChangeItem[] {
  return [
    ...diff.elements.map((c) => ({
      key: `element:${c.id}`,
      kind: c.kind,
      label: c.id,
      hint: "element",
      detail: detail(c),
    })),
    ...diff.actors.map((c) => ({
      key: c.kind === "removed" ? "" : `actor:${c.id}`,
      kind: c.kind,
      label: c.id,
      hint: "actor",
      detail: detail(c),
    })),
    ...diff.relationships.map((c) => {
      const r = (c.after ?? c.before) as RelationshipView;
      return {
        key:
          r.from.type === "element" || r.from.type === "actor" ? `${r.from.type}:${r.from.id}` : "",
        kind: c.kind,
        label: `${end(r.from)} → ${end(r.to)}`,
        hint: "arrow",
        detail: c.kind === "changed" ? c.fields.join(", ") : r.description,
      };
    }),
  ];
}

function dataItems(model: Model, report: ChangeSummary, diff: ModelDiff): ChangeItem[] {
  const items: ChangeItem[] = diff.data.map((c) => ({
    key: c.kind === "removed" ? "" : `data:${model.namespace}.${c.id}`,
    kind: c.kind,
    label: c.id,
    hint: "data",
    detail: detail(c),
  }));
  const key = (ref: string) => (model.data.has(ref) ? `data:${model.namespace}.${ref}` : "");
  const fields = (list: { field: string; classification: string }[]) =>
    list.map((f) => `${f.field} (${f.classification})`).join(", ");
  for (const { flow, fields: sensitive, external } of report.data.flows) {
    items.push({
      key: key(flow.data),
      kind: "warning",
      label: `${flow.data}: ${end(flow.from)} → ${end(flow.to)}`,
      hint: external ? "sent outside" : "new path",
      detail: fields(sensitive),
    });
  }
  for (const s of report.data.stores) {
    items.push({
      key: key(s.data),
      kind: "warning",
      label: `${s.element} stores ${s.data}`,
      hint: "new store",
      detail: fields(s.fields),
    });
  }
  return items;
}

function suggestedItems(diff: ModelDiff): ChangeItem[] {
  const suggested = (c: { kind: string; after?: unknown }) =>
    c.kind !== "removed" &&
    (c.after as { provenance?: { source?: string } } | undefined)?.provenance?.source ===
      "suggested";
  return [
    ...diff.elements.filter(suggested).map((c) => ({
      key: `element:${c.id}`,
      kind: c.kind,
      label: c.id,
      hint: "element",
      detail: by(c.after),
    })),
    ...diff.actors.filter(suggested).map((c) => ({
      key: `actor:${c.id}`,
      kind: c.kind,
      label: c.id,
      hint: "actor",
      detail: by(c.after),
    })),
    ...diff.relationships.filter(suggested).map((c) => {
      const r = c.after as RelationshipView;
      return {
        key: `${r.from.type}:${r.from.id}`,
        kind: c.kind,
        label: `${end(r.from)} → ${end(r.to)}`,
        hint: "arrow",
        detail: by(c.after),
      };
    }),
  ];
}

function detail(c: { kind: string; from?: string | undefined; fields: string[] }) {
  if (c.kind === "moved") return `from ${c.from}`;
  if (c.kind === "changed") return c.fields.join(", ");
  return undefined;
}

function by(spec: unknown): string | undefined {
  const who = (spec as { provenance?: { by?: string } } | undefined)?.provenance?.by;
  return who ? `by ${who}` : undefined;
}

function end(t: RelationshipView["from"] | RelationshipView["to"]): string {
  return t.type === "external" ? t.ref : t.id;
}
