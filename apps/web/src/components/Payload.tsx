import { useState } from "react";
import type { FieldInfo } from "../graph/data.js";

/** One record a step sends or writes, as the inspector shows it. */
export interface PayloadEntry {
  /** Qualified entry. */
  entry: string;
  label: string;
  kind?: string | undefined;
  /** The fields the model declares, in order. */
  fields: FieldInfo[];
  /** The record as simulated. */
  record?: Record<string, unknown> | undefined;
  /** Fields the step set or changed. */
  changed?: ReadonlySet<string> | undefined;
}

/** Classifications that don't need a reviewer's attention. */
const ROUTINE = new Set(["public", "internal"]);

/**
 * The data a journey step sends from one element to another, or writes: every
 * value in the simulated record, by field, or as JSON to copy. Sensitive fields
 * are marked, and so are values the model doesn't declare.
 */
export function Payload(props: {
  entries: PayloadEntry[];
  onSelect?: ((key: string) => void) | undefined;
}) {
  const [index, setIndex] = useState(0);
  const [view, setView] = useState<"fields" | "json">("fields");
  const [copied, setCopied] = useState(false);
  const e = props.entries[Math.min(index, props.entries.length - 1)];
  if (!e) return null;
  const declared = new Set(e.fields.map((f) => f.name));
  const extra = Object.keys(e.record ?? {}).filter((k) => !declared.has(k));
  const json = JSON.stringify(e.record ?? {}, null, 2);
  return (
    <div className="payload">
      <div className="payload-bar">
        {props.entries.length > 1 ? (
          <span className="payload-entries" role="tablist" aria-label="Records">
            {props.entries.map((x, i) => (
              <button
                key={x.entry}
                type="button"
                role="tab"
                aria-selected={x === e}
                className={x === e ? "is-on" : undefined}
                onClick={() => setIndex(i)}
              >
                {x.label}
              </button>
            ))}
          </span>
        ) : (
          <span className="payload-name">
            {props.onSelect ? (
              <button
                type="button"
                className="link"
                onClick={() => props.onSelect?.(`data:${e.entry}`)}
              >
                {e.label}
              </button>
            ) : (
              e.label
            )}
            {e.kind ? <span className="muted"> {e.kind}</span> : null}
          </span>
        )}
        <span className="store-view">
          {(["fields", "json"] as const).map((v) => (
            <button
              key={v}
              type="button"
              className={view === v ? "is-on" : undefined}
              aria-pressed={view === v}
              onClick={() => setView(v)}
            >
              {v === "fields" ? "Fields" : "JSON"}
            </button>
          ))}
        </span>
      </div>
      {view === "json" ? (
        <div className="payload-json">
          <pre>{json}</pre>
          <button
            type="button"
            className="btn small"
            onClick={() => {
              void navigator.clipboard?.writeText(json).then(
                () => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                },
                () => {},
              );
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : (
        <table className="payload-fields">
          {e.record ? null : (
            <caption className="muted">Not in the sample: the fields, without values.</caption>
          )}
          <tbody>
            {e.fields.map((f) => (
              <tr key={f.name} className={e.changed?.has(f.name) ? "is-changed" : undefined}>
                <th scope="row">
                  {props.onSelect ? (
                    <button
                      type="button"
                      className="link"
                      title="Where this field comes from and goes"
                      onClick={() => props.onSelect?.(`field:${e.entry}.${f.name}`)}
                    >
                      {f.name}
                    </button>
                  ) : (
                    f.name
                  )}
                  {f.classification && !ROUTINE.has(f.classification) ? (
                    <span className="chip small classification">{f.classification}</span>
                  ) : null}
                </th>
                <td>
                  {e.record && f.name in e.record ? (
                    <Value value={e.record[f.name]} />
                  ) : e.record ? (
                    <span className="muted" title={f.type}>
                      not set
                    </span>
                  ) : (
                    <span className="muted">{f.type ?? ""}</span>
                  )}
                </td>
              </tr>
            ))}
            {extra.map((k) => (
              <tr key={k} className="is-undeclared">
                <th scope="row" title="The sample has it, but the model doesn't declare it">
                  {k} <span className="muted">· not in the model</span>
                </th>
                <td>
                  <Value value={e.record?.[k]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** A value, by its type; objects and lists open to their items. */
function Value({ value }: { value: unknown }) {
  if (value === null) return <span className="v-null">null</span>;
  if (typeof value === "string") return <span className="v-str">"{value}"</span>;
  if (typeof value === "number") return <span className="v-num">{value}</span>;
  if (typeof value === "boolean") return <span className="v-bool">{String(value)}</span>;
  if (typeof value === "object") {
    const items = Object.entries(value as Record<string, unknown>);
    const list = Array.isArray(value);
    return (
      <details className="v-obj">
        <summary>
          {list ? `${items.length} item${items.length === 1 ? "" : "s"}` : `{ ${items.length} }`}
        </summary>
        <dl>
          {items.map(([k, v]) => (
            <div key={k}>
              <dt>{list ? `[${k}]` : k}</dt>
              <dd>
                <Value value={v} />
              </dd>
            </div>
          ))}
        </dl>
      </details>
    );
  }
  return <span className="muted">{String(value)}</span>;
}
