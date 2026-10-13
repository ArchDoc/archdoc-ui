import { readFileSync } from "node:fs";
import { buildModel, type Model } from "@archdoc/core/browser";
import { describe, expect, it } from "vitest";
import { buildGraph, defaultExpanded, type Graph } from "../src/graph/graph.js";
import { groupLandscape } from "../src/graph/groups.js";
import { type Box, layoutGraph, NODE_HEIGHT, NODE_WIDTH, type Point } from "../src/graph/layout.js";
import { landscapeInfo, landscapeModel, ridesModel } from "./fixtures.js";

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
    await expectClean(buildGraph(model, { expanded: defaultExpanded(model) }));
  });
});

// The industry examples, with every datastore opened into its tables.
describe.each(
  ["healthcare", "banking", "ecommerce", "logistics", "insurance", "energy"].map((name) => [
    name,
    example(`industries/${name}`),
  ]),
)("layoutGraph: the %s example", (_name, model) => {
  it("places every node and routes every edge, tables and foreign keys too", async () => {
    const tables = new Set(
      [...model.elements.values()].filter((e) => e.spec.stores).map((e) => e.id),
    );
    const graph = buildGraph(model, { expanded: defaultExpanded(model), tables });
    expect(graph.nodes.some((n) => n.table)).toBe(true);
    expect(graph.edges.some((e) => e.reference)).toBe(true);
    await expectClean(graph);
  });
});

describe.each(["repo", "team", "domain"] as const)("layoutGraph: a landscape by %s", (by) => {
  it("places every node at a finite position, with no sibling overlaps", async () => {
    const model = landscapeModel();
    const grouping = groupLandscape(model, landscapeInfo, by);
    await expectClean(buildGraph(model, { expanded: defaultExpanded(model), grouping }));
  });
});

/** Every node at a finite position, with no overlapping siblings, and every edge routed between their borders. */
async function expectClean(graph: Graph) {
  const { boxes, routes } = await layoutGraph(graph);
  expect(boxes.size).toBe(graph.nodes.length);
  for (const box of boxes.values()) {
    for (const v of [box.x, box.y, box.width, box.height]) expect(Number.isFinite(v)).toBe(true);
  }
  const abs = absolute(graph, boxes);
  for (const a of graph.nodes) {
    for (const b of graph.nodes) {
      if (a.id >= b.id || a.parentId !== b.parentId) continue;
      expect(overlaps(abs.get(a.id) as Box, abs.get(b.id) as Box), `${a.id} / ${b.id}`).toBe(false);
    }
  }
  const ends = new Set<string>();
  for (const e of graph.edges) {
    const route = routes.get(e.id) as Point[];
    expect(route, e.id).toBeDefined();
    const [start, end] = [route[0] as Point, route[route.length - 1] as Point];
    expect(onBorder(start, abs.get(e.source) as Box), `${e.id} starts on ${e.source}`).toBe(true);
    expect(onBorder(end, abs.get(e.target) as Box), `${e.id} ends on ${e.target}`).toBe(true);
    // No two edges leave or enter a box at the same point.
    for (const [node, p] of [
      [e.source, start],
      [e.target, end],
    ] as const) {
      const key = `${node}@${Math.round(p.x)},${Math.round(p.y)}`;
      expect(ends.has(key), `${e.id} shares a point on ${node}`).toBe(false);
      ends.add(key);
    }
  }
}

/** A point on (or within a pixel of) a box's border. */
function onBorder(p: Point, b: Box): boolean {
  const inX = p.x >= b.x - 1 && p.x <= b.x + b.width + 1;
  const inY = p.y >= b.y - 1 && p.y <= b.y + b.height + 1;
  const nearX = Math.abs(p.x - b.x) <= 1 || Math.abs(p.x - b.x - b.width) <= 1;
  const nearY = Math.abs(p.y - b.y) <= 1 || Math.abs(p.y - b.y - b.height) <= 1;
  return (nearX && inY) || (nearY && inX);
}

describe("layoutGraph: groups", () => {
  it("keeps children inside their group, below its header", async () => {
    const model = ridesModel();
    const graph = buildGraph(model, { expanded: new Set(["platform"]) });
    const { boxes } = await layoutGraph(graph);
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
    const { boxes } = await layoutGraph(buildGraph(ridesModel(), { expanded: new Set() }));
    expect(boxes.get("element:orphan")).toMatchObject({ width: NODE_WIDTH, height: NODE_HEIGHT });
    expect(boxes.get("actor:lurker")).toMatchObject({ width: NODE_WIDTH, height: NODE_HEIGHT });
  });
});
