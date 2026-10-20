import {
  DataRegistry,
  dataFlows,
  lineage,
  type Model,
  qualifyData,
  resolveData,
  type Target,
} from "@archdoc/core/browser";
import { type ReactNode, useMemo } from "react";
import { sensitivity } from "../graph/data.js";

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
        {local
          ? ""
          : ` · in ${registry.models.get(entry.slice(0, entry.indexOf(".")))?.name ?? entry.slice(0, entry.indexOf("."))}`}
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
                    ? `in ${f.journey}, step ${f.step}`
                    : f.how === "sends"
                      ? ""
                      : `${f.how === "carries" ? "on" : "through"} ${f.via}`}
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
