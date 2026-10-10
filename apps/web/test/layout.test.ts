import { readFileSync } from "node:fs";
import { buildModel, type Model } from "@archdoc/core/browser";
import { describe, expect, it } from "vitest";
import { buildGraph, defaultExpanded, type Graph } from "../src/graph/graph.js";
import { type Box, layoutGraph, NODE_HEIGHT, NODE_WIDTH } from "../src/graph/layout.js";
import { ridesModel } from "./fixtures.js";

const example = (name: string): Model =>
  buildModel([
    {
      path: `${name}.yaml`,
      text: readFileSync(new URL(`../../../examples/${name}.yaml`, import.meta.url), "utf8"),
    },
  ]);

/** Absolute boxes, so overlap checks work across groups. */
function absolute(graph: Graph, boxes: Map<string, Box>): Map<string, Box> {
  const out = new Map<string, Box>();
  const resolve = (id: string): Box => {
    const known = out.get(id);
    if (known) return known;
    const box = boxes.get(id) as Box;
    const parent = graph.nodes.find((n) => n.id === id)?.parentId;
    const origin = parent ? resolve(parent) : { x: 0, y: 0 };
    const abs = { ...box, x: box.x + origin.x, y: box.y + origin.y };
    out.set(id, abs);
    return abs;
  };
  for (const n of graph.nodes) resolve(n.id);
  return out;
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// Regression fixtures for v0's layout bugs: orphan nodes got NaN positions, and
// users with no dependencies broke the ranking.
describe.each([
  ["rides fixture", ridesModel()],
  ["blog example", example("blog")],
  ["mealplanner example", example("mealplanner")],
  ["ridesharing example", example("ridesharing")],
])("layoutGraph: %s", (_name, model) => {
  it("places every node at a finite position, with no sibling overlaps", async () => {
    const graph = buildGraph(model, { expanded: defaultExpanded(model) });
    const boxes = await layoutGraph(graph);
    expect(boxes.size).toBe(graph.nodes.length);
    for (const box of boxes.values()) {
      for (const v of [box.x, box.y, box.width, box.height]) expect(Number.isFinite(v)).toBe(true);
    }
    const abs = absolute(graph, boxes);
    for (const a of graph.nodes) {
      for (const b of graph.nodes) {
        if (a.id >= b.id || a.parentId !== b.parentId) continue;
        expect(overlaps(abs.get(a.id) as Box, abs.get(b.id) as Box), `${a.id} / ${b.id}`).toBe(
          false,
        );
      }
    }
  });
});

describe("layoutGraph: groups", () => {
  it("keeps children inside their group, below its header", async () => {
    const model = ridesModel();
    const graph = buildGraph(model, { expanded: new Set(["platform"]) });
    const boxes = await layoutGraph(graph);
    const group = boxes.get("element:platform") as Box;
    expect(group.width).toBeGreaterThan(NODE_WIDTH);
    for (const id of ["element:platform.api", "element:platform.db", "element:platform.cache"]) {
      const child = boxes.get(id) as Box;
      expect(child.x).toBeGreaterThanOrEqual(0);
      expect(child.y).toBeGreaterThanOrEqual(40);
      expect(child.x + child.width).toBeLessThanOrEqual(group.width);
      expect(child.y + child.height).toBeLessThanOrEqual(group.height);
    }
  });

  it("sizes leaves consistently", async () => {
    const boxes = await layoutGraph(buildGraph(ridesModel(), { expanded: new Set() }));
    expect(boxes.get("element:orphan")).toMatchObject({ width: NODE_WIDTH, height: NODE_HEIGHT });
    expect(boxes.get("actor:lurker")).toMatchObject({ width: NODE_WIDTH, height: NODE_HEIGHT });
  });
});
