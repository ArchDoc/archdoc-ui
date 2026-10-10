import type { ProvideSpec } from "@archdoc/spec";
import { locate } from "../codemap/codemap.js";
import { countChanges, type ModelDiff, type RelationshipView } from "../diff/diff.js";
import { consumersElsewhere, otherModels } from "../federation/consumers.js";
import { contractName } from "../load/build.js";
import type { Model } from "../model.js";
import { impact } from "../query/impact.js";
import type { MarkedFinding } from "./check-report.js";
import { formatFindings } from "./check-report.js";
import { formatDiff, summary } from "./diff-report.js";
import { CHANGE_LEGEND, changeDiagram, journeyDiagram, type RemoteUse } from "./mermaid.js";

/** Marks the comment so the Action can find and update it. */
export const REPORT_MARKER = "<!-- archdoc-report -->";

export interface PrReportInput {
  /** The model after the change. */
  model: Model;
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
}

export interface PrReport {
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
  suggested: string[];
  introduced: { errors: number; warnings: number };
  markdown: string;
}

const IMPORTANCE: Record<string, number> = { critical: 0, high: 1, normal: 2 };

/**
 * The architectural impact of a change, for a pull request: which elements it
 * touches (from the changed files and the model diff), who owns them, which
 * journeys and actors it affects, what changed in the model, suggested facts
 * waiting for review, and drift the change introduced.
 */
export function prReport(input: PrReportInput): PrReport {
  const { model, diff } = input;

  const touchedFiles = new Map<string, number>();
  for (const file of input.changedFiles) {
    const owner = locate(model, file).element;
    if (owner) touchedFiles.set(owner.id, (touchedFiles.get(owner.id) ?? 0) + 1);
  }
  for (const c of diff.elements) {
    if (c.kind !== "removed" && model.elements.has(c.id) && !touchedFiles.has(c.id))
      touchedFiles.set(c.id, 0);
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
  // New and changed journeys in the model are affected too.
  for (const c of diff.journeys) {
    const j = c.kind !== "removed" ? model.journeys.get(c.id) : undefined;
    if (j && !journeys.has(j.id)) {
      journeys.set(j.id, {
        id: j.id,
        goal: j.spec.goal,
        actor: j.spec.actor,
        importance: j.spec.importance ?? "normal",
        status: j.spec.status ?? "active",
        steps: [],
      });
    }
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
    journeys.set(`${rj.namespace}.${j.id}`, {
      id: j.id,
      namespace: rj.namespace,
      goal: j.spec.goal,
      actor: qualify(j.spec.actor),
      importance: j.spec.importance ?? "normal",
      status: j.spec.status ?? "active",
      steps: rj.steps,
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

  const suggested = [
    ...diff.elements
      .filter(
        (c) =>
          c.kind !== "removed" &&
          (c.after as { provenance?: { source?: string } })?.provenance?.source === "suggested",
      )
      .map((c) => `element \`${c.id}\``),
    ...diff.relationships
      .filter(
        (c) =>
          c.kind !== "removed" &&
          (c.after as RelationshipView & { provenance?: { source?: string } })?.provenance
            ?.source === "suggested",
      )
      .map((c) => {
        const r = c.after as RelationshipView;
        return `\`${ref(r.from)}\` → \`${ref(r.to)}\`${r.description ? `: ${r.description}` : ""}`;
      }),
  ];

  const introduced = input.findings.filter((f) => f.introduced);
  const counts = {
    errors: introduced.filter((f) => f.severity === "error").length,
    warnings: introduced.filter((f) => f.severity === "warning").length,
  };

  const md: string[] = [REPORT_MARKER, "## Architectural impact", ""];
  if (touched.length === 0 && countChanges(diff) === 0) {
    md.push("This change doesn't touch any modeled element or the model itself.");
  } else {
    const list = touched
      .sort((a, b) => b.files - a.files || a.id.localeCompare(b.id))
      .map((t) => `\`${t.id}\`${t.files ? ` (${t.files} file${t.files === 1 ? "" : "s"})` : ""}`);
    md.push(`**Touches:** ${list.join(", ") || "the model only"}`);
    if (owners.size) md.push(`**Owners:** ${[...owners].join(", ")}`);
    md.push("");
    const breaks = elsewhere.filter((e) => e.effect === "breaks");
    const diagram =
      input.diagrams !== false &&
      changeDiagram({
        model,
        diff,
        touched: touchedFiles,
        remote: elsewhere.filter((e) => e.reach === "direct"),
      });
    if (diagram) {
      const legend = breaks.length
        ? `${CHANGE_LEGEND} · red arrow: a consumer in another repo this change breaks`
        : CHANGE_LEGEND;
      md.push("```mermaid", diagram, "```", "", `<sub>${legend}</sub>`, "");
    }
    if (elsewhere.length) {
      const consumers = new Set(elsewhere.map((e) => e.from)).size;
      md.push(`### Used from other repos (${consumers})`, "");
      if (breaks.length) {
        const repos = new Set(breaks.map((b) => b.namespace));
        md.push(
          `> [!WARNING]\n> This change breaks ${breaks.length} consumer${breaks.length === 1 ? "" : "s"} in ${repos.size === 1 ? "another repo" : `${repos.size} other repos`} (${[...repos].join(", ")}). Coordinate with ${repos.size === 1 ? "its owners" : "their owners"} before merging, or keep the old ${breaks.some((b) => b.why?.endsWith("is removed") && b.via) ? "contract" : "element"} until they move.`,
          "",
        );
      }
      md.push("| Consumer | Uses | Effect |", "|---|---|---|");
      const reachNote = {
        direct: "",
        parent: " (through a parent)",
        indirect: " (uses something that uses it)",
      };
      for (const e of elsewhere.slice(0, 20)) {
        const effect =
          e.effect === "breaks"
            ? `**breaks**: ${e.why}`
            : e.effect === "deprecated"
              ? `deprecated: ${e.why}`
              : `may be affected${reachNote[e.reach]}`;
        md.push(
          `| \`${e.from}\` (${e.namespace}${e.version ? `@${e.version}` : ""}) | \`${e.target}\`${e.via ? ` via \`${e.via}\`` : ""}${e.description ? `: ${e.description}` : ""} | ${effect} |`,
        );
      }
      if (elsewhere.length > 20) md.push("", `…and ${elsewhere.length - 20} more.`);
      const from = model.landscape
        ? `the landscape ${model.landscape.namespace}@${model.landscape.version ?? "?"}`
        : "this repo's imports";
      md.push("", `<sub>From ${from}, as synced in archdoc.lock.</sub>`, "");
    }
    if (journeyList.length) {
      md.push(
        `### Journeys affected (${journeyList.length})`,
        "",
        "| Journey | Importance | Actor | Steps |",
        "|---|---|---|---|",
      );
      for (const j of journeyList) {
        const imp = j.importance === "critical" ? "**critical**" : j.importance;
        const status = j.status !== "active" ? ` (${j.status})` : "";
        const name = j.namespace ? `${j.namespace}.${j.id} (another repo)` : j.id;
        md.push(
          `| ${name}${status}: ${j.goal} | ${imp} | ${j.actor} | ${j.steps.join(", ") || "changed"} |`,
        );
      }
      md.push("");
    } else {
      md.push("No journeys pass through what this change touches.", "");
    }
    if (actors.size)
      md.push(
        `**Actors affected:** ${[...actors.values()].map((a) => `${a.id} (${a.kind})`).join(", ")}`,
        "",
      );
    if (input.diagrams !== false) md.push(...journeyDiagrams(input, journeyList));
  }

  md.push("### Drift and rules", "");
  if (counts.errors || counts.warnings) {
    md.push(
      `This change introduces ${counts.errors} error${counts.errors === 1 ? "" : "s"} and ${counts.warnings} warning${counts.warnings === 1 ? "" : "s"}.`,
      "",
    );
    md.push(
      formatFindings(introduced, "markdown").replace(
        /^\*\*Introduced by this change\*\* \(\d+\)\n\n/,
        "",
      ),
    );
  } else {
    md.push("No new drift or rule problems.");
  }
  const existing = input.findings.filter((f) => !f.introduced);
  if (existing.length) {
    md.push(
      "",
      `<details><summary>${existing.length} finding${existing.length === 1 ? "" : "s"} that were already there</summary>`,
      "",
      formatFindings(
        existing.map(({ introduced: _i, ...f }) => f),
        "markdown",
      ),
      "",
      "</details>",
    );
  }
  md.push("");

  md.push("### Model changes", "");
  if (countChanges(diff) === 0) {
    md.push("The model didn't change.");
  } else {
    md.push(
      summary(diff),
      "",
      "<details><summary>Details</summary>",
      "",
      formatDiff(diff, "markdown").split("\n").slice(2).join("\n"),
      "",
      "</details>",
    );
  }
  if (suggested.length) {
    md.push(
      "",
      `### Suggested facts to review (${suggested.length})`,
      "",
      "An agent added these. Accept them by removing their `provenance` block, or reject them by deleting them.",
      "",
      ...suggested.map((s) => `- ${s}`),
    );
  }
  md.push(
    "",
    `<sub>Generated by [ArchDoc](https://github.com/ArchDoc/archdoc)${input.label ? ` for ${input.label}` : ""}.</sub>`,
  );

  return {
    touched,
    journeys: journeyList,
    actors: [...actors.values()],
    owners: [...owners],
    elsewhere,
    suggested,
    introduced: counts,
    markdown: md.join("\n"),
  };
}

/** The most important affected journeys as sequence diagrams; the first one open. */
function journeyDiagrams(input: PrReportInput, journeys: PrReport["journeys"]): string[] {
  const out: string[] = [];
  const others = otherModels(input.model);
  for (const j of journeys.slice(0, input.maxJourneyDiagrams ?? 3)) {
    const changes = j.namespace ? undefined : input.diff.journeys.find((c) => c.id === j.id)?.steps;
    const owner = j.namespace ? others.get(j.namespace)?.model : input.model;
    const diagram =
      owner && journeyDiagram({ model: owner, journeyId: j.id, steps: j.steps, changes });
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
