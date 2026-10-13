import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import type { MouseEvent } from "react";
import type { RowInfo, TableInfo } from "../graph/graph.js";

export type Emphasis = "normal" | "highlight" | "current" | "dim";

export interface CardData extends Record<string, unknown> {
  family: "actor" | "element" | "external" | "group";
  label: string;
  kind: string;
  detail?: string | undefined;
  status?: string | undefined;
  suggested?: boolean;
  /** A repo's release, for a repo's box in a landscape. */
  version?: string | undefined;
  hiddenChildren: number;
  isGroup: boolean;
  /** In the before/after view: how this changed. */
  change?: "added" | "changed" | "removed" | undefined;
  /** A collapsed box with changes inside. */
  containsChanges?: boolean | undefined;
  emphasis: Emphasis;
  selected: boolean;
  /** The box the current journey step crosses into. */
  entered?: boolean | undefined;
  /** The box stores the selected data entry. */
  stores?: boolean | undefined;
  onToggle?: (() => void) | undefined;
  /** A datastore: show or hide the tables it stores. */
  onTables?: (() => void) | undefined;
  tablesOpen?: boolean | undefined;
  /** An open datastore during a journey: show its schema, or the rows the journey has. */
  storeView?: "erd" | "rows" | undefined;
  onStoreView?: ((view: "erd" | "rows") => void) | undefined;
}

export type CardNode = Node<CardData, "card">;

const ACTOR_ICONS: Record<string, string> = {
  person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0",
  role: "M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z",
  team: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 20a6 6 0 0 1 12 0m-2 0a6 6 0 0 1 10 0",
  organization: "M4 21V5l8-3 8 3v16M9 21v-5h6v5M8 8h2m4 0h2M8 12h2m4 0h2",
  agent: "M5 9h14v10H5zM12 5v4M9 13h.01M15 13h.01M9 16h6M3 13h2m14 0h2",
  repo: "M6 3h10l3 3v15H6zM6 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2M10 8h5M10 12h5",
  domain: "M12 3l9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5",
  data: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
};

function Icon({ kind }: { kind: string }) {
  const d = ACTOR_ICONS[kind];
  if (!d) return null;
  return (
    <svg className="card-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** One card renderer for actors, elements, external references, and groups. */
export function Card({ data }: NodeProps<CardNode>) {
  const classes = [
    "card",
    `family-${data.family}`,
    `kind-${data.kind}`,
    data.isGroup ? "is-group" : "",
    data.status && data.status !== "active" ? `status-${data.status}` : "",
    data.suggested ? "is-suggested" : "",
    `emphasis-${data.emphasis}`,
    data.change ? `change-${data.change}` : "",
    data.containsChanges ? "contains-changes" : "",
    data.selected ? "is-selected" : "",
    data.entered ? "is-entered" : "",
    data.stores ? "is-store" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const toggle = (e: MouseEvent) => {
    e.stopPropagation();
    data.onToggle?.();
  };

  return (
    <div className={classes}>
      <Handle type="target" position={Position.Left} className="handle" />
      <div className="card-head">
        <Icon kind={data.kind} />
        <span className="card-kind">{data.kind}</span>
        {data.version ? <span className="card-version">{data.version}</span> : null}
        {data.change ? (
          <span className={`card-change change-${data.change}`}>{data.change}</span>
        ) : null}
        {data.containsChanges ? (
          <span className="card-change change-changed" title="Something inside changed">
            changes inside
          </span>
        ) : null}
        {data.status && data.status !== "active" ? (
          <span className="card-status">{data.status}</span>
        ) : null}
        {data.onStoreView ? (
          <fieldset className="store-view nodrag" aria-label="Show the schema or the rows">
            {(["erd", "rows"] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={data.storeView === v ? "is-on" : undefined}
                aria-pressed={data.storeView === v}
                onClick={(e) => {
                  e.stopPropagation();
                  data.onStoreView?.(v);
                }}
              >
                {v === "erd" ? "ERD" : "Rows"}
              </button>
            ))}
          </fieldset>
        ) : null}
        {data.onTables ? (
          <button
            type="button"
            className={`card-toggle card-tables nodrag${data.tablesOpen ? " is-on" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              data.onTables?.();
            }}
            title={data.tablesOpen ? "Hide its tables" : "Show its tables"}
            aria-label={
              data.tablesOpen ? `Hide ${data.label}'s tables` : `Show ${data.label}'s tables`
            }
            aria-pressed={data.tablesOpen}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 5h16v14H4zM4 10h16M4 14.5h16M10 10v9" />
            </svg>
          </button>
        ) : null}
        {data.onToggle ? (
          <button
            type="button"
            className="card-toggle nodrag"
            onClick={toggle}
            title={data.isGroup ? "Collapse" : "Expand"}
            aria-label={data.isGroup ? `Collapse ${data.label}` : `Expand ${data.label}`}
          >
            {data.isGroup ? "−" : `+${data.hiddenChildren}`}
          </button>
        ) : null}
      </div>
      <div
        className="card-label"
        title={data.detail && data.isGroup ? `${data.label}: ${data.detail}` : data.label}
      >
        {data.label}
      </div>
      {data.detail && !data.isGroup ? (
        <div className="card-detail" title={data.detail}>
          {data.detail}
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} className="handle" />
    </div>
  );
}

export interface TableData extends Record<string, unknown> {
  table: TableInfo;
  /** The entry as the explorer names it, without this repo's namespace. */
  label: string;
  emphasis: Emphasis;
  /** Fields that point at another table. */
  references: ReadonlySet<string>;
  /** Fields to light up, such as a lineage's. */
  lit?: ReadonlySet<string> | undefined;
  /** What the current journey step writes: a new row, or changed fields, with their values. */
  write?: { created: boolean; values: ReadonlyMap<string, string>; step: number } | undefined;
  onField?: ((field: string) => void) | undefined;
}

export type TableNode = Node<TableData, "table">;

/** A datastore's table, inside it: the entry it stores, and a row per field. */
export function Table({ data }: NodeProps<TableNode>) {
  const { table } = data;
  return (
    <div
      className={`table-card emphasis-${data.emphasis}${data.write ? " is-written" : ""}`}
      key={data.write ? `step-${data.write.step}` : undefined}
    >
      <Handle type="target" position={Position.Left} className="handle" />
      <div className="table-head">
        <span className="table-name">{data.label}</span>
        {data.write ? (
          <span className="table-write">{data.write.created ? "+ new row" : "~ updated"}</span>
        ) : (
          <span className="table-table">{table.table}</span>
        )}
      </div>
      <ul className="table-rows">
        {table.fields.map((f) => (
          <li
            key={f.name}
            className={
              data.write?.values.has(f.name)
                ? "is-written"
                : data.lit?.has(f.name)
                  ? "is-lit"
                  : undefined
            }
          >
            <button
              type="button"
              className="table-row nodrag"
              title={`${f.name}: where its value comes from and goes`}
              onClick={(e) => {
                e.stopPropagation();
                data.onField?.(f.name);
              }}
            >
              <span className="table-mark">
                {f.name === table.key ? "PK" : data.references.has(f.name) ? "FK" : ""}
              </span>
              <span className="table-field">{f.name}</span>
              {f.classification && !ROUTINE.has(f.classification) ? (
                <span className="table-class">{f.classification}</span>
              ) : null}
              <span className="table-type" title={data.write?.values.get(f.name)}>
                {data.write?.values.get(f.name) ?? f.type ?? ""}
              </span>
            </button>
          </li>
        ))}
        {table.fields.length === 0 && !table.hidden ? (
          <li className="table-empty">No fields modeled</li>
        ) : null}
        {table.hidden ? (
          <li className="table-more">
            +{table.hidden} more field{table.hidden === 1 ? "" : "s"}
          </li>
        ) : null}
      </ul>
      <Handle type="source" position={Position.Right} className="handle" />
    </div>
  );
}

const ROUTINE = new Set(["public", "internal"]);

export interface RowData extends Record<string, unknown> {
  row: RowInfo;
  /** The entry, short. */
  label: string;
  /** The fields to show, in order. */
  fields: string[];
  /** Fields that point at another row. */
  references: ReadonlySet<string>;
  emphasis: Emphasis;
}

export type RowNode = Node<RowData, "row">;

/** One record in a datastore during a journey: its key, what it points at, and what just changed. */
export function Row({ data }: NodeProps<RowNode>) {
  const { row } = data;
  const badge = row.isNew
    ? "new"
    : row.changed.size
      ? "changed"
      : row.origin === "existing"
        ? "existing"
        : `step ${(row.step ?? 0) + 1}`;
  return (
    <div
      className={`row-card emphasis-${data.emphasis} origin-${row.origin}${row.isNew ? " is-new" : ""}${row.changed.size ? " is-changed" : ""}`}
      key={`${row.step ?? "x"}-${row.changed.size}`}
      title={JSON.stringify(row.record, null, 2)}
    >
      <Handle type="target" position={Position.Left} className="handle" />
      <div className="row-head">
        <span className="row-name">
          {data.label}
          {row.id ? <span className="row-id"> {row.id}</span> : null}
        </span>
        <span className={`row-badge badge-${badge.split(" ")[0]}`}>{badge}</span>
      </div>
      <ul className="row-fields">
        {data.fields.map((f) => (
          <li key={f} className={row.changed.has(f) ? "is-changed" : undefined}>
            <span className="row-mark">{data.references.has(f) ? "→" : ""}</span>
            <span className="row-field">{f}</span>
            <span className="row-value">{show(row.record[f])}</span>
          </li>
        ))}
      </ul>
      <Handle type="source" position={Position.Right} className="handle" />
    </div>
  );
}

function show(v: unknown): string {
  return v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
}

export const nodeTypes = { card: Card, table: Table, row: Row };
