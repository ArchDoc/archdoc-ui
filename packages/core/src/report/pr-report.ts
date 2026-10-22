import type { ProvideSpec } from "@archdoc/spec";
import { locate } from "../codemap/codemap.js";
import {
  type NewSensitiveFlow,
  type NewSensitiveStore,
  sensitiveDataChanges,
} from "../data/changes.js";
import { countChanges, type ModelDiff, type RelationshipView } from "../diff/diff.js";
import { consumersElsewhere, otherModels } from "../federation/consumers.js";
import { contractName } from "../load/build.js";
import { type JourneyNode, type Model, toReview } from "../model.js";
import { impact } from "../query/impact.js";
import type { MarkedFinding } from "./check-report.js";
import { formatFindings } from "./check-report.js";
import { blockChanges, formatDiff, summary } from "./diff-report.js";
import { CHANGE_LEGEND_SHORT, changeDiagram, journeyDiagram, type RemoteUse } from "./mermaid.js";

/** Marks the comment so the Action can find and update it. */
export const REPORT_MARKER = "<!-- archdoc-report -->";

/** Ends the comment with its verdict, such as <!-- archdoc-verdict: none -->. */
export const VERDICT_MARKER = "<!-- archdoc-verdict: ";

export interface PrReportInput {
  /** The model after the change. */
  model: Model;
  /** The model before it, to find sensitive data that goes somewhere new. */
  base?: Model | undefined;
  /** Repository files the change touched, relative to the root. */
  changedFiles: string[];
  diff: ModelDiff;
  findings: MarkedFinding[];
  /** Label for the comparison, such as "main...feature". */
  label?: string;
  /** Draw Mermaid diagrams of the change and the affected journeys. Default true. */
  diagrams?: boolean;
  /** Most journeys to draw. Default 3. */
  maxJourneyDiagrams?: number;
  /** A page that shows this change in the explorer, linked from the comment. */
  explorerUrl?: string | undefined;
  /** Bug traces the change adds, which the comment says it fixes. */
  fixes?: { id: string; title?: string | undefined; anchor?: string | undefined }[] | undefined;
  /** Facts the change sealed again after their code changed: someone says they checked the model. */
  resealed?: { key: string; by?: string | undefined }[] | undefined;
}

/** How much a change asks of its reviewers. */
export type Verdict = "blocking" | "attention" | "info" | "none";

/** One thing a reviewer should know: what's wrong, how to fix it, and where. */
export interface Concern {
  /** A finding's code, or consumer/breaks, data/sensitive, journey/critical, model/suggested, consumer/deprecated. */
  code: string;
  title: string;
  detail: string;
  fix?: string | undefined;
  /** file:line, when there is one. */
  where?: string | undefined;
  /** What the detail sums up, line by line, such as what changed under a seal. */
  details?: string[] | undefined;
  /** Where in the code it shows, such as apps/web/pay.ts:1 (@shop/billing). */
  evidence?: string[] | undefined;
  element?: string | undefined;
  rule?: string | undefined;
}

/** Someone to involve before merging: owners approve, other repos know, critical journeys still work. */
export interface Ask {
  kind: "approve" | "inform" | "verify";
  who: string;
  why: string;
}

/**
 * What a change does to the architecture, as every surface shows it: the PR
 * comment, the explorer's Changes tab, and the agent tools render this, so
 * their verdicts and counts agree.
 */
export interface ChangeSummary {
  verdict: Verdict;
  /** The verdict in a few parts, such as ["1 blocking issue", "2 critical journeys", "2 teams to ask"]. */
  headline: string[];
  /** What should stop the merge: errors the change introduced, consumers it breaks. */
  blocking: Concern[];
  /** What a reviewer should look at: new warnings, sensitive data going somewhere new, critical journeys, consumers elsewhere, suggested facts. */
  attention: Concern[];
  asks: Ask[];
  findings: { introduced: MarkedFinding[]; existing: MarkedFinding[] };
  /** How many things changed in the model itself. */
  changes: number;
  fixes: NonNullable<PrReportInput["fixes"]>;
  resealed: NonNullable<PrReportInput["resealed"]>;
  /** Decisions (logic) the change made: where they run, what changed, and the journeys that decide with them. */
  decisions: {
    id: string;
    element?: string | undefined;
    change: string;
    journeys: { id: string; importance: string; step: number }[];
  }[];
  touched: { id: string; files: number; owners: string[] }[];
  journeys: {
    id: string;
    /** For a journey in another repo: its namespace. */
    namespace?: string | undefined;
    goal: string;
    actor: string;
    importance: string;
    status: string;
    steps: number[];
    /** The change edits this journey's steps in the model. */
    stepsChanged?: boolean | undefined;
  }[];
  actors: { id: string; kind: string }[];
  owners: string[];
  /** Consumers in other repos, from the landscape and imports, and what the change does to them. */
  elsewhere: (RemoteUse & {
    version?: string | undefined;
    via?: string | undefined;
    description?: string | undefined;
    reach: "direct" | "parent" | "indirect";
  })[];
  /** Sensitive data the change starts sending or storing somewhere new (needs the base model). */
  data: { flows: NewSensitiveFlow[]; stores: NewSensitiveStore[] };
  suggested: string[];
  introduced: { errors: number; warnings: number };
}

export interface PrReport extends ChangeSummary {
  markdown: string;
}

const IMPORTANCE: Record<string, number> = { critical: 0, high: 1, normal: 2 };

/** Concerns that Before merging already asks about, so To check and the headline don't repeat them. */
export const ASKED_CONCERNS = new Set(["journey/critical-changed", "consumer/affected"]);

/**
 * The architectural impact of a change, for a pull request, as a comment that
 * leads with its verdict. See {@link summarizeChange} for what goes in it.
 */
export function prReport(input: PrReportInput): PrReport {
  const summary = summarizeChange(input);
  return { ...summary, markdown: renderPrComment(summary, input) };
}

/**
 * The architectural impact of a change: which elements it touches (from the
 * changed files and the model diff), who owns them, which journeys and actors
 * it affects, consumers in other repos, sensitive data going somewhere new,
 * suggested facts waiting for review, and drift the change introduced, with a
 * verdict and the people to involve.
 */
export function summarizeChange(input: PrReportInput): ChangeSummary {
  const { model, diff } = input;

  const touchedFiles = new Map<string, number>();
  for (const file of input.changedFiles) {
    const owner = locate(model, file).element;
    if (owner) touchedFiles.set(owner.id, (touchedFiles.get(owner.id) ?? 0) + 1);
  }
  // A contract's spec file (provides: api: proto/charges.proto) belongs to the element that provides it.
  const changed = new Set(input.changedFiles);
  for (const e of model.elements.values()) {
    const specs = (e.spec.provides ?? []).filter((p) => changed.has(contractName(p))).length;
    if (specs) touchedFiles.set(e.id, (touchedFiles.get(e.id) ?? 0) + specs);
  }
  for (const c of diff.elements) {
    if (c.kind !== "removed" && model.elements.has(c.id) && !touchedFiles.has(c.id))
      touchedFiles.set(c.id, 0);
  }
  // A relationship added, changed, or removed touches the element it starts from.
  for (const c of diff.relationships) {
    const from = ((c.after ?? c.before) as { from?: { type: string; id?: string } } | undefined)
      ?.from;
    const id = from?.type === "element" ? from.id : undefined;
    if (id && model.elements.has(id) && !touchedFiles.has(id)) touchedFiles.set(id, 0);
  }
  // A decision that changed touches the element it runs in.
  const decisions = decisionChanges(model, diff);
  for (const d of decisions) {
    if (d.element && !touchedFiles.has(d.element)) touchedFiles.set(d.element, 0);
  }

  const journeys = new Map<string, PrReport["journeys"][number]>();
  const actors = new Map<string, { id: string; kind: string }>();
  const owners = new Set<string>();
  const touched: PrReport["touched"] = [];
  const usedHere = new Set<string>();
  for (const [id, files] of touchedFiles) {
    const r = impact(model, id);
    if (!r.ok) continue;
    touched.push({ id, files, owners: r.impact.owners });
    for (const c of r.impact.consumers) {
      if (c.relationship.from.type === "element") usedHere.add(c.relationship.from.id);
    }
    for (const o of r.impact.owners) owners.add(o);
    for (const a of r.impact.actors) actors.set(a.id, { id: a.id, kind: a.kind });
    for (const j of r.impact.journeys) {
      const prev = journeys.get(j.journey.id);
      const steps = [...new Set([...(prev?.steps ?? []), ...j.steps])].sort((x, y) => x - y);
      journeys.set(j.journey.id, {
        id: j.journey.id,
        goal: j.journey.spec.goal,
        actor: j.journey.spec.actor,
        importance: j.journey.spec.importance ?? "normal",
        status: j.journey.spec.status ?? "active",
        steps,
      });
    }
  }
  // Journeys that decide with a changed decision, here and in other repos, at the deciding step.
  for (const d of decisions) {
    for (const u of d.journeys) {
      const key = u.namespace ? `${u.namespace}.${u.journey.id}` : u.journey.id;
      const prev = journeys.get(key);
      journeys.set(key, {
        id: u.journey.id,
        namespace: u.namespace,
        goal: u.journey.spec.goal,
        actor:
          u.namespace && !u.journey.spec.actor.includes(".")
            ? `${u.namespace}.${u.journey.spec.actor}`
            : u.journey.spec.actor,
        importance: u.journey.spec.importance ?? "normal",
        status: u.journey.spec.status ?? "active",
        steps: [...new Set([...(prev?.steps ?? []), ...u.steps])].sort((x, y) => x - y),
      });
    }
  }
  // New and changed journeys in the model are affected too.
  for (const c of diff.journeys) {
    const j = c.kind !== "removed" ? model.journeys.get(c.id) : undefined;
    if (!j) continue;
    const stepsChanged = c.kind === "changed" && !!c.steps?.length;
    const prev = journeys.get(j.id);
    journeys.set(j.id, {
      id: j.id,
      goal: j.spec.goal,
      actor: j.spec.actor,
      importance: j.spec.importance ?? "normal",
      status: j.spec.status ?? "active",
      steps: prev?.steps ?? [],
      stepsChanged,
    });
  }
  // Other repos: who uses what this change touches or removes, and what it does to them.
  const removed = new Set(diff.elements.filter((c) => c.kind === "removed").map((c) => c.id));
  const direct = new Set([...removed]);
  for (const id of touchedFiles.keys()) {
    direct.add(id);
    for (const e of model.elements.values()) if (e.id.startsWith(`${id}.`)) direct.add(e.id);
  }
  const contracts = contractChanges(diff);
  const remote = consumersElsewhere(model, direct, usedHere);
  const elsewhere: PrReport["elsewhere"] = remote.consumers.map((c) => {
    const via = c.relationship.via;
    const qualified = `${model.namespace}.${c.target}`;
    let effect: RemoteUse["effect"] = "affected";
    let why: string | undefined;
    if (c.reach === "direct" && removed.has(c.target)) {
      effect = "breaks";
      why = `${qualified} is removed`;
    } else if (c.reach === "direct" && via && contracts.removed.get(c.target)?.has(via)) {
      effect = "breaks";
      why = `${via} is removed`;
    } else if (c.reach === "direct" && via && contracts.deprecated.get(c.target)?.has(via)) {
      effect = "deprecated";
      why = `${via} is deprecated`;
    } else if (c.reach === "direct" && contracts.deprecatedElements.has(c.target)) {
      effect = "deprecated";
      why = `${qualified} is deprecated`;
    }
    return {
      from: c.from,
      namespace: c.namespace,
      version: c.version,
      target: c.target,
      via,
      description: c.relationship.description,
      reach: c.reach,
      effect,
      why,
    };
  });
  const others = otherModels(model);
  for (const rj of remote.journeys) {
    const j = rj.journey;
    const qualify = (ref: string) => (ref.includes(".") ? ref : `${rj.namespace}.${ref}`);
    const prev = journeys.get(`${rj.namespace}.${j.id}`);
    journeys.set(`${rj.namespace}.${j.id}`, {
      id: j.id,
      namespace: rj.namespace,
      goal: j.spec.goal,
      actor: qualify(j.spec.actor),
      importance: j.spec.importance ?? "normal",
      status: j.spec.status ?? "active",
      steps: [...new Set([...(prev?.steps ?? []), ...rj.steps])].sort((x, y) => x - y),
    });
    const kind = others.get(rj.namespace)?.model.actors.get(j.spec.actor)?.spec.kind;
    if (kind && !actors.has(qualify(j.spec.actor))) {
      actors.set(qualify(j.spec.actor), { id: qualify(j.spec.actor), kind });
    }
  }

  const journeyList = [...journeys.values()].sort(
    (a, b) =>
      (IMPORTANCE[a.importance] ?? 2) - (IMPORTANCE[b.importance] ?? 2) ||
      (a.namespace ?? "").localeCompare(b.namespace ?? "") ||
      a.id.localeCompare(b.id),
  );

  const pending = (c: { kind: string; after?: unknown }) =>
    c.kind !== "removed" && toReview(c.after) !== undefined;
  const inferred = (c: { after?: unknown }) =>
    toReview(c.after) === "inferred" ? " (inferred)" : "";
  const suggested = [
    ...diff.elements.filter(pending).map((c) => `element \`${c.id}\`${inferred(c)}`),
    ...diff.actors.filter(pending).map((c) => `actor \`${c.id}\`${inferred(c)}`),
    ...diff.relationships.filter(pending).map((c) => {
      const r = c.after as RelationshipView;
      return `\`${ref(r.from)}\` → \`${ref(r.to)}\`${r.description ? `: ${r.description}` : ""}${inferred(c)}`;
    }),
  ];

  const introduced = input.findings.filter((f) => f.introduced);
  const counts = {
    errors: introduced.filter((f) => f.severity === "error").length,
    warnings: introduced.filter((f) => f.severity === "warning").length,
  };

  const data = input.base ? sensitiveDataChanges(input.base, model) : { flows: [], stores: [] };
  const existing = input.findings.filter((f) => !f.introduced);
  const summary: ChangeSummary = {
    verdict: "none",
    headline: [],
    blocking: [],
    attention: [],
    asks: [],
    findings: { introduced, existing },
    changes: countChanges(diff),
    fixes: input.fixes ?? [],
    resealed: input.resealed ?? [],
    decisions: decisions.map((d) => ({
      id: d.id,
      element: d.element,
      change: d.change,
      journeys: d.journeys.map((u) => ({
        id: u.namespace ? `${u.namespace}.${u.journey.id}` : u.journey.id,
        importance: u.journey.spec.importance ?? "normal",
        step: u.steps[0] ?? 0,
      })),
    })),
    touched,
    journeys: journeyList,
    actors: [...actors.values()],
    owners: [...owners],
    elsewhere,
    data,
    suggested,
    introduced: counts,
  };
  return judge(summary);
}
/** Sensitive data going somewhere new, and logic and mappings that changed. (Model changes lists data entries.) */
function dataSection(
  diff: ModelDiff,
  data: { flows: NewSensitiveFlow[]; stores: NewSensitiveStore[] },
): string[] {
  if (!diff.mappings.length && !diff.logic.length && !data.flows.length && !data.stores.length)
    return [];
  const md = ["### Data", ""];
  const name = (t: NewSensitiveFlow["flow"]["from"]) => (t.type === "external" ? t.ref : t.id);
  const fields = (list: { field: string; classification: string }[]) =>
    list.map((f) => `${f.field} (${f.classification})`).join(", ");
  if (data.flows.length) {
    md.push(
      "**Sensitive data that goes somewhere new**",
      "",
      "| Data | Sensitive fields | From → to | How |",
      "|---|---|---|---|",
    );
    const how = (f: NewSensitiveFlow["flow"]) =>
      f.how === "step"
        ? `journey \`${f.journey}\`, step ${f.step}`
        : f.how === "sends"
          ? "sends"
          : `${f.how} through \`${f.via}\``;
    for (const f of data.flows.slice(0, 20)) {
      md.push(
        `| \`${f.flow.data}\` | ${fields(f.fields)} | \`${name(f.flow.from)}\` → \`${name(f.flow.to)}\`${f.external ? " (external)" : ""} | ${how(f.flow)} |`,
      );
    }
    if (data.flows.length > 20) md.push("", `…and ${data.flows.length - 20} more.`);
    md.push("");
  }
  if (data.stores.length) {
    md.push(
      `**Sensitive data stored somewhere new:** ${data.stores
        .map((s) => `\`${s.data}\` (${fields(s.fields)}) in \`${s.element}\` (${s.table})`)
        .join("; ")}`,
      "",
    );
  }
  const blocks = [
    ...diff.logic.map((c) => ({ c, section: "logic" as const })),
    ...diff.mappings.map((c) => ({ c, section: "mappings" as const })),
  ];
  if (blocks.length) {
    md.push(`**Logic and mappings changed (${blocks.length})**`, "");
    for (const { c, section } of blocks) {
      const kind = section === "logic" ? "logic" : "mapping";
      if (c.kind !== "changed") {
        md.push(`- **${c.kind}** ${kind} \`${c.id}\``);
        continue;
      }
      md.push(`- ${kind} \`${c.id}\`:`);
      for (const part of blockChanges(section, c).split("; ")) md.push(`  - ${part}`);
    }
    md.push("");
  }
  return md;
}

/** The most important affected journeys as sequence diagrams; the first one open. */
function journeyDiagrams(input: PrReportInput, journeys: PrReport["journeys"]): string[] {
  const out: string[] = [];
  const others = otherModels(input.model);
  for (const j of journeys.slice(0, input.maxJourneyDiagrams ?? 3)) {
    const changes = j.namespace ? undefined : input.diff.journeys.find((c) => c.id === j.id)?.steps;
    const owner = j.namespace ? others.get(j.namespace)?.model : input.model;
    const diagram =
      owner &&
      journeyDiagram({ model: owner, journeyId: j.id, steps: j.steps, changes, from: input.model });
    if (!diagram) continue;
    const where = j.steps.length
      ? `step${j.steps.length === 1 ? "" : "s"} ${j.steps.join(", ")} go${j.steps.length === 1 ? "es" : ""} through this change`
      : "the journey itself changed";
    out.push(
      `<details${out.length ? "" : " open"}><summary><b>${j.namespace ? `${j.namespace}.${j.id}` : j.id}</b> (${j.importance}${j.namespace ? ", another repo" : ""}): ${where}</summary>`,
      "",
      "```mermaid",
      diagram,
      "```",
      "",
      "</details>",
      "",
    );
  }
  return out;
}

function ref(t: RelationshipView["from"] | RelationshipView["to"]): string {
  return t.type === "external" ? t.ref : t.id;
}

/** Contracts removed or deprecated per element, and elements newly deprecated, from the diff. */
function contractChanges(diff: ModelDiff): {
  removed: Map<string, Set<string>>;
  deprecated: Map<string, Set<string>>;
  deprecatedElements: Set<string>;
} {
  const removed = new Map<string, Set<string>>();
  const deprecated = new Map<string, Set<string>>();
  const deprecatedElements = new Set<string>();
  type Spec = { provides?: ProvideSpec[]; status?: string } | undefined;
  for (const c of diff.elements) {
    if (c.kind !== "changed" && c.kind !== "moved") continue;
    const before = c.before as Spec;
    const after = c.after as Spec;
    if (after?.status === "deprecated" && before?.status !== "deprecated")
      deprecatedElements.add(c.id);
    const now = new Map((after?.provides ?? []).map((p) => [contractName(p), p]));
    for (const p of before?.provides ?? []) {
      const name = contractName(p);
      const next = now.get(name);
      if (!next) removed.set(c.id, new Set([...(removed.get(c.id) ?? []), name]));
      else if (next.status === "deprecated" && p.status !== "deprecated")
        deprecated.set(c.id, new Set([...(deprecated.get(c.id) ?? []), name]));
    }
  }
  return { removed, deprecated, deprecatedElements };
}

const FIX: [RegExp, string][] = [
  [/^rule\//, "Change it so it follows the rule, or ask the rule's owners for an exception."],
  [
    /^drift\/undeclared-dependency$/,
    "If the dependency is intended, add it to the element's uses in .archdoc/; if not, remove the import.",
  ],
  [/^drift\/stale-/, "Update the element's code paths or snippets."],
  [/^journey\//, "Update the journey's steps to match the model."],
  [/^import\//, "Run archdoc sync."],
  [/^ref\//, "Fix the reference, or run archdoc sync if it's in another repo."],
  [/^data\//, "Fix the data entry or what sends it."],
  [
    /^seal\/(changed|unsealed)$/,
    "Check that the model still describes the code (archdoc check says what changed), update it if not, then archdoc seal the fact.",
  ],
];

const TITLE: [RegExp, (f: MarkedFinding) => string][] = [
  [/^rule\/violation$/, (f) => `Breaks rule ${f.rule ?? ""}`.trim()],
  [/^drift\/undeclared-dependency$/, () => "A dependency the model doesn't declare"],
  [/^drift\/stale-path$/, () => "A code path that matches nothing"],
  [/^drift\/stale-snippet$/, () => "A code snippet that moved"],
  [/^drift\/schema-/, () => "The model and a schema disagree"],
  [/^journey\//, () => "A broken journey"],
  [/^ref\//, () => "A reference that doesn't resolve"],
  [/^import\//, () => "Another repo's model is out of sync"],
  [/^model\/orphan-element$/, () => "An element nothing connects to"],
  [/^data\//, () => "Invalid data"],
  [/^seal\/changed$/, () => "Code changed under the model"],
  [/^seal\/unsealed$/, () => "A new fact no one has checked against its code"],
  [/^seal\/invalid$/, () => "archdoc.sum can't be read"],
];

function concernOf(f: MarkedFinding): Concern {
  const title = TITLE.find(([re]) => re.test(f.code))?.[1](f) ?? f.code;
  const where = f.location ? `${f.location.file}:${f.location.line}` : f.evidence[0];
  return {
    code: f.code,
    title,
    detail: f.message,
    fix:
      f.code === "rule/violation" && f.message.startsWith("The code has")
        ? "Remove the dependency from the code. The rule doesn't allow it, so declaring it in the model won't help; ask the rule's owners if it should be allowed."
        : FIX.find(([re]) => re.test(f.code))?.[1],
    where,
    details: f.details,
    evidence: f.evidence.length ? f.evidence : undefined,
    element: f.element,
    rule: f.rule,
  };
}

/** Fills in the verdict, the concerns, and the people to ask. */
function judge(s: ChangeSummary): ChangeSummary {
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  // Blocking: errors the change introduced, and consumers elsewhere it breaks.
  s.blocking.push(
    ...s.findings.introduced.filter((f) => f.severity === "error").map((f) => concernOf(f)),
  );
  for (const e of s.elsewhere.filter((e) => e.effect === "breaks")) {
    s.blocking.push({
      code: "consumer/breaks",
      title: `Breaks ${e.from} in ${e.namespace}`,
      detail: `${e.from} uses ${e.target}${e.via ? ` through ${e.via}` : ""}, and ${e.why ?? "this change breaks it"}.`,
      fix: "Keep the old contract until they move, or coordinate the change with their owners.",
      element: e.target,
    });
  }

  // Attention: new warnings, sensitive data, critical journeys, consumers elsewhere, suggested facts.
  s.attention.push(
    ...s.findings.introduced.filter((f) => f.severity === "warning").map((f) => concernOf(f)),
  );
  const ruled = s.findings.introduced.filter((f) => f.code === "rule/violation");
  for (const f of s.data.flows) {
    const to = f.flow.to.type === "external" ? f.flow.to.ref : f.flow.to.id;
    // A rule the flow breaks already says it, as a blocking issue.
    if (ruled.some((r) => r.message.includes(f.flow.data) && r.message.includes(to))) continue;
    const fields = f.fields.map((x) => `${x.field} (${x.classification})`).join(", ");
    const from = f.flow.from.type === "external" ? f.flow.from.ref : f.flow.from.id;
    s.attention.push({
      code: "data/sensitive",
      title: f.external
        ? "Sends sensitive data outside the system"
        : "Sends sensitive data somewhere new",
      detail: `${from} now sends ${f.flow.data}, with ${fields}, to ${to}${f.external ? " (external)" : ""}.`,
      element: from,
    });
  }
  for (const st of s.data.stores) {
    s.attention.push({
      code: "data/sensitive",
      title: "Stores sensitive data somewhere new",
      detail: `${st.element} now stores ${st.data} (${st.fields.map((x) => `${x.field} (${x.classification})`).join(", ")}) in ${st.table}.`,
      element: st.element,
    });
  }
  for (const d of s.decisions) {
    const critical = d.journeys.filter((j) => j.importance === "critical");
    const uses = d.journeys.map(
      (j) => `${j.id} (step ${j.step}${j.importance === "critical" ? ", critical" : ""})`,
    );
    s.attention.push({
      code: "logic/changed",
      title: `Changes the decision ${d.id}`,
      detail: `${d.change}${uses.length ? `. Decides ${critical.length ? "critical " : ""}journeys: ${uses.join(", ")}` : ""}.`,
      element: d.element,
    });
  }
  for (const e of s.elsewhere.filter((e) => e.effect === "deprecated")) {
    s.attention.push({
      code: "consumer/deprecated",
      title: `Deprecates what ${e.from} in ${e.namespace} uses`,
      detail: `${e.from} uses ${e.target}${e.via ? ` through ${e.via}` : ""}; ${e.why ?? "it's deprecated"}.`,
      element: e.target,
    });
  }
  if (s.suggested.length) {
    s.attention.push({
      code: "model/suggested",
      title: s.suggested.some((x) => x.endsWith("(inferred)"))
        ? `${plural(s.suggested.length, "fact")} to review`
        : `${plural(s.suggested.length, "fact")} an agent suggested`,
      detail: "Accept or reject them before merging.",
      details: s.suggested.map((x) => x.replace(/`/g, "")),
      fix: "Accept them by removing their provenance block, or delete them.",
    });
  }

  // People: owners approve, other repos' teams know, critical journeys still work.
  const ownedBy = new Map<string, string[]>();
  for (const t of s.touched) {
    for (const o of t.owners) ownedBy.set(o, [...(ownedBy.get(o) ?? []), t.id]);
  }
  // One team owning everything is what CODEOWNERS already says; a change across teams needs each.
  if (ownedBy.size > 1) {
    for (const [o, ids] of ownedBy) {
      s.asks.push({ kind: "approve", who: o, why: `owns ${ids.slice(0, 3).join(", ")}` });
    }
  }
  const repos = new Map<string, PrReport["elsewhere"]>();
  for (const e of s.elsewhere) {
    if (e.reach !== "direct" && e.effect === "affected") continue;
    repos.set(e.namespace, [...(repos.get(e.namespace) ?? []), e]);
  }
  for (const [ns, uses] of repos) {
    const worst = uses.find((u) => u.effect === "breaks") ?? uses[0];
    if (!worst) continue;
    const effect =
      worst.effect === "breaks" ? "breaks" : worst.effect === "deprecated" ? "deprecated" : "uses";
    s.asks.push({
      kind: "inform",
      who: ns,
      why: `${worst.from} ${effect === "uses" ? "uses" : `${effect}:`} ${worst.target}${worst.via ? ` via ${worst.via}` : ""}${uses.length > 1 ? `, and ${uses.length - 1} more` : ""}`,
    });
  }
  // Other repos whose journeys decide with a changed decision should know too.
  for (const d of s.decisions) {
    for (const j of d.journeys) {
      const ns = j.id.includes(".") ? j.id.split(".")[0] : undefined;
      if (!ns || repos.has(ns) || s.asks.some((a) => a.kind === "inform" && a.who === ns)) continue;
      s.asks.push({
        kind: "inform",
        who: ns,
        why: `${j.id} decides with ${d.id} at step ${j.step}`,
      });
    }
  }
  // Passing through a critical journey is common; changing its steps is worth a reviewer's look.
  const critical = s.journeys.filter((j) => j.importance === "critical" && j.stepsChanged);
  for (const j of critical) {
    s.attention.push({
      code: "journey/critical-changed",
      title: `Changes the steps of critical journey ${j.id}`,
      detail: `${j.goal ? `${j.goal}. ` : ""}Check it still works the way the model now says.`,
    });
  }
  for (const j of critical.slice(0, 3)) {
    s.asks.push({
      kind: "verify",
      who: j.namespace ? `${j.namespace}.${j.id}` : j.id,
      why: `${j.goal ? `${j.goal}; ` : ""}critical${j.steps.length ? `, ${stepRange(j.steps)}` : ""}`,
    });
  }
  // Consumers that may be affected are worth a look when they're direct.
  const direct = s.elsewhere.filter((e) => e.reach === "direct" && e.effect === "affected");
  if (direct.length) {
    s.attention.push({
      code: "consumer/affected",
      title: `Used by ${plural(new Set(direct.map((e) => e.namespace)).size, "other repo")}`,
      detail: direct
        .slice(0, 4)
        .map((e) => `${e.from} uses ${e.target}${e.via ? ` via ${e.via}` : ""}`)
        .join("; "),
    });
  }

  // Only something to fix or check earns a comment; touching mapped code alone is info.
  // Suggested facts are a review aid the report lists, not a finding: alone, they don't
  // earn a comment (replaying this repo's PRs, they were the only item on most comments).
  const findings = s.attention.filter((c) => c.code !== "model/suggested");
  s.verdict = s.blocking.length
    ? "blocking"
    : findings.length
      ? "attention"
      : s.touched.length || s.changes
        ? "info"
        : "none";
  const teams = new Set(s.asks.filter((a) => a.kind !== "verify").map((a) => a.who)).size;
  const parts: string[] = [];
  const checks = s.attention.filter((c) => !ASKED_CONCERNS.has(c.code));
  if (s.blocking.length) parts.push(plural(s.blocking.length, "blocking issue"));
  else if (checks.length) parts.push(plural(checks.length, "thing to check", "things to check"));
  if (critical.length)
    parts.push(plural(critical.length, "critical journey changed", "critical journeys changed"));
  if (teams) parts.push(plural(teams, "team to ask", "teams to ask"));
  if (!parts.length) {
    parts.push(
      s.verdict === "none"
        ? "No architectural impact"
        : `Touches ${
            s.touched
              .map((t) => t.id)
              .slice(0, 3)
              .join(", ") || "the model"
          }`,
    );
  }
  s.headline = parts;
  return s;
}

/** 4, 5, 6, 9 as "steps 4–6, 9". */
export function stepRange(steps: number[]): string {
  const sorted = [...new Set(steps)].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i] as number;
    let end = start;
    while (sorted[i + 1] === end + 1) end = sorted[++i] as number;
    runs.push(end > start ? `${start}–${end}` : `${start}`);
  }
  return `step${sorted.length === 1 ? "" : "s"} ${runs.join(", ")}`;
}

const VERDICT_ICON: Record<Verdict, string> = {
  blocking: "⛔",
  attention: "⚠️",
  info: "ℹ️",
  none: "✅",
};

/**
 * The PR comment: the verdict first, then what blocks the merge and how to fix
 * it, who to involve, and only the changed part of the architecture. The rest
 * folds. A change with no architectural impact gets one line.
 */
export function renderPrComment(s: ChangeSummary, input: PrReportInput): string {
  // The Action reads the verdict here, to stay quiet when nothing matters.
  const footer = `<sub>Generated by [ArchDoc](https://github.com/ArchDoc/archdoc)${input.label ? ` for ${input.label}` : ""}.</sub>\n${VERDICT_MARKER}${s.verdict} -->`;
  const head = `${VERDICT_ICON[s.verdict]} **ArchDoc:** ${s.headline.join(" · ")}`;
  const md: string[] = [REPORT_MARKER, head, ""];
  if (s.verdict === "none") {
    md.push(
      s.findings.existing.length
        ? `No model change, and nothing this change touches is in the model. ${s.findings.existing.length} finding${s.findings.existing.length === 1 ? " was" : "s were"} already on the base.`
        : "No model change, and nothing this change touches is in the model.",
      "",
      footer,
    );
    return md.join("\n");
  }

  for (const f of s.fixes) {
    md.push(
      `🩹 Fixes the bug traced in \`${f.id}\`${f.title ? `: ${f.title}` : ""}${f.anchor ? ` (${f.anchor})` : ""}.`,
      "",
    );
  }

  const concern = (c: Concern, alert: "CAUTION" | "WARNING") => {
    md.push(`> [!${alert}]`, `> **${c.title}**`, `> ${c.detail.replace(/\n/g, " ")}`);
    const tail = [c.fix, c.where ? `\`${c.where}\`` : undefined].filter(Boolean).join(" · ");
    if (tail) md.push(`> ${c.fix ? "To fix: " : ""}${tail}`);
    md.push("");
  };
  for (const c of s.blocking.slice(0, 5)) concern(c, "CAUTION");
  if (s.blocking.length > 5)
    md.push(
      `…and ${s.blocking.length - 5} more blocking issues, listed under Drift and rules.`,
      "",
    );

  const checks = s.attention.filter((c) => !ASKED_CONCERNS.has(c.code));
  if (checks.length) {
    md.push("**To check**", "");
    for (const c of checks.slice(0, 8)) {
      md.push(`- **${c.title}.** ${c.detail}${c.where ? ` \`${c.where}\`` : ""}`);
      if (c.code === "model/suggested" && c.details) {
        for (const d of c.details.slice(0, 5)) md.push(`  - ${d}`);
        if (c.details.length > 5)
          md.push(`  - …and ${c.details.length - 5} more, under Suggested facts`);
      }
    }
    if (checks.length > 8) md.push(`- …and ${checks.length - 8} more`);
    md.push("");
  }

  if (s.asks.length) {
    md.push("**Before merging**", "");
    const verb = { approve: "approves", inform: "knows", verify: "still works" };
    for (const a of s.asks) md.push(`- [ ] **${a.who}** ${verb[a.kind]} · ${a.why}`);
    md.push("");
  }

  // Only what changed, not its neighborhood.
  const touched = new Map(s.touched.map((t) => [t.id, t.files]));
  const diagram =
    input.diagrams !== false &&
    (s.changes > 0 || s.elsewhere.some((e) => e.effect !== "affected")) &&
    changeDiagram({
      model: input.model,
      diff: input.diff,
      touched,
      context: false,
      remote: s.elsewhere.filter((e) => e.reach === "direct" && e.effect !== "affected"),
    });
  md.push("**What changed**", "");
  if (diagram) {
    md.push("```mermaid", diagram, "```", "", `<sub>${CHANGE_LEGEND_SHORT}</sub>`, "");
  }
  const list = s.touched
    .sort((a, b) => b.files - a.files || a.id.localeCompare(b.id))
    .map((t) => `\`${t.id}\`${t.files ? ` (${t.files} file${t.files === 1 ? "" : "s"})` : ""}`);
  const touches = list.length
    ? `Touches ${list.slice(0, 6).join(", ")}${list.length > 6 ? `, and ${list.length - 6} more` : ""}${s.owners.length ? `, owned by ${s.owners.join(", ")}` : ""}.`
    : s.changes
      ? "Touches the model only."
      : "Touches no code the model maps.";
  md.push(
    `${touches} ${s.changes ? `In the model: ${summary(input.diff)}.` : "The model didn't change."}`,
    "",
  );
  if (s.resealed.length) {
    const who = [...new Set(s.resealed.map((r) => r.by).filter(Boolean))];
    md.push(
      `Re-checked against changed code${who.length ? ` by ${who.join(", ")}` : ""}: ${s.resealed
        .slice(0, 8)
        .map((r) => `\`${r.key}\``)
        .join(
          ", ",
        )}${s.resealed.length > 8 ? `, and ${s.resealed.length - 8} more` : ""}. Sealing says the model still describes the code; worth a look.`,
      "",
    );
  }
  if (input.explorerUrl)
    md.push(`**[Open this change in the explorer →](${input.explorerUrl})**`, "");

  // The rest, folded.
  const fold = (title: string, body: string[], open = false) => {
    if (!body.length) return;
    md.push(
      `<details${open ? " open" : ""}><summary>${title}</summary>`,
      "",
      ...body,
      "",
      "</details>",
      "",
    );
  };
  if (s.journeys.length) {
    const critical = s.journeys.filter((j) => j.importance === "critical").length;
    const body = [
      "| Journey | Importance | Actor | Steps |",
      "|---|---|---|---|",
      ...s.journeys.map((j) => {
        const imp = j.importance === "critical" ? "**critical**" : j.importance;
        const status = j.status !== "active" ? ` (${j.status})` : "";
        const name = j.namespace ? `${j.namespace}.${j.id} (another repo)` : j.id;
        return `| ${name}${status}: ${j.goal} | ${imp} | ${j.actor} | ${j.steps.join(", ") || "changed"} |`;
      }),
      "",
    ];
    if (s.actors.length) {
      body.push(
        `**Actors affected:** ${s.actors.map((a) => `${a.id} (${a.kind})`).join(", ")}`,
        "",
      );
    }
    if (input.diagrams !== false) body.push(...journeyDiagrams(input, s.journeys));
    fold(
      `Journeys affected (${s.journeys.length}${critical ? `, ${critical} critical` : ""})`,
      body,
    );
  }
  if (s.elsewhere.length) {
    const reachNote = {
      direct: "",
      parent: " (through a parent)",
      indirect: " (uses something that uses it)",
    };
    const body = ["| Consumer | Uses | Effect |", "|---|---|---|"];
    for (const e of s.elsewhere.slice(0, 20)) {
      const effect =
        e.effect === "breaks"
          ? `**breaks**: ${e.why}`
          : e.effect === "deprecated"
            ? `deprecated: ${e.why}`
            : `may be affected${reachNote[e.reach]}`;
      body.push(
        `| \`${e.from}\` (${e.namespace}${e.version ? `@${e.version}` : ""}) | \`${e.target}\`${e.via ? ` via \`${e.via}\`` : ""}${e.description ? `: ${e.description}` : ""} | ${effect} |`,
      );
    }
    if (s.elsewhere.length > 20) body.push("", `…and ${s.elsewhere.length - 20} more.`);
    const from = input.model.landscape
      ? `the landscape ${input.model.landscape.namespace}@${input.model.landscape.version ?? "?"}`
      : "this repo's imports";
    body.push("", `<sub>From ${from}, as synced in archdoc.lock.</sub>`);
    const repos = new Set(s.elsewhere.map((e) => e.namespace)).size;
    fold(`Used by other repos (${repos})`, body);
  }
  const data = dataSection(input.diff, s.data);
  if (data.length) fold("Data", data.slice(2));
  // Findings already shown above as blocking or to check aren't listed again.
  const shown = new Set(
    [...s.blocking.slice(0, 5), ...checks.slice(0, 8)].map((c) => `${c.code}\n${c.detail}`),
  );
  const more = s.findings.introduced.filter((f) => !shown.has(`${f.code}\n${f.message}`));
  if (more.length) {
    fold(`More drift and rules (${more.length} from this change)`, [
      formatFindings(
        more.map(({ introduced: _i, ...f }) => f),
        "markdown",
      ),
    ]);
  }
  if (s.changes) {
    fold(`Model changes (${summary(input.diff)})`, [
      formatDiff(input.diff, "markdown").split("\n").slice(2).join("\n"),
    ]);
  }
  if (s.suggested.length > 5) {
    fold(`Suggested facts to review (${s.suggested.length})`, [
      "An agent suggested these, or archdoc init inferred them (marked). Accept them by removing their `provenance` block, or reject them by deleting them.",
      "",
      ...s.suggested.map((x) => `- ${x}`),
    ]);
  }
  if (s.findings.existing.length) {
    fold(
      `Already on the base (${s.findings.existing.length} finding${s.findings.existing.length === 1 ? "" : "s"}, not from this change)`,
      [
        formatFindings(
          s.findings.existing.map(({ introduced: _i, ...f }) => f),
          "markdown",
        ),
      ],
    );
  }
  md.push(footer);
  return md.join("\n");
}

/** Logic blocks the diff changed, where each runs, and the journeys (here and elsewhere) that decide with it. */
function decisionChanges(
  model: Model,
  diff: ModelDiff,
): {
  id: string;
  element?: string | undefined;
  change: string;
  journeys: { namespace?: string | undefined; journey: JourneyNode; steps: number[] }[];
}[] {
  const out: ReturnType<typeof decisionChanges> = [];
  for (const c of diff.logic) {
    const node = model.logic.get(c.id);
    const runsIn = node?.spec["runs-in"];
    const element = runsIn && model.elements.has(runsIn) ? runsIn : undefined;
    const change =
      c.kind === "changed"
        ? blockChanges("logic", c) || "changed"
        : c.kind === "added"
          ? "added"
          : "removed";
    const journeys: ReturnType<typeof decisionChanges>[number]["journeys"] = [];
    const scan = (m: Model, namespace: string | undefined) => {
      for (const j of m.journeys.values()) {
        const steps: number[] = [];
        j.steps.forEach((step, i) => {
          const ref = step.spec.decides;
          if (ref === c.id || ref === `${model.namespace}.${c.id}`) steps.push(i + 1);
        });
        if (steps.length) journeys.push({ namespace, journey: j, steps });
      }
    };
    scan(model, undefined);
    for (const [ns, other] of otherModels(model)) scan(other.model, ns);
    out.push({ id: c.id, element, change, journeys });
  }
  return out;
}
