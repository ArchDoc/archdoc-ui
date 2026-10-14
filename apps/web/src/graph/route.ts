import type { Point } from "./layout.js";

/** An SVG path through the points, with each corner rounded off. */
export function roundedPath(points: Point[], radius: number): string {
  const [first, ...rest] = points as [Point, ...Point[]];
  let d = `M ${first.x} ${first.y}`;
  for (let i = 0; i < rest.length; i++) {
    const p = rest[i] as Point;
    const prev = (i === 0 ? first : rest[i - 1]) as Point;
    const next = rest[i + 1];
    if (!next) {
      d += ` L ${p.x} ${p.y}`;
      break;
    }
    // Pull back from the corner on both sides, no further than half of either leg.
    const r = Math.min(radius, dist(prev, p) / 2, dist(p, next) / 2);
    const a = toward(p, prev, r);
    const b = toward(p, next, r);
    d += ` L ${a.x} ${a.y} Q ${p.x} ${p.y} ${b.x} ${b.y}`;
  }
  return d;
}

/** The point a fraction of the way along a polyline, by length. */
export function pointAlong(points: Point[], fraction: number): Point {
  const legs = points.slice(1).map((p, i) => dist(points[i] as Point, p));
  let left = legs.reduce((a, b) => a + b, 0) * Math.max(0, Math.min(1, fraction));
  for (let i = 0; i < legs.length; i++) {
    const len = legs[i] as number;
    if (left <= len || i === legs.length - 1) {
      const a = points[i] as Point;
      const b = points[i + 1] as Point;
      const t = len === 0 ? 0 : Math.min(1, left / len);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    left -= len;
  }
  return points[0] as Point;
}

const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const toward = (from: Point, to: Point, by: number): Point => {
  const d = dist(from, to);
  return d === 0
    ? from
    : { x: from.x + ((to.x - from.x) * by) / d, y: from.y + ((to.y - from.y) * by) / d };
};

/**
 * How many times routed lines cross each other: pairs of segments from
 * different lines that intersect, not counting shared ends. Fewer is tidier.
 */
export function countCrossings(routes: Iterable<Point[]>): number {
  const segments: { line: number; a: Point; b: Point }[] = [];
  let line = 0;
  for (const points of routes) {
    for (let i = 1; i < points.length; i++) {
      segments.push({ line, a: points[i - 1] as Point, b: points[i] as Point });
    }
    line++;
  }
  let crossings = 0;
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const s = segments[i] as (typeof segments)[number];
      const t = segments[j] as (typeof segments)[number];
      if (s.line !== t.line && intersects(s.a, s.b, t.a, t.b)) crossings++;
    }
  }
  return crossings;
}

/** Whether two segments cross in their interiors. */
function intersects(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  const eps = 0.5;
  return (
    ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
    ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
  );
}
