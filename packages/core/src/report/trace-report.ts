import { type Diagnostic, formatDiagnostic } from "../diagnostics.js";
import type { AnchorResult } from "../trace/anchor.js";
import type { TraceCheck, TraceStepView, TraceView } from "../trace/check.js";
import type { TraceEnd } from "../trace/hops.js";
import type { Trace } from "../trace/trace.js";

// Traces as text, shared by `archdoc trace` and the MCP tools.

const ICON = { error: "✗", warning: "!", info: "i" } as const;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function endLabel(e: TraceEnd): string {
  return e.id ?? e.written;
}

/** The result of checking traces: each trace with its findings, then the totals. */
export function formatTraceChecks(
  checks: readonly TraceCheck[],
  problems: readonly Diagnostic[] = [],
): string {
  const out: string[] = [];
  for (const d of problems) out.push(`${ICON[d.severity]} ${formatDiagnostic(d)}`);
  if (problems.length) out.push("");
  if (checks.length === 0 && problems.length === 0) {
    return "No traces. Write one in .archdoc/traces/<id>.yaml when you explain or fix a bug (archdoc trace anchor helps you start).";
  }
  for (const c of checks) {
    const v = c.view;
    const worst = c.findings.some((f) => f.severity === "error")
      ? "✗"
      : c.findings.some((f) => f.severity === "warning")
        ? "!"
        : "✓";
    out.push(`${worst} ${v.id} · ${v.title}`);
    out.push(`    ${summaryLine(v)}`);
    for (const f of c.findings) out.push(`    ${ICON[f.severity]} ${formatDiagnostic(f)}`);
  }
  const all = [...problems, ...checks.flatMap((c) => c.findings)];
  const errors = all.filter((f) => f.severity === "error").length;
  const warnings = all.filter((f) => f.severity === "warning").length;
  out.push(
    "",
    `${plural(checks.length, "trace")}: ${plural(errors, "error")}, ${plural(warnings, "warning")}.`,
  );
  return out.join("\n");
}

function summaryLine(v: TraceView): string {
  const parts: string[] = [];
  const a = v.anchor;
  if (a?.modeled) {
    parts.push(`expands ${a.written} (${endLabel(a.modeled.from)} → ${endLabel(a.modeled.to)})`);
  } else if (a) {
    parts.push(`expands ${a.written}`);
  } else if (v.actor) {
    parts.push(`${endLabel(v.actor)}${v.goal ? `: ${v.goal}` : ""}`);
  }
  parts.push(plural(v.steps.length, "step"));
  if (v.causes.length) parts.push(`cause at step ${v.causes.join(", ")}`);
  if (v.undeclared.length)
    parts.push(`${plural(v.undeclared.length, "hop")} the model doesn't declare`);
  return parts.join(" · ");
}

/** A trace to read: the symptom, the journey step it opens up, every hop with its evidence, and the fix. */
export function formatTrace(v: TraceView): string {
  const out = [`${v.id}: ${v.title}`];
  const a = v.anchor;
  if (a?.modeled) {
    out.push(
      `Opens up ${a.journey} step ${a.step}${a.importance ? ` (${a.importance})` : ""}: ${endLabel(a.modeled.from)} → ${endLabel(a.modeled.to)}${a.modeled.action ? `: ${a.modeled.action}` : ""}`,
    );
    if (a.goal) out.push(`  Journey: ${a.actor ? `${a.actor}: ` : ""}${a.goal}`);
  } else if (a) {
    out.push(`Opens up ${a.written} (${a.status.replace("-", " ")})`);
  } else if (v.actor) {
    out.push(`Actor: ${endLabel(v.actor)}${v.goal ? ` · ${v.goal}` : ""}`);
  }
  out.push(
    "",
    "Symptom:",
    ...v.symptom
      .trimEnd()
      .split("\n")
      .map((l) => `  ${l}`),
  );
  if (v.reproduce) out.push(`Reproduce: ${v.reproduce.trim()}`);
  if (v.diagnosis) out.push(`Diagnosis: ${v.diagnosis.trim()}`);
  out.push("", "What happened:");
  for (const s of v.steps) out.push(...formatStep(s));
  if (v.worksIn) {
    const code = v.worksIn.code.map((c) => c.label).join(", ");
    out.push(
      "",
      `Works in: ${endLabel(v.worksIn.element)}${code ? ` (${code})` : ""}${v.worksIn.note ? `: ${v.worksIn.note.trim()}` : ""}`,
    );
  }
  if (v.fix) out.push("", `Fix: ${v.fix.trim()}`);
  return out.join("\n");
}

const ROLE = {
  ok: "",
  cause: "✗ cause  ",
  spreads: "→ spreads  ",
  symptom: "! symptom  ",
} as const;

function formatStep(s: TraceStepView): string[] {
  const hop =
    s.hop.kind === "undeclared"
      ? " (the model doesn't declare this)"
      : s.hop.kind === "returns" && s.hop.relationship
        ? ` (answers ${s.hop.relationship.from} → ${s.hop.relationship.to})`
        : s.hop.kind === "unverified"
          ? " (in a repo that isn't synced)"
          : s.hop.kind === "unknown"
            ? " (not in the model)"
            : "";
  const outside = s.within === false ? " (outside the journey step)" : "";
  const out = [
    `  ${s.step}. ${ROLE[s.role]}${endLabel(s.from)} → ${endLabel(s.to)}${s.action ? `: ${s.action}` : ""}  [${s.evidence}]${hop}${outside}`,
  ];
  if (s.description) out.push(`     ${s.description.trim()}`);
  for (const c of s.code) {
    out.push(
      `     code: ${c.label}${c.exists === false ? " (not in the repository)" : c.problem ? ` (${c.problem})` : ""}`,
    );
  }
  const keys = [...new Set([...Object.keys(s.observed ?? {}), ...Object.keys(s.expected ?? {})])];
  for (const k of keys) {
    const has = (m: Record<string, unknown> | undefined) => m !== undefined && k in m;
    const observed = has(s.observed) ? show(s.observed?.[k]) : undefined;
    const expected = has(s.expected) ? show(s.expected?.[k]) : undefined;
    out.push(
      `     ${k}: ${observed ?? "?"}${expected !== undefined ? `, expected ${expected}` : ""}`,
    );
  }
  if (s.missing) {
    out.push(
      `     missing: ${endLabel(s.missing.from)} → ${endLabel(s.missing.to)}${s.missing.call ? ` (${s.missing.call})` : ""}, never called${s.missing.description ? `: ${s.missing.description.trim()}` : ""}`,
    );
  }
  return out;
}

function show(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** The traces in a repository, one line each. */
export function formatTraceList(traces: readonly Trace[]): string {
  if (traces.length === 0) return "No traces in .archdoc/traces/.";
  return traces
    .map(
      (t) =>
        `${t.id} · ${t.spec.title}${t.spec.expands ? ` · expands ${t.spec.expands}` : ""} (${t.file})`,
    )
    .join("\n");
}

/** Where an error belongs: the ranked journey steps, the elements, and a trace to start from. */
export function formatAnchors(r: AnchorResult, skeleton?: string, maxReasons = 3): string {
  const out: string[] = [];
  if (r.anchors.length === 0) {
    out.push(
      r.elements.length
        ? "No journey step goes through what the error names."
        : "Nothing in the error maps to the model: no paths or names it knows. Paste the stack trace, or name the files.",
    );
  } else {
    out.push("Where this error belongs, best first:");
    for (const [i, a] of r.anchors.entries()) {
      out.push(
        `  ${i + 1}. ${a.journey}#${a.step} (${a.importance}) · ${a.from} → ${a.to}${a.action ? `: ${a.action}` : ""}`,
      );
      const reasons = [...new Set(a.reasons)];
      for (const reason of reasons.slice(0, maxReasons)) out.push(`     ${reason}`);
      if (reasons.length > maxReasons) out.push(`     … and ${reasons.length - maxReasons} more`);
    }
  }
  if (r.elements.length) {
    out.push("", "Elements in the error:");
    for (const e of r.elements) {
      out.push(
        `  ${e.element} · ${e.evidence.slice(0, 2).join("; ")}${e.evidence.length > 2 ? `; and ${e.evidence.length - 2} more` : ""}`,
      );
    }
  }
  if (r.unmapped.length) out.push("", `Not mapped to an element: ${r.unmapped.join(", ")}`);
  if (skeleton) {
    out.push(
      "",
      "Follow the code from there, then write the trace. A start:",
      "",
      skeleton.trimEnd(),
    );
  }
  return out.join("\n");
}
