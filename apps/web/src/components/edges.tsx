import { BaseEdge, type Edge, type EdgeProps, getSmoothStepPath } from "@xyflow/react";
import type { Point } from "../graph/layout.js";
import { pointAlong, roundedPath } from "../graph/route.js";

export interface RoutedData extends Record<string, unknown> {
  /** The route the layout found, in absolute coordinates. Without one, a smooth step is drawn. */
  points?: Point[] | undefined;
  /** Where along the route the label sits, from 0 to 1. Defaults to the middle. */
  labelAt?: number | undefined;
  /** A message travelling the edge, such as the current journey step's. */
  packet?: { label: string; missing?: boolean | undefined } | undefined;
}

export type RoutedEdge = Edge<RoutedData, "routed">;

/** An edge drawn along the layout's orthogonal route, with rounded corners. */
export function Routed(props: EdgeProps<RoutedEdge>) {
  const points = props.data?.points;
  let path: string;
  let at: Point;
  if (points && points.length >= 2) {
    path = roundedPath(points, 10);
    at = pointAlong(points, props.data?.labelAt ?? 0.5);
  } else {
    const [d, x, y] = getSmoothStepPath({ ...props, borderRadius: 10 });
    path = d;
    at = { x, y };
  }
  const packet = props.data?.packet;
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        style={props.style}
        label={props.label}
        labelX={at.x}
        labelY={at.y}
        labelStyle={props.labelStyle}
        labelShowBg={props.labelShowBg}
        labelBgStyle={props.labelBgStyle}
        labelBgPadding={props.labelBgPadding}
        labelBgBorderRadius={props.labelBgBorderRadius}
        interactionWidth={props.interactionWidth}
      />
      {packet ? <Packet path={path} at={at} {...packet} /> : null}
    </>
  );
}

/** A chip with the message's name, moving along the edge from source to target. */
function Packet(props: { path: string; at: Point; label: string; missing?: boolean | undefined }) {
  const width = Math.min(220, props.label.length * 7 + 22);
  const still =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  return (
    <g
      className={`packet${props.missing ? " is-missing" : ""}`}
      transform={still ? `translate(${props.at.x} ${props.at.y - 18})` : undefined}
    >
      {still ? null : (
        <animateMotion
          dur="2.4s"
          repeatCount="indefinite"
          path={props.path}
          keyPoints="0;1"
          keyTimes="0;1"
          calcMode="linear"
        />
      )}
      <g transform={still ? undefined : "translate(0 -14)"}>
        <rect x={-width / 2} y={-10} width={width} height={20} rx={10} />
        <text textAnchor="middle" dominantBaseline="central">
          {props.label}
        </text>
      </g>
    </g>
  );
}

export const edgeTypes = { routed: Routed };
