import type { JourneyNode, Model, Simulation } from "@archdoc/core/browser";
import { useMemo } from "react";
import type { Interaction } from "../graph/data.js";
import { repoName, repoOf, stepUses, targetLabel } from "../model/stories.js";
import type { LandscapeInfo } from "../model/useModel.js";
import { type CodeContext, StepCode } from "./code.js";
import { Payload, type PayloadEntry } from "./Payload.js";

/** A sample the journey can run on. */
export interface SampleChoice {
  key: string;
  label: string;
  title?: string | undefined;
}

export interface StepPanelProps {
  model: Model;
  journey: JourneyNode;
  interactions: readonly Interaction[];
  at: number;
  onAt: (at: number) => void;
  /** What the current interaction carries or writes, with the simulated values. */
  payload: PayloadEntry[];
  simulation?: Simulation | undefined;
  samples: SampleChoice[];
  sample?: string | undefined;
  onSample: (key: string) => void;
  code: CodeContext;
  landscape?: LandscapeInfo | undefined;
  onSelect: (key: string) => void;
  /** On the map: how the datastores the journey writes to are shown. */
  stores?: { id: string; name: string; view: "erd" | "rows"; all: boolean }[] | undefined;
  onStoreView?: ((id: string, view: "erd" | "rows") => void) | undefined;
  onShowAll?: ((id: string, on: boolean) => void) | undefined;
}

/** The current step of the open journey, and nothing else: what happens, what it carries, and where its code is. */
export function StepPanel(props: StepPanelProps) {
  const { model, journey, interactions, at, simulation, landscape } = props;
  const x = interactions[at];
  const step = x ? journey.steps[x.step] : undefined;
  const uses = useMemo(() => (x ? stepUses(model, x.from, x.to) : undefined), [model, x]);
  if (!x || !step) {
    return (
      <div className="details">
        <p className="muted">This journey has no steps the model can draw.</p>
      </div>
    );
  }
  const repos = [repoOf(model, x.from, landscape), repoOf(model, x.to, landscape)].map((r) =>
    r ? repoName(model, r, landscape) : undefined,
  );
  const where =
    repos[0] && repos[1] && repos[0] !== repos[1]
      ? `from ${repos[0]} → ${repos[1]}`
      : repos[1] || repos[0]
        ? `in ${repos[1] ?? repos[0]}`
        : "";
  const sim = simulation?.steps[x.step];
  const ns = `${model.namespace}.`;
  const short = (e: string) => (e.startsWith(ns) ? e.slice(ns.length) : e);
  const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
  const contract = uses?.via ?? uses?.technology ?? uses?.transport;
  const last = at >= interactions.length - 1;

  return (
    <div className="details step-panel">
      <p className="step-where">
        Step {x.label} of {journey.steps.length}
        {where ? ` · ${where}` : ""}
      </p>
      <h2 className="step-title" aria-live="polite">
        {x.action ?? `Sends ${props.payload.map((p) => p.label).join(", ")}`}
      </h2>
      <p className="step-ends">
        <button type="button" className="link" onClick={() => props.onSelect(keyOf(x.from))}>
          {targetLabel(model, x.from)}
        </button>
        <span className="arrow"> → </span>
        <button type="button" className="link" onClick={() => props.onSelect(keyOf(x.to))}>
          {targetLabel(model, x.to)}
        </button>
        {contract ? (
          <span className="contract" title="The contract it goes through">
            {" "}
            via <code>{contract}</code>
          </span>
        ) : null}
      </p>
      {step.spec.description ? <p className="lede">{step.spec.description}</p> : null}
      {step.spec.when && !x.store ? (
        <p className="step-note">
          Runs when the decision says <strong>{step.spec.when}</strong>.
          {sim && !sim.ran ? ` This sample skips it: ${sim.skipped}` : ""}
        </p>
      ) : null}
      {sim?.decision && !x.store ? (
        <p className="step-note">
          <code>{short(sim.decision.logic)}</code> decides{" "}
          <strong>{sim.decision.outcome ?? "nothing"}</strong>
          {sim.decision.rule ? (
            <span className="muted">
              {" "}
              {sim.decision.rule === "else" ? "(otherwise)" : `(when ${sim.decision.when})`}
            </span>
          ) : null}
        </p>
      ) : null}

      {props.payload.length ? (
        <section className="block">
          <h3>{x.store ? "What it stores" : "What it sends"}</h3>
          <Payload key={x.label} entries={props.payload} onSelect={props.onSelect} />
        </section>
      ) : (
        <p className="muted" title="Add sends: to the step, or to the use it travels along">
          The model doesn't say what this step sends.
        </p>
      )}

      {sim?.ran &&
      sim.events.some((e) => e.kind !== "sent" && (!x.store || x.writes.includes(e.entry))) ? (
        <section className="block">
          <h3>What it writes</h3>
          {sim.events
            .filter((e) => e.kind !== "sent" && (!x.store || x.writes.includes(e.entry)))
            .map((e) => (
              <div key={`${e.kind}${e.entry}`} className={`sim-record kind-${e.kind}`}>
                <p>
                  <span className="sim-mark">{e.kind === "created" ? "+" : "~"}</span>{" "}
                  {e.kind === "created" ? "New" : "Changed"} {short(e.entry)}
                  {e.tables.length ? (
                    <span className="muted">
                      {" "}
                      in{" "}
                      {e.tables
                        .map(
                          (t) =>
                            `${t.namespace === model.namespace ? "" : `${t.namespace}.`}${t.element} (${t.table})`,
                        )
                        .join(", ")}
                    </span>
                  ) : null}
                </p>
                <ul>
                  {e.fields.map((f) => (
                    <li key={f.field}>
                      {f.field}: {f.from !== undefined ? <s>{show(f.from)}</s> : null}
                      {f.from !== undefined ? " → " : ""}
                      <strong>{show(f.to)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </section>
      ) : null}
      {sim?.next ? <p className="step-note">Continues as the journey {sim.next}.</p> : null}
      {sim?.problems.map((p) => (
        <p key={p} className="sim-problem">
          {p}
        </p>
      ))}

      {step.spec.code ? (
        <section className="block">
          <h3>Code</h3>
          <StepCode step={step} ctx={props.code} />
        </section>
      ) : null}

      {props.samples.length > 1 ? (
        <section className="block samples">
          <h3>Try a sample</h3>
          <div className="sample-chips">
            {props.samples.map((s) => (
              <button
                key={s.key}
                type="button"
                className={`chip-button${props.sample === s.key ? " is-on" : ""}`}
                aria-pressed={props.sample === s.key}
                title={s.title}
                onClick={() => props.onSample(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="muted small">
            The journey runs on it in your browser: the model's logic picks the branch.
          </p>
        </section>
      ) : null}

      {props.stores?.length ? (
        <section className="block">
          <h3>Datastores on the map</h3>
          {props.stores.map((st) => (
            <fieldset
              key={st.id}
              className="journey-store"
              aria-label={`${st.name}: schema or rows`}
            >
              <span>{st.name}</span>
              <span className="store-view">
                {(["erd", "rows"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={st.view === v ? "is-on" : undefined}
                    aria-pressed={st.view === v}
                    onClick={() => props.onStoreView?.(st.id, v)}
                  >
                    {v === "erd" ? "ERD" : "Rows"}
                  </button>
                ))}
              </span>
              <label className="journey-store-all">
                <input
                  type="checkbox"
                  checked={st.all}
                  onChange={(e) => props.onShowAll?.(st.id, e.currentTarget.checked)}
                />{" "}
                All tables
              </label>
            </fieldset>
          ))}
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
          {at + 1} / {interactions.length}
        </span>
        <button
          type="button"
          className="btn primary"
          disabled={last}
          onClick={() => props.onAt(at + 1)}
        >
          Next →
        </button>
      </nav>
    </div>
  );
}

function keyOf(t: Interaction["from"]): string {
  return t.type === "external" ? `external:${t.ref}` : `${t.type}:${t.id}`;
}
