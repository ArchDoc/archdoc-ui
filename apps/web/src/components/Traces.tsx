import type { Diagnostic, Model, TraceCheck, TraceCodeView } from "@archdoc/core/browser";
import { formatDiagnostic } from "@archdoc/core/browser";
import { useMemo } from "react";
import { endLabel, hopText, observedExpected, traceChips, traceLanes } from "../model/traces.js";
import type { LandscapeInfo } from "../model/useModel.js";
import { type CodeContext, linkTarget, PathLinks } from "./code.js";
import { Lanes } from "./Lanes.js";

/** The traces, worst first is the author's call: listed as written, with where each opens up. */
export function TraceList(props: {
  checks: TraceCheck[];
  problems: Diagnostic[];
  traceId?: string | undefined;
  onTrace: (id: string) => void;
}) {
  return (
    <nav className="side-list" aria-label="Traces">
      <h2 className="side-title">Traces</h2>
      {props.checks.map((c) => (
        <button
          key={c.view.id}
          type="button"
          className={`side-item${props.traceId === c.view.id ? " is-active" : ""}`}
          aria-current={props.traceId === c.view.id ? "true" : undefined}
          onClick={() => props.onTrace(c.view.id)}
        >
          <span className="side-item-label">
            {c.view.title}
            <span className="side-item-sub">
              {c.view.anchor ? `${c.view.anchor.journey} · step ${c.view.anchor.step}` : c.view.id}
            </span>
          </span>
        </button>
      ))}
      {props.problems.length ? (
        <div className="trace-problems">
          <p className="muted small">Files the explorer couldn't read as traces:</p>
          <ul>
            {props.problems.map((d) => (
              <li key={formatDiagnostic(d)}>
                <code>{formatDiagnostic(d)}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </nav>
  );
}

/**
 * A trace: the log the agent was given and the diagnosis, then the run as
 * lanes beneath the journey step it opens up, with the cause marked.
 */
export function TraceStory(props: {
  model: Model;
  check: TraceCheck;
  at: number;
  onAt: (at: number) => void;
  landscape?: LandscapeInfo | undefined;
}) {
  const { model, check, landscape } = props;
  const v = check.view;
  const lanes = useMemo(() => traceLanes(model, v, landscape), [model, v, landscape]);
  return (
    <section className="story trace-story" aria-label="Trace">
      <header className="trace-head">
        <h1>{v.title}</h1>
        <div className="trace-head-grid">
          <div className="trace-log">
            <p className="trace-log-label">What you gave the agent</p>
            <pre>{v.symptom.trimEnd()}</pre>
            {v.reproduce ? (
              <p className="trace-reproduce">
                <span aria-hidden="true">$ </span>
                <code>{v.reproduce}</code>
              </p>
            ) : null}
          </div>
          <div className="trace-diagnosis">
            <div className="chips">
              {traceChips(v).map((c) => (
                <span key={c.label} className={`chip trace-chip chip-${c.kind}`}>
                  {c.label}
                </span>
              ))}
            </div>
            {v.diagnosis ? <p>{v.diagnosis}</p> : <p className="muted">No diagnosis yet.</p>}
            {v.fix ? (
              <p className="trace-fix">
                <strong>Fix:</strong> {v.fix}
              </p>
            ) : null}
          </div>
        </div>
      </header>
      <div className="story-body">
        <Lanes data={lanes} at={props.at} onAt={props.onAt} />
      </div>
    </section>
  );
}

/** The selected hop: what it does, its code, what was observed and expected, and how sure. */
export function TraceStepPanel(props: {
  model: Model;
  check: TraceCheck;
  at: number;
  onAt: (at: number) => void;
  code: CodeContext;
}) {
  const { model, check, at } = props;
  const v = check.view;
  const s = v.steps[at];
  if (!s) return <div className="details" />;
  const rows = observedExpected(s);
  const findings = check.findings;
  return (
    <div className="details step-panel">
      <p className="step-where">
        Step {s.step} of {v.steps.length}
        {v.anchor?.modeled && s.within ? ` · inside step ${v.anchor.step}` : ""}
      </p>
      <h2 className="step-title">
        {s.action ?? `${endLabel(model, s.from)} → ${endLabel(model, s.to)}`}
      </h2>
      <p className="step-ends">
        {endLabel(model, s.from)}
        <span className="arrow"> → </span>
        {endLabel(model, s.to)}
      </p>
      <div className="chips">
        {s.role !== "ok" ? (
          <span className={`chip trace-chip role-${s.role}`}>
            {s.role === "symptom" ? "symptom: matches your log" : s.role}
          </span>
        ) : null}
        <span className={`chip trace-chip evidence-${s.evidence}`} title={EVIDENCE[s.evidence]}>
          {s.evidence}
        </span>
        {s.hop.kind === "undeclared" ? (
          <span className="chip trace-chip chip-undeclared">not in the model</span>
        ) : null}
      </div>
      <p className="muted small">{hopText(model, s)}</p>
      {s.description ? <p className="lede">{s.description}</p> : null}

      {rows.length ? (
        <section className="block">
          <h3>Observed and expected</h3>
          <table className="observed">
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col">Observed</th>
                <th scope="col">Expected</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <th scope="row">
                    <code>{r.key}</code>
                  </th>
                  <td
                    className={
                      r.expected !== undefined && r.observed !== r.expected ? "is-wrong" : undefined
                    }
                  >
                    <code>{r.observed ?? "—"}</code>
                  </td>
                  <td>
                    <code>{r.expected ?? "—"}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {s.missing ? (
        <section className="block">
          <h3>Missing</h3>
          <p>
            {endLabel(model, s.missing.from)} should call{" "}
            {s.missing.call ? <code>{s.missing.call}</code> : null} in{" "}
            {endLabel(model, s.missing.to)}
            {s.missing.description ? `: ${s.missing.description}` : ""}.
          </p>
        </section>
      ) : null}

      {s.code.length ? (
        <section className="block">
          <h3>Code</h3>
          <CodeRefs refs={s.code} ctx={props.code} />
        </section>
      ) : null}

      {v.worksIn && at === v.steps.length - 1 ? (
        <section className="block">
          <h3>Same job, done right</h3>
          <p>
            {endLabel(model, v.worksIn.element)}
            {v.worksIn.note ? ` ${v.worksIn.note}` : ""}
          </p>
          <CodeRefs refs={v.worksIn.code} ctx={props.code} />
        </section>
      ) : null}

      {findings.length ? (
        <section className="block">
          <h3>What the check found</h3>
          <ul className="trace-findings">
            {findings.map((f) => (
              <li
                key={`${f.code}${f.message}`}
                className={`sev-${f.severity}${f.step === s.step ? " is-here" : ""}`}
              >
                {f.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <nav className="step-nav" aria-label="Steps">
        <button
          type="button"
          className="btn"
          disabled={at === 0}
          onClick={() => props.onAt(at - 1)}
        >
          ← Back
        </button>
        <span className="muted">
          {at + 1} / {v.steps.length}
        </span>
        <button
          type="button"
          className="btn primary"
          disabled={at >= v.steps.length - 1}
          onClick={() => props.onAt(at + 1)}
        >
          Next →
        </button>
      </nav>
    </div>
  );
}

const EVIDENCE = {
  reproduced: "Seen in a run",
  read: "Followed in the code",
  inferred: "Neither run nor read: a guess",
} as const;

/** A trace's code references, linked like an element's code. */
function CodeRefs({ refs, ctx }: { refs: TraceCodeView[]; ctx: CodeContext }) {
  return (
    <ul className="code-list">
      {refs.map((c) => {
        const t = linkTarget(c.path, ctx.files);
        return (
          <li key={c.label}>
            {c.exists === false ? (
              <span className="code-missing">
                No file <code>{c.path}</code>
              </span>
            ) : (
              <>
                <code>{c.label}</code>
                {c.problem ? (
                  <span className="code-missing">{c.problem}</span>
                ) : (
                  <PathLinks repo={ctx.repo} path={t.path} isFile={t.isFile} lines={c.lines} />
                )}
              </>
            )}
            {c.description ? <p>{c.description}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}
