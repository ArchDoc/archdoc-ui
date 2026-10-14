import { describe, expect, it } from "vitest";
import { countCrossings, pointAlong, roundedPath } from "../src/graph/route.js";

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

describe("countCrossings", () => {
  const p = (x: number, y: number) => ({ x, y });
  it("counts where different lines cross, not where they meet or bend", () => {
    const across = [p(0, 0), p(100, 100)];
    const back = [p(0, 100), p(100, 0)];
    expect(countCrossings([across, back])).toBe(1);
    // Sharing an end point, like two edges into one port, isn't a crossing.
    expect(
      countCrossings([
        [p(0, 0), p(50, 0)],
        [p(50, 0), p(50, 50)],
      ]),
    ).toBe(0);
    // A line's own bends don't count.
    expect(countCrossings([[p(0, 0), p(50, 0), p(50, 50), p(25, -10)]])).toBe(0);
    // An orthogonal route crossing two others.
    const stair = [p(0, 50), p(50, 50), p(50, 150), p(100, 150)];
    expect(countCrossings([stair, [p(25, 0), p(25, 200)], [p(0, 100), p(100, 100)]])).toBe(3);
  });
});
