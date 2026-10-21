import type { ModelDiff } from "../diff/diff.js";
import type { MarkedFinding } from "./check-report.js";
import { summary as diffSummary } from "./diff-report.js";
import { type ChangeSummary, type Concern, stepRange } from "./pr-report.js";

export interface CheckAnswerOptions {
  /** With a base: the change summary the PR comment renders, and the model diff behind it. */
  change?: { summary: ChangeSummary; diff: ModelDiff; base: string } | undefined;
  /** List every finding, not only what the change introduced (or the first few). */
  all?: boolean | undefined;
}

const ICON = { error: "✗", warning: "!", info: "i" } as const;
const VERDICT = { blocking: "⛔", attention: "⚠️", info: "ℹ️", none: "✓" } as const;
/** Without a base, how many findings to list before counting the rest. */
const LIST = 20;
const DETAILS = 12;

/**
 * What `archdoc check` answers, short enough for an agent to read in one go.
 * With a base: the verdict the PR comment gives, what blocks and what to check
 * (each with its fix), the journeys and people involved, and the model
 * changes; findings already on the base are a count. Without one: every
 * finding, errors first, the rest counted past the first few.
 */
export function formatCheck(findings: MarkedFinding[], options: CheckAnswerOptions = {}): string {
  return options.change
    ? formatChange(findings, options.change, options.all)
    : formatAll(findings, options.all);
}

function formatChange(
  findings: MarkedFinding[],
  change: NonNullable<CheckAnswerOptions["change"]>,
  all: boolean | undefined,
): string {
  const s = change.summary;
  const out: string[] = [`${VERDICT[s.verdict]} ${s.headline.join(" · ")} (since ${change.base})`];
  const section = (title: string, list: Concern[], icon: string) => {
    if (!list.length) return;
    out.push("", `${title} (${list.length})`);
    for (const c of list) {
      out.push(`${icon} ${c.title}: ${c.detail}`);
      for (const d of (c.details ?? []).slice(0, DETAILS)) out.push(`    ${d}`);
      const evidence = (c.evidence ?? []).filter((e) => e !== c.where);
      for (const e of evidence.slice(0, 3)) out.push(`    ${e}`);
      if (evidence.length > 3) out.push(`    … and ${evidence.length - 3} more`);
      // Some messages already say how to fix them.
      if (c.fix && !c.detail.includes(" then ") && !c.detail.includes(", or "))
        out.push(`    → ${c.fix}`);
      if (c.where) out.push(`    at ${c.where}`);
    }
  };
  section("Blocks the merge", s.blocking, ICON.error);
  section("To check", s.attention, ICON.warning);
  for (const f of s.fixes)
    out.push("", `Fixes the bug traced in ${f.id}${f.title ? `: ${f.title}` : ""}.`);

  const facts: string[] = [];
  if (s.journeys.length) {
    const shown = s.journeys
      .slice(0, 5)
      .map(
        (j) =>
          `${j.namespace ? `${j.namespace}.` : ""}${j.id} (${j.importance}, ${stepRange(j.steps)})`,
      );
    const more = s.journeys.length - shown.length;
    facts.push(`Journeys: ${shown.join(", ")}${more > 0 ? `, +${more} more` : ""}`);
  }
  if (s.actors.length) facts.push(`Actors: ${s.actors.map((a) => a.id).join(", ")}`);
  const approve = s.asks.filter((a) => a.kind === "approve").map((a) => a.who);
  const inform = s.asks.filter((a) => a.kind === "inform").map((a) => `${a.who} (${a.why})`);
  if (approve.length) facts.push(`Approves: ${approve.join(", ")}`);
  if (inform.length) facts.push(`Tell: ${inform.join(", ")}`);
  facts.push(s.changes ? `Model: ${diffSummary(change.diff)}` : "Model: unchanged");
  if (s.resealed.length) {
    const who = [...new Set(s.resealed.map((r) => r.by).filter(Boolean))];
    facts.push(
      `Re-checked${who.length ? ` by ${who.join(", ")}` : ""}: ${s.resealed.map((r) => r.key).join(", ")}`,
    );
  }
  out.push("", ...facts);

  const existing = findings.filter((f) => !f.introduced);
  if (all && existing.length) {
    out.push("", `Already on the base (${existing.length})`, ...existing.flatMap(lines));
  } else if (existing.length) {
    out.push("", `Already on the base: ${countByCode(existing)}. Not from this change.`);
  }
  return out.join("\n");
}

function formatAll(findings: MarkedFinding[], all: boolean | undefined): string {
  if (!findings.length) return "✓ No problems: the model is valid and matches the code.";
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const shown = all ? findings : findings.slice(0, LIST);
  const out = [
    `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}.`,
    "",
    ...shown.flatMap(lines),
  ];
  const rest = findings.slice(shown.length);
  if (rest.length) out.push("", `And ${countByCode(rest)}. --all (MCP: all: true) lists them.`);
  return out.join("\n");
}

function lines(f: MarkedFinding): string[] {
  return [
    `${ICON[f.severity]} ${f.code}: ${f.message}`,
    ...(f.details ?? []).slice(0, DETAILS).map((d) => `    ${d}`),
    ...f.evidence
      .filter((e) => !f.location || e !== `${f.location.file}:${f.location.line}`)
      .slice(0, 2)
      .map((e) => `    ${e}`),
    ...(f.location ? [`    at ${f.location.file}:${f.location.line}`] : []),
  ];
}

/** "4 findings (3 drift/stale-path, 1 model/orphan-element)". */
function countByCode(findings: MarkedFinding[]): string {
  const by = new Map<string, number>();
  for (const f of findings) by.set(f.code, (by.get(f.code) ?? 0) + 1);
  const parts = [...by].sort((a, b) => b[1] - a[1]).map(([code, n]) => `${n} ${code}`);
  return `${findings.length} finding${findings.length === 1 ? "" : "s"} (${parts.join(", ")})`;
}
