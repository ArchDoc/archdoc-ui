import { BaseEdge, type Edge, type EdgeProps, getSmoothStepPath } from "@xyflow/react";
import type { Point } from "../graph/layout.js";
import { pointAlong, roundedPath } from "../graph/route.js";

export interface RoutedData extends Record<string, unknown> {
  /** The route the layout found, in absolute coordinates. Without one, a smooth step is drawn. */
  points?: Point[] | undefined;
  /** Where along the route the label sits, from 0 to 1. Defaults to the middle. */
  labelAt?: number | undefined;
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
  return (
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
  );
}

export const edgeTypes = { routed: Routed };
