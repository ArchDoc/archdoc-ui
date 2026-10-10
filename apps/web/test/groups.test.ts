import { describe, expect, it } from "vitest";
import { buildGraph, journeyEdges } from "../src/graph/graph.js";
import { boundaryLabel, crossingOf, groupLandscape } from "../src/graph/groups.js";
import { landscapeInfo, landscapeModel } from "./fixtures.js";

const model = landscapeModel();
const parents = (g: ReturnType<typeof buildGraph>) =>
  Object.fromEntries(
    g.nodes.filter((n) => n.kind !== "actor").map((n) => [n.id, n.parentId ?? null]),
  );

describe("landscape grouping", () => {
  it("by repo, keeps the repo systems and moves nothing", () => {
    const grouping = groupLandscape(model, landscapeInfo, "repo");
    expect(grouping.groups.size).toBe(0);
    expect([...grouping.repos.keys()]).toEqual(["payments", "rides"]);
    const g = buildGraph(model, { expanded: new Set(["payments", "rides"]), grouping });
    expect(parents(g)["element:payments.charges"]).toBe("element:payments");
  });

  it("by team, takes the repos apart and boxes their elements by owner", () => {
    const grouping = groupLandscape(model, landscapeInfo, "team");
    expect([...grouping.groups.keys()]).toEqual([
      "group:team:payments-team",
      "group:team:rides-team",
      "group:team:",
    ]);
    const g = buildGraph(model, { expanded: new Set(), grouping });
    expect(parents(g)).toEqual({
      "group:team:payments-team": null,
      "group:team:rides-team": null,
      "group:team:": null,
      "element:payments.charges": "group:team:payments-team",
      "element:payments.ledger": "group:team:payments-team",
      "element:rides.app": "group:team:rides-team",
      "element:rides.api-gateway": "group:team:rides-team",
      "element:rides.scratch": "group:team:",
      "element:status-page": "group:team:",
    });
    // Relationships between repos still connect the boxes inside them.
    expect(g.edges.map((e) => e.id)).toContain(
      "element:rides.api-gateway->element:payments.charges",
    );
    expect(g.nodes.some((n) => n.id === "element:payments")).toBe(false);
  });

  it("by domain, boxes whole repos and single elements", () => {
    const grouping = groupLandscape(model, landscapeInfo, "domain");
    expect([...grouping.groups.values()].map((g) => g.label)).toEqual([
      "Money",
      "riders",
      "Not in a domain",
    ]);
    const g = buildGraph(model, { expanded: new Set(["payments.charges"]), grouping });
    expect(parents(g)).toMatchObject({
      "element:payments.charges": "group:domain:money",
      "element:payments.charges.refunds": "element:payments.charges",
      "element:rides.app": "group:domain:riders",
      "element:rides.scratch": "group:domain:",
    });
  });

  it("finds the steps of a journey that cross from one repo, team, or domain to another", () => {
    const journey = model.journeys.get("request-refund");
    if (!journey) throw new Error("no journey");
    const crossings = (by: "repo" | "team" | "domain") => {
      const grouping = groupLandscape(model, landscapeInfo, by);
      return journey.steps.map((s) => {
        const c = s.from && s.to ? crossingOf(model, grouping, s.from, s.to) : undefined;
        return c && `${boundaryLabel(grouping, c.from)} → ${boundaryLabel(grouping, c.to)}`;
      });
    };
    // The rider comes from the rides repo, so the first step stays inside it.
    expect(crossings("repo")).toEqual([undefined, undefined, "rides → Payments", undefined]);
    expect(crossings("team")).toEqual([
      undefined,
      undefined,
      "rides-team → payments-team",
      undefined,
    ]);
    expect(crossings("domain")).toEqual([undefined, undefined, "riders → Money", undefined]);
  });

  it("lifts journey steps onto the boxes that are drawn", () => {
    const journey = model.journeys.get("request-refund");
    if (!journey) throw new Error("no journey");
    const grouping = groupLandscape(model, landscapeInfo, "team");
    const edges = journeyEdges(model, { expanded: new Set(), grouping }, journey);
    expect(edges[2]).toMatchObject({
      source: "element:rides.api-gateway",
      target: "element:payments.charges",
    });
  });
});
