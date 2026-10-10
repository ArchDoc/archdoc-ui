import { locate } from "../codemap/codemap.js";
import { countChanges, type ModelDiff, type RelationshipView } from "../diff/diff.js";
import type { Model } from "../model.js";
import { impact } from "../query/impact.js";
import type { MarkedFinding } from "./check-report.js";
import { formatFindings } from "./check-report.js";
import { formatDiff, summary } from "./diff-report.js";
import { CHANGE_LEGEND, changeDiagram, journeyDiagram } from "./mermaid.js";

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
    goal: string;
    actor: string;
    importance: string;
    status: string;
    steps: number[];
  }[];
  actors: { id: string; kind: string }[];
  owners: string[];
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
  for (const [id, files] of touchedFiles) {
    const r = impact(model, id);
    if (!r.ok) continue;
    touched.push({ id, files, owners: r.impact.owners });
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
  const journeyList = [...journeys.values()].sort(
    (a, b) =>
      (IMPORTANCE[a.importance] ?? 2) - (IMPORTANCE[b.importance] ?? 2) || a.id.localeCompare(b.id),
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
    const diagram =
      input.diagrams !== false && changeDiagram({ model, diff, touched: touchedFiles });
    if (diagram) md.push("```mermaid", diagram, "```", "", `<sub>${CHANGE_LEGEND}</sub>`, "");
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
        md.push(
          `| ${j.id}${status}: ${j.goal} | ${imp} | ${j.actor} | ${j.steps.join(", ") || "changed"} |`,
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
    suggested,
    introduced: counts,
    markdown: md.join("\n"),
  };
}

/** The most important affected journeys as sequence diagrams; the first one open. */
function journeyDiagrams(input: PrReportInput, journeys: PrReport["journeys"]): string[] {
  const out: string[] = [];
  for (const j of journeys.slice(0, input.maxJourneyDiagrams ?? 3)) {
    const changes = input.diff.journeys.find((c) => c.id === j.id)?.steps;
    const diagram = journeyDiagram({
      model: input.model,
      journeyId: j.id,
      steps: j.steps,
      changes,
    });
    if (!diagram) continue;
    const where = j.steps.length
      ? `step${j.steps.length === 1 ? "" : "s"} ${j.steps.join(", ")} go${j.steps.length === 1 ? "es" : ""} through this change`
      : "the journey itself changed";
    out.push(
      `<details${out.length ? "" : " open"}><summary><b>${j.id}</b> (${j.importance}): ${where}</summary>`,
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
