import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import type { MouseEvent } from "react";

export type Emphasis = "normal" | "highlight" | "current" | "dim";

export interface CardData extends Record<string, unknown> {
  family: "actor" | "element" | "external";
  label: string;
  kind: string;
  detail?: string | undefined;
  status?: string | undefined;
  suggested?: boolean;
  hiddenChildren: number;
  isGroup: boolean;
  emphasis: Emphasis;
  selected: boolean;
  onToggle?: (() => void) | undefined;
}

export type CardNode = Node<CardData, "card">;

const ACTOR_ICONS: Record<string, string> = {
  person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0",
  role: "M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z",
  team: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 20a6 6 0 0 1 12 0m-2 0a6 6 0 0 1 10 0",
  organization: "M4 21V5l8-3 8 3v16M9 21v-5h6v5M8 8h2m4 0h2M8 12h2m4 0h2",
  agent: "M5 9h14v10H5zM12 5v4M9 13h.01M15 13h.01M9 16h6M3 13h2m14 0h2",
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
    data.selected ? "is-selected" : "",
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
        {data.status && data.status !== "active" ? (
          <span className="card-status">{data.status}</span>
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
      <div className="card-label" title={data.label}>
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

export const nodeTypes = { card: Card };
