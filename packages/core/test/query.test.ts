import { describe, expect, it } from "vitest";
import { getActor, getElement, overview } from "../src/index.js";
import { model, root } from "./helpers.js";

const m = model({
  "archdoc.yaml": root(`
    actors:
      passenger: { kind: person, uses: { app: Books } }
      rides-team: { kind: team, uses: { console: Operates } }
    elements:
      app: { kind: container, uses: { api: Calls } }
      console: { kind: container, uses: { api: Calls } }
      platform:
        kind: system
        owners: [rides-team]
        elements:
          api: { kind: container, code: services/api/**, uses: { db: Writes } }
          db: { kind: datastore }
    journeys:
      book:
        actor: passenger
        goal: Get a ride
        importance: critical
        steps:
          - { from: passenger, to: app }
          - { from: app, to: api }
          - { from: api, to: db }
  `),
});

describe("queries", () => {
  it("has a clean fixture", () => {
    expect(m.diagnostics).toEqual([]);
  });

  it("getElement returns hierarchy, relationships both ways, inherited owners, and journeys", () => {
    const view = getElement(m, "api");
    expect(view?.element.id).toBe("platform.api");
    expect(view?.ancestors.map((e) => e.id)).toEqual(["platform"]);
    expect(view?.uses.map((r) => r.ref)).toEqual(["db"]);
    expect(view?.usedBy.map((r) => r.from.id).sort()).toEqual(["app", "console"]);
    expect(view?.owners).toEqual(["rides-team"]);
    expect(view?.journeys.map((j) => j.id)).toEqual(["book"]);
    expect(view?.element.code).toEqual([{ path: "services/api/**" }]);
  });

  it("getElement includes actors in usedBy and journeys through descendants", () => {
    expect(getElement(m, "app")?.usedBy.map((r) => r.from)).toEqual([
      { type: "actor", id: "passenger" },
    ]);
    expect(getElement(m, "platform")?.journeys.map((j) => j.id)).toEqual(["book"]);
    expect(getElement(m, "nope")).toBeUndefined();
  });

  it("getActor returns what an actor uses, owns, and its journeys", () => {
    expect(getActor(m, "passenger")?.journeys).toMatchObject([
      { role: "actor", journey: { id: "book" } },
    ]);
    const team = getActor(m, "rides-team");
    expect(team?.owns.map((e) => e.id)).toEqual(["platform"]);
    expect(team?.uses.map((r) => r.ref)).toEqual(["console"]);
  });

  it("overview summarizes down to a depth", () => {
    const o = overview(m, 0);
    expect(o.elements.map((e) => e.id)).toEqual(["app", "console", "platform"]);
    expect(o.journeys).toEqual([
      { id: "book", actor: "passenger", goal: "Get a ride", importance: "critical" },
    ]);
    expect(o.counts).toEqual({ actors: 2, elements: 5, relationships: 5, journeys: 1 });
  });
});
