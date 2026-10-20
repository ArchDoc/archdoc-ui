import {
  DataRegistry,
  dataFlows,
  type JourneyNode,
  lineage,
  type Model,
  qualifyData,
  resolveData,
  type Simulation,
  type Target,
} from "@archdoc/core/browser";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { sampleSkeleton, sensitivity, stepData } from "../graph/data.js";
import { Payload } from "./Payload.js";

const ROUTINE = new Set(["public", "internal"]);
const name = (t: Target) => (t.type === "external" ? t.ref : t.id);

/** A data entry: fields and classifications, lifecycle, where it's stored and sent, and what maps or decides on it. */
export function DataDetails(props: {
  model: Model;
  /** Qualified, such as payments.Refund. */
  entry: string;
  onSelect: (key: string) => void;
}) {
  const { model, entry } = props;
  const registry = useMemo(() => new DataRegistry(model), [model]);
  const found = registry.entry(entry);
  if (!found) return <p className="muted">No data entry {entry}.</p>;
  const d = found.node;
  const ns = model.namespace;
  const local = entry.startsWith(`${ns}.`);
  const short = (q: string) => (q.startsWith(`${ns}.`) ? q.slice(ns.length + 1) : q);
  const same = (data: string, at = ns) => qualifyData(data, at) === entry;
  const stored = registry.storedIn(entry);
  const flows = dataFlows(model).filter((f) => same(f.data));
  const mappings = registry
    .allMappings()
    .filter(
      (m) =>
        Object.values(m.node.spec.from).some((r) => same(r, m.namespace)) ||
        registry.target(m.node.spec.to, m.namespace)?.entry === entry,
    );
  const decisions = [...registry.models].flatMap(([at, m]) =>
    [...m.logic.values()]
      .filter((l) => Object.values(l.spec.input).some((r) => same(r, at)))
      .map((l) => `${at}.${l.id}`),
  );
  return (
    <div className="details">
      <p className="eyebrow">
        Data · {d.spec.kind}
        {local ? "" : ` · ${entry.slice(0, entry.indexOf("."))}, another repo`}
      </p>
      <h1>{d.spec.name ?? short(entry)}</h1>
      <div className="chips">
        {sensitivity(d).map((c) => (
          <span key={c} className="chip classification">
            {c}
          </span>
        ))}
        {d.spec.status && d.spec.status !== "active" ? (
          <span className="chip">{d.spec.status}</span>
        ) : null}
      </div>
      {d.spec.description ? <p className="lede">{d.spec.description}</p> : null}
      {d.spec.source ? (
        <p className="muted">
          From{" "}
          {Object.entries(d.spec.source).map(([k, v]) => (
            <code key={k}>
              {k} {v}
            </code>
          ))}
        </p>
      ) : null}
      <Block title="Fields">
        <table className="fields">
          <tbody>
            {Object.entries(d.spec.fields ?? {}).map(([field, f]) => (
              <tr key={field}>
                <td>
                  <button
                    type="button"
                    className="link"
                    title="Where its value comes from and goes"
                    onClick={() => props.onSelect(`field:${entry}.${field}`)}
                  >
                    {field}
                  </button>
                </td>
                <td className="muted">
                  {f.type ?? ""}
                  {f.values ? ` (${f.values.join(", ")})` : ""}
                </td>
                <td>
                  {f.classification ? (
                    <span
                      className={`chip small${ROUTINE.has(f.classification) ? "" : " classification"}`}
                    >
                      {f.classification}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Block>
      {d.spec.states?.length ? (
        <Block title="Lifecycle">
          <ul className="plain">
            {d.spec.states.map((s) => (
              <li key={s}>
                <code>{s}</code>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
      {stored.length ? (
        <Block title="Stored in">
          <ul className="link-list">
            {stored.map((s) => (
              <li key={`${s.namespace}.${s.element}.${s.table}`}>
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    props.onSelect(
                      `element:${s.namespace === ns ? s.element : `${s.namespace}.${s.element}`}`,
                    )
                  }
                >
                  {s.namespace === ns ? s.element : `${s.namespace}.${s.element}`}
                </button>
                <span className="muted"> · {s.table}</span>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
      {flows.length ? (
        <Block title="Sent">
          <ul className="plain">
            {flows.map((f) => (
              <li key={`${f.how}${name(f.from)}${name(f.to)}${f.journey ?? ""}${f.step ?? ""}`}>
                {name(f.from)} → {name(f.to)}{" "}
                <span className="muted">
                  {f.how === "step"
                    ? `journey ${f.journey}, step ${f.step}`
                    : f.how === "sends"
                      ? "sends"
                      : `${f.how} through ${f.via}`}
                </span>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
      {mappings.length || decisions.length ? (
        <Block title="Mapped and decided by">
          <ul className="plain">
            {mappings.map((m) => (
              <li key={m.ref}>
                mapping <code>{short(m.ref)}</code>
                <span className="muted"> → {m.node.spec.to}</span>
              </li>
            ))}
            {decisions.map((l) => (
              <li key={l}>
                logic <code>{short(l)}</code>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
    </div>
  );
}

/** A field's lineage as a list, beside the graph on the canvas. */
export function FieldDetails(props: {
  model: Model;
  field: string;
  onSelect: (key: string) => void;
}) {
  const l = useMemo(() => lineage(props.model, props.field), [props.model, props.field]);
  if (!l) return <p className="muted">No data entry for {props.field}.</p>;
  const ns = props.model.namespace;
  const short = (q: string) => (q.startsWith(`${ns}.`) ? q.slice(ns.length + 1) : q);
  const classification = l.classifications.get(`${l.field.entry}.${l.field.field}`);
  const edge = (e: (typeof l.downstream)[number], dir: "up" | "down") => (
    <li key={`${e.mapping}${e.to.entry}${e.to.field}`}>
      <code>
        {short(e.to.entry)}.{e.to.field} = {e.expression}
      </code>
      <span className="muted">
        {" "}
        · {short(e.mapping)}
        {dir === "down" && e.table ? ` → ${e.table.element} (${e.table.table})` : ""}
      </span>
    </li>
  );
  return (
    <div className="details">
      <p className="eyebrow">Field lineage</p>
      <h1>
        {short(l.field.entry)}.{l.field.field}
      </h1>
      {classification ? (
        <div className="chips">
          <span className={`chip${ROUTINE.has(classification) ? "" : " classification"}`}>
            {classification}
          </span>
        </div>
      ) : null}
      <p>
        <button
          type="button"
          className="link"
          onClick={() => props.onSelect(`data:${l.field.entry}`)}
        >
          ← {short(l.field.entry)}
        </button>
      </p>
      <Block title="Comes from">
        {l.upstream.length ? (
          <ul className="plain">{l.upstream.map((e) => edge(e, "up"))}</ul>
        ) : (
          <p className="muted">Nothing a mapping declares.</p>
        )}
      </Block>
      <Block title="Goes to">
        {l.downstream.length ? (
          <ul className="plain">{l.downstream.map((e) => edge(e, "down"))}</ul>
        ) : (
          <p className="muted">Nothing a mapping declares.</p>
        )}
      </Block>
    </div>
  );
}

/** Edit a sample, run the journey against it, and read what each step does to the data. */
export function SimulatePanel(props: {
  model: Model;
  journey: JourneyNode;
  samples: { path: string; text: string }[];
  simulation?: Simulation | undefined;
  /** Run the journey on a sample, named by `label`; undefined runs example data. */
  onSimulate: (sample: Record<string, unknown> | undefined, label: string) => void;
  onStep: (step: number) => void;
}) {
  const { model, journey } = props;
  const skeleton = useMemo(
    () => JSON.stringify(sampleSkeleton(model, journey), null, 2),
    [model, journey],
  );
  const [text, setText] = useState(skeleton);
  // Where the text came from: a sample's path, or "" for example data.
  const [source, setSource] = useState("");
  const [edited, setEdited] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    // A sample named after the journey, as the journey runs it; else example data.
    const named = props.samples.find((s) => (s.path.split("/").pop() ?? "").startsWith(journey.id));
    setText(named?.text ?? skeleton);
    setSource(named?.path ?? "");
    setEdited(false);
    setError(undefined);
  }, [skeleton, props.samples, journey.id]);

  const run = () => {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("Write an object of records by data entry.");
      setError(undefined);
      props.onSimulate(
        parsed as Record<string, unknown>,
        edited ? `${source || "Example data"}, edited` : source || "Example data",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const sim = props.simulation;
  const ns = model.namespace;
  const short = (q: string) => (q.startsWith(`${ns}.`) ? q.slice(ns.length + 1) : q);
  const value = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

  return (
    <Block title="Simulate">
      <p className="muted">
        The records that exist when the journey starts. Nothing runs: the model's logic and mappings
        are evaluated in your browser.
      </p>
      <select
        className="sample-pick"
        aria-label="Sample"
        value={source}
        onChange={(e) => {
          const path = e.target.value;
          setSource(path);
          setEdited(false);
          setText(props.samples.find((s) => s.path === path)?.text ?? skeleton);
        }}
      >
        <option value="">Example data</option>
        {props.samples.map((s) => (
          <option key={s.path} value={s.path}>
            {s.path}
          </option>
        ))}
      </select>
      <textarea
        className="sample"
        spellCheck={false}
        aria-label="Sample records, as JSON"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setEdited(true);
        }}
        rows={10}
      />
      <div className="sample-actions">
        <button type="button" className="btn primary" onClick={run}>
          Run
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            setSource("");
            setEdited(false);
            setText(skeleton);
            props.onSimulate(undefined, "Example data");
          }}
        >
          Reset
        </button>
      </div>
      {error ? <p className="sim-problem">{error}</p> : null}
      {sim ? (
        <ol className="timeline">
          {sim.steps.map((s) => (
            <li key={s.step} className={s.ran ? "" : "is-skipped"}>
              <button
                type="button"
                className="timeline-step"
                onClick={() => props.onStep(s.step - 1)}
              >
                <span className="step-path">
                  {s.step}. {s.from} → {s.to}
                </span>
                {s.ran ? null : <span className="muted"> skipped: {s.skipped}</span>}
              </button>
              {s.decision ? (
                <p className="sim-decision">
                  <code>{short(s.decision.logic)}</code> →{" "}
                  <strong>{s.decision.outcome ?? "no outcome"}</strong>
                  {s.decision.rule ? (
                    <span className="muted">
                      {" "}
                      {s.decision.rule === "else"
                        ? "(else)"
                        : `(rule ${s.decision.rule}: ${s.decision.when})`}
                    </span>
                  ) : null}
                </p>
              ) : null}
              {s.events
                .filter((e) => e.kind !== "sent")
                .map((e) => (
                  <div key={`${e.kind}${e.entry}`} className={`sim-record kind-${e.kind}`}>
                    <p>
                      <span className="sim-mark">{e.kind === "created" ? "+" : "~"}</span>{" "}
                      {short(e.entry)}
                      {e.tables.length ? (
                        <span className="muted">
                          {" "}
                          →{" "}
                          {e.tables
                            .map(
                              (t) =>
                                `${t.namespace === ns ? "" : `${t.namespace}.`}${t.element} (${t.table})`,
                            )
                            .join(", ")}
                        </span>
                      ) : null}
                    </p>
                    <ul>
                      {e.fields.map((f) => (
                        <li key={f.field}>
                          {f.field}: {f.from !== undefined ? <s>{value(f.from)}</s> : null}
                          {f.from !== undefined ? " → " : ""}
                          <strong>{value(f.to)}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              {s.next ? <p className="muted">continues as journey {s.next}</p> : null}
              {s.problems.map((p) => (
                <p key={p} className="sim-problem">
                  {p}
                </p>
              ))}
            </li>
          ))}
        </ol>
      ) : null}
    </Block>
  );
}

const HOW: Record<string, string> = {
  step: "the step says",
  sends: "the relationship sends it",
  accepts: "the API it calls accepts it",
  returns: "the API it calls returns it",
  carries: "the topic carries it",
  writes: "what the step writes",
};

/** The message a journey step carries, opened to its fields, and the records it writes. */
export function StepMessagePanel(props: {
  model: Model;
  journey: JourneyNode;
  index: number;
  /** The step the journey is on: open by default. */
  current: boolean;
  simulation?: Simulation | undefined;
  onSelect: (key: string) => void;
}) {
  const data = useMemo(
    () => stepData(props.model, props.journey, props.index, props.simulation),
    [props.model, props.journey, props.index, props.simulation],
  );
  // The current step's message is open; stepping on closes it again.
  const [open, setOpen] = useState(props.current);
  useEffect(() => setOpen(props.current), [props.current]);
  const msg = data.message;
  if (!msg) {
    return (
      <p
        className="step-message is-missing"
        title="Add sends: to the step, or to the relationship it travels along"
      >
        No message defined
      </p>
    );
  }
  return (
    <div className={`step-message${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="step-message-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="side-chevron" aria-hidden="true">
          ▸
        </span>
        <span className="step-message-name">{msg.entries.map((e) => e.label).join(", ")}</span>
        <span className="muted"> · {HOW[msg.how]}</span>
      </button>
      {open ? (
        <div className="step-message-body">
          <Payload entries={msg.entries} onSelect={props.onSelect} />
          {data.writes.length ? (
            <ul className="step-writes">
              {data.writes.map((w) => (
                <li key={`${w.entry}${w.when ?? ""}${w.created}`}>
                  <span className="sim-mark">{w.created ? "+" : "~"}</span>{" "}
                  {w.entry.startsWith(`${props.model.namespace}.`)
                    ? w.entry.slice(props.model.namespace.length + 1)
                    : w.entry}
                  {w.when ? <span className="muted"> if {w.when}</span> : null}
                  {w.values.size ? (
                    <span className="muted">
                      {" "}
                      {[...w.values].map(([k, v]) => `${k}: ${v}`).join(", ")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="block">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** The entry a data: key names, qualified. */
export function dataEntryOf(model: Model, key: string): string {
  const r = resolveData(model, key);
  return r.status === "found" ? r.ref : key;
}
