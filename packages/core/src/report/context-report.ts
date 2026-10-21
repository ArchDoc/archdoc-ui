import type { ContextBrief } from "../query/context.js";
import type { EvalReport } from "../query/eval.js";

// The context brief and the eval as text, shared by the CLI and the MCP
// server so a person and an agent read the same words.

const at = (path: string, line?: number) => (line ? `${path}:${line}` : path);

export function formatContext(b: ContextBrief): string {
  const asked = [b.query, ...b.paths.filter((p) => !b.query.includes(p))].filter(Boolean);
  const out = [`Context for "${asked.join(" ")}"`];
  if (b.start.length === 0) {
    out.push(
      "",
      "Nothing in the model or the code matches. Try other words, or a file path; with nothing, archdoc context gives an overview.",
    );
    return out.join("\n");
  }

  // Sections are flush left and entries indented, without blank lines, to stay short.
  out.push("", "Start here");
  for (const s of b.start) {
    const symbol = s.symbol ? ` ${s.symbol}` : "";
    const wired = s.wiredIn?.length
      ? ` · wired in at ${s.wiredIn.map((w) => at(w.path, w.line)).join(", ")}`
      : "";
    out.push(
      `  ${at(s.path, s.line)}${symbol} — ${s.why}${s.element ? ` (${s.element})` : ""}${wired}`,
    );
  }

  if (b.sameJob.length) {
    out.push("Does the same job elsewhere");
    for (const j of b.sameJob) {
      const callers = j.callers.map((c) => at(c.path, c.line)).join(", ");
      const more = j.more ? `, +${j.more} more` : "";
      out.push(
        j.relation === "imports"
          ? `  ${j.symbol} (${j.element ?? j.declaredIn}) is also called from ${callers}${more}`
          : `  ${j.symbol} is called from ${callers}${more}`,
      );
    }
  }

  if (b.data.length) out.push(`Data: ${b.data.map((d) => `${d.id} (${d.how})`).join(", ")}`);
  if (b.rules.length) {
    out.push("Rules");
    for (const r of b.rules) out.push(`  ${r.id}${r.description ? ` — ${r.description}` : ""}`);
  }

  if (b.journeys.length || b.journeysThrough.length) {
    out.push("Journeys");
    for (const j of b.journeys) {
      out.push(
        `  ${j.id} (${j.importance}) · step ${j.steps.join(", ")} names ${j.file} — ${j.goal}`,
      );
    }
    const through = b.journeysThrough;
    if (through.length) {
      const critical = through.filter((j) => j.importance === "critical").map((j) => j.id);
      const ids = b.elements.map((e) => e.id);
      const where = ids.length > 3 ? `${ids.slice(0, 3).join(", ")}, …` : ids.join(", ");
      out.push(
        `  +${through.length} through ${where}${critical.length ? ` (critical: ${critical.join(", ")})` : ""}`,
      );
    }
  }

  if (b.tests.length) {
    out.push("Tests");
    for (const t of b.tests) out.push(`  ${t.path} — ${t.why}`);
  }
  const users = [
    ...b.usedBy.elements,
    ...b.usedBy.actors.map((a) => `${a} (actor)`),
    ...b.usedBy.elsewhere.map((x) => `${x} (another repo)`),
  ];
  if (users.length) {
    out.push(
      `Used by: ${users.slice(0, 8).join(", ")}${users.length > 8 ? `, +${users.length - 8} more` : ""}${b.usedBy.elsewhere.length ? ". Ask before removing or renaming what other repos use." : ""}`,
    );
  }
  if (b.owners.length) out.push(`Owners: ${b.owners.join(", ")}`);
  out.push("", "Next: after editing, run archdoc check --base main");
  return out.join("\n");
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function formatEval(r: EvalReport, verbose = false): string {
  const out: string[] = [];
  if (r.cases.length === 0) {
    return `No commits with source changes to replay${r.skipped ? ` (${r.skipped} skipped)` : ""}.`;
  }
  for (const c of r.cases) {
    out.push(
      `${c.sha.slice(0, 7)} ${c.covered.length}/${c.changed.length} covered, ${c.named.length} in Start here, scope ${c.scope} · ${c.query}`,
    );
    if (verbose) {
      const missed = c.changed.filter((f) => !c.covered.includes(f));
      if (missed.length) out.push(`    missed: ${missed.join(", ")}`);
    }
  }
  out.push(
    "",
    `${r.cases.length} commits replayed${r.skipped ? ` (${r.skipped} with no source changes skipped)` : ""}, ${r.changed} changed source files.`,
    `Recall: ${pct(r.recall)} (${r.covered}/${r.changed}) of changed files are in Start here or under the brief's elements.`,
    `Start-here recall: ${pct(r.startRecall)} (${r.named}/${r.changed}) are named in Start here.`,
    `Median scope: ${r.medianScope} files.`,
    `For comparison, archdoc search (top 3 hits' code paths): recall ${pct(r.baseline.recall)} (${r.baseline.covered}/${r.changed}), median scope ${r.baseline.medianScope} files.`,
    "",
    "Each commit is asked with its subject, using the model and code as they are now.",
  );
  return out.join("\n");
}
