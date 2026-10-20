import type { Simulation } from "@archdoc/core/browser";
import { type CSSProperties, useEffect, useRef } from "react";
import type { LaneBranch, LaneRow, LaneStep, Lanes as LanesData } from "../model/stories.js";

export interface LanesProps {
  data: LanesData;
  /** The interaction the journey is at. */
  at: number;
  onAt: (at: number) => void;
  /** A run of the journey: steps it skipped fade, and so do the branches it didn't take. */
  simulation?: Simulation | undefined;
}

/**
 * A journey as a story: a column per participant, a row per step with a
 * numbered arrow, and after a decision, a block per outcome with the steps
 * that run for it. Scrolls sideways inside itself when there are many lanes.
 */
export function Lanes({ data, at, onAt, simulation }: LanesProps) {
  const { lanes, rows } = data;
  const ref = useRef<HTMLDivElement>(null);
  // Keep the current step in view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the step changes, to scroll to it.
  useEffect(() => {
    ref.current
      ?.querySelector(".lane-step.is-current")
      ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [at]);
  const style = { "--lanes": lanes.length } as CSSProperties;
  const ran = (step: number) => simulation?.steps[step]?.ran !== false;

  const stepRow = (r: LaneStep) => {
    const lo = Math.min(r.from, r.to);
    const hi = Math.max(r.from, r.to);
    const self = r.from === r.to;
    return (
      <button
        key={r.key ?? `s${r.at}`}
        type="button"
        className={[
          "lane-row lane-step",
          r.at === at ? "is-current" : "",
          r.stores ? "is-store" : "",
          r.tone ? `tone-${r.tone}` : "",
          r.dashed ? "is-dashed" : "",
          ran(r.step) ? "" : "is-skipped",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={() => onAt(r.at)}
        aria-current={r.at === at ? "step" : undefined}
      >
        <span className="lane-num">{r.label}</span>
        <span
          className={`lane-arrow${r.to < r.from ? " is-back" : ""}${self ? " is-self" : ""}`}
          style={{ gridColumn: `${lo + 2} / ${hi + 3}` }}
        >
          <span className="lane-action">
            {r.action}
            {r.tags?.map((t) => (
              <span key={t.label} className={`lane-tag tag-${t.kind}`}>
                {t.label}
              </span>
            ))}
          </span>
          <span className="lane-line" aria-hidden="true" />
          {r.data.length ? (
            <span className="lane-data">
              {r.data.map((d) => (
                <span key={d.entry} className="data-chip" title={d.entry}>
                  {d.label}
                  {d.marks.map((m) => (
                    <span key={m} className="mark-sensitive">
                      {m}
                    </span>
                  ))}
                </span>
              ))}
            </span>
          ) : null}
        </span>
      </button>
    );
  };

  const branchBlock = (b: LaneBranch, state: "taken" | "not-taken" | undefined) => (
    <div key={b.outcome} className={`lane-branch${state ? ` is-${state}` : ""}`}>
      <div className="lane-branch-head">
        <span className="outcome">{b.outcome}</span>
        {b.condition ? (
          <span className="condition">
            {b.condition === "otherwise" ? "otherwise" : <code>when {b.condition}</code>}
          </span>
        ) : null}
        {state === "taken" ? <span className="taken">this sample</span> : null}
      </div>
      {b.rows.map(stepRow)}
      {b.rows.length === 0 ? <p className="lane-branch-note">No steps.</p> : null}
      {b.ends ? (
        <p className="lane-branch-note">
          {b.next ? `Continues as the journey ${b.next}.` : "Ends the journey."}
        </p>
      ) : null}
    </div>
  );

  const row = (r: LaneRow, i: number) => {
    if (r.kind === "step") return stepRow(r);
    if (r.kind === "band") {
      const span =
        r.from !== undefined && r.to !== undefined
          ? { lo: Math.min(r.from, r.to), hi: Math.max(r.from, r.to) }
          : undefined;
      return (
        <div key={r.key} className={`lane-row lane-band band-${r.tone}`}>
          <span className="lane-num" />
          {span && span.lo !== span.hi ? (
            <span
              className={`lane-arrow band-arrow${r.to !== undefined && r.from !== undefined && r.to < r.from ? " is-back" : ""}`}
              style={{ gridColumn: `${span.lo + 2} / ${span.hi + 3}`, gridRow: 1 }}
              aria-hidden="true"
            >
              <span className="lane-line" />
            </span>
          ) : null}
          <p className="band-text">{r.text}</p>
        </div>
      );
    }
    if (r.kind === "decision") {
      const outcome = simulation?.steps[r.step]?.decision?.outcome;
      return (
        <div key={`d${r.step}`} className="lane-row lane-decision">
          <span className="lane-num" />
          <span className="lane-decision-mark">
            <span className="diamond" aria-hidden="true" />
            Decides with <code>{r.logic}</code>
            {outcome ? <span className="taken">→ {outcome}</span> : null}
          </span>
        </div>
      );
    }
    const outcome =
      r.decidedAt !== undefined ? simulation?.steps[r.decidedAt]?.decision?.outcome : undefined;
    return (
      <div key={`b${r.decidedAt ?? "x"}-${i}`} className="lane-branches">
        {r.branches.map((b) =>
          branchBlock(
            b,
            simulation && r.decidedAt !== undefined
              ? b.outcome === outcome
                ? "taken"
                : "not-taken"
              : undefined,
          ),
        )}
      </div>
    );
  };

  return (
    <div className="lanes" ref={ref}>
      <div className="lanes-grid" style={style}>
        <div className="lane-heads">
          <span className="lane-num" />
          {lanes.map((l) => (
            <span key={l.key} className={`lane-head${l.actor ? " is-actor" : ""}`} title={l.key}>
              <span className="lane-name">{l.label}</span>
              {l.sub ? <span className="lane-sub">{l.sub}</span> : null}
            </span>
          ))}
        </div>
        <div className="lane-body">
          <div className="lane-lines" aria-hidden="true">
            <span />
            {lanes.map((l) => (
              <span key={l.key} />
            ))}
          </div>
          {rows.map(row)}
        </div>
      </div>
    </div>
  );
}
