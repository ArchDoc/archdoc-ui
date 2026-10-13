import { describe, expect, it } from "vitest";
import { pointAlong, roundedPath } from "../src/graph/route.js";

const route = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 50 },
];

describe("roundedPath", () => {
  it("runs straight through two points", () => {
    expect(roundedPath(route.slice(0, 2), 10)).toBe("M 0 0 L 100 0");
  });

  it("rounds each corner off", () => {
    expect(roundedPath(route, 10)).toBe("M 0 0 L 90 0 Q 100 0 100 10 L 100 50");
  });

  it("never rounds further than half a short leg", () => {
    const short = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 6 },
    ];
    expect(roundedPath(short, 10)).toBe("M 0 0 L 97 0 Q 100 0 100 3 L 100 6");
  });
});

describe("pointAlong", () => {
  it("finds a point by length along the route", () => {
    expect(pointAlong(route, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAlong(route, 0.5)).toEqual({ x: 75, y: 0 });
    expect(pointAlong(route, 1)).toEqual({ x: 100, y: 50 });
  });

  it("clamps fractions outside 0 to 1", () => {
    expect(pointAlong(route, 2)).toEqual({ x: 100, y: 50 });
    expect(pointAlong(route, -1)).toEqual({ x: 0, y: 0 });
  });
});
