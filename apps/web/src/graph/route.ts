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
