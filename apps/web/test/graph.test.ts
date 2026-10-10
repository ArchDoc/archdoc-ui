import { describe, expect, it } from "vitest";
import { buildGraph, defaultExpanded, journeyEdges, journeyExpansion } from "../src/graph/graph.js";
import { ridesModel } from "./fixtures.js";

const model = ridesModel();
const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

describe("buildGraph", () => {
  it("opens top-level systems by default", () => {
    expect([...defaultExpanded(model)]).toEqual(["platform"]);
  });

  it("hides children of collapsed elements and lifts their relationships", () => {
    const g = buildGraph(model, { expanded: new Set() });
    expect(ids(g.nodes)).toEqual([
      "actor:lurker",
      "actor:ops-team",
      "actor:passenger",
      "element:app",
      "element:console",
      "element:orphan",
      "element:platform",
      "external:payments.charges",
    ]);
    const platform = g.nodes.find((n) => n.id === "element:platform");
    expect(platform).toMatchObject({ isGroup: false, hiddenChildren: 3 });
    // app → api becomes app → platform; api → db disappears inside platform.
    expect(ids(g.edges)).toEqual([
      "actor:ops-team->element:console",
      "actor:passenger->element:app",
      "element:app->element:platform",
      "element:app->external:payments.charges",
      "element:console->element:platform",
    ]);
  });

  it("shows children inside an open group", () => {
    const g = buildGraph(model, { expanded: new Set(["platform"]) });
    expect(g.nodes.find((n) => n.id === "element:platform")).toMatchObject({ isGroup: true });
    expect(g.nodes.find((n) => n.id === "element:platform.api")?.parentId).toBe("element:platform");
    expect(ids(g.edges)).toContain("element:platform.api->element:platform.db");
  });

  it("merges relationships that lift onto the same edge, and tracks planned ones", () => {
    const g = buildGraph(model, { expanded: new Set() });
    const consoleEdge = g.edges.find((e) => e.id === "element:console->element:platform");
    expect(consoleEdge?.planned).toBe(true);
    expect(g.edges.find((e) => e.id === "element:app->element:platform")?.planned).toBe(false);
  });

  it("focus keeps the neighborhood, what an actor owns, and enclosing groups", () => {
    const g = buildGraph(model, { expanded: new Set(["platform"]), focus: "actor:ops-team" });
    expect(ids(g.nodes)).toEqual([
      "actor:ops-team",
      "element:console",
      "element:platform",
      "element:platform.api",
      "element:platform.cache",
      "element:platform.db",
    ]);
  });

  it("focus on an unknown key shows everything", () => {
    const all = buildGraph(model, { expanded: new Set() });
    expect(buildGraph(model, { expanded: new Set(), focus: "element:nope" }).nodes).toHaveLength(
      all.nodes.length,
    );
  });
});

describe("journeys", () => {
  const journey = model.journeys.get("book");
  if (!journey) throw new Error("fixture");

  it("expands what a journey needs", () => {
    expect(journeyExpansion(model, journey)).toEqual(["platform"]);
  });

  it("maps steps onto visible nodes", () => {
    const closed = journeyEdges(model, { expanded: new Set() }, journey);
    expect(closed.map((s) => `${s.step}:${s.source}->${s.target}`)).toEqual([
      "0:actor:passenger->element:app",
      "1:element:app->element:platform",
      "2:element:platform->element:platform",
    ]);
    const open = journeyEdges(model, { expanded: new Set(["platform"]) }, journey);
    expect(open[2]).toMatchObject({
      source: "element:platform.api",
      target: "element:platform.db",
    });
  });
});
