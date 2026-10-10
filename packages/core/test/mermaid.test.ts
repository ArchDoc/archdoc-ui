import { describe, expect, it } from "vitest";
import { changeDiagram, diffModels, journeyDiagram } from "../src/index.js";
import { model, root } from "./helpers.js";

const before = model({
  "archdoc.yaml": root(`
    actors:
      rider: { kind: person, uses: { shop.app: Books } }
      clerk: { kind: role, uses: { shop.admin: Manages } }
    elements:
      shop:
        kind: system
        elements:
          app: { kind: container, code: apps/app/**, uses: { api: Calls "the API"; fast } }
          api:
            kind: container
            code: services/api/**
            uses: { legacy: Reads }
            elements:
              routes: { kind: component, code: services/api/routes/** }
          legacy: { kind: container }
          admin: { kind: container }
          db: { kind: datastore }
    journeys:
      book:
        actor: rider
        goal: Book a ride
        importance: critical
        steps:
          - { from: rider, to: shop.app, action: Opens the app }
          - { from: shop.app, to: shop.api, action: "Books <now>; pays # later" }
          - { from: shop.api, to: shop.legacy, action: Checks the old system }
  `),
});
const after = model({
  "archdoc.yaml": root(`
    actors:
      rider: { kind: person, uses: { shop.app: Books } }
    elements:
      shop:
        kind: system
        elements:
          app: { kind: container, code: apps/app/**, uses: { api: Calls "the API"; fast, cache: { description: Caches trips, provenance: { source: suggested, by: agent:test } } } }
          api:
            kind: container
            code: services/api/**
            uses: { db: Writes }
            elements:
              routes: { kind: component, code: services/api/routes/** }
              search: { kind: component }
          cache: { kind: datastore }
          admin: { kind: container }
          db: { kind: datastore }
    journeys:
      book:
        actor: rider
        goal: Book a ride
        importance: critical
        steps:
          - { from: rider, to: shop.app, action: Opens the app }
          - { from: shop.app, to: shop.api, action: "Books <now>; pays # later" }
          - { from: shop.api, to: shop.db, action: Saves the booking }
  `),
});
const diff = diffModels(before, after);

describe("changeDiagram", () => {
  const d = changeDiagram({
    model: after,
    diff,
    touched: new Map([
      ["shop.app", 2],
      ["shop.api.routes", 1],
    ]),
  });

  it("colors boxes by what happened to them, at container level", () => {
    expect(d).toMatch(/^flowchart TB\n/);
    expect(d).toContain('subgraph g0["shop"]');
    expect(d).toMatch(/\["app<br\/><small>container · 2 files<\/small>"\]:::changed/);
    // A part's change shows on its container.
    expect(d).toMatch(/\["api<br\/><small>container · 1 file<\/small>"\]:::changed/);
    expect(d).not.toContain("routes");
    expect(d).not.toContain("search");
    expect(d).toMatch(/\[\("cache<br\/><small>datastore<\/small>"\)\]:::added/);
    expect(d).toMatch(/\["legacy<br\/><small>container<\/small>"\]:::removed/);
    expect(d).toMatch(/\(\["clerk<br\/><small>role<\/small>"\]\):::removed/);
    expect(d).toMatch(/\(\["rider<br\/><small>person<\/small>"\]\):::context/);
    // Neighbors of what changed are context.
    expect(d).toMatch(/\["admin<br\/><small>container<\/small>"\]:::context/);
  });

  it("draws relationships as added, removed, suggested, or context", () => {
    const lines = d?.split("\n") ?? [];
    const arrow = (text: string) => lines.findIndex((l) => l.includes(text));
    expect(lines[arrow('-.->|"suggested: Caches trips"|')]).toBeDefined();
    expect(lines[arrow('==>|"Writes"|')]).toBeDefined();
    expect(lines[arrow('-.->|"Reads"|')]).toBeDefined();
    expect(d).toContain('-->|"Manages"|'.replace("-->", "-.->"));
    // Unchanged relationships are context, without labels.
    const calls = lines.find((l) => /^ {2}n\d+ --> n\d+$/.test(l));
    expect(calls).toBeDefined();
    expect(d).not.toContain("the API");
    // Every arrow has a style, in order.
    const arrows = lines.filter((l) => /^ {2}(n|g)\d+ [-=.]/.test(l)).length;
    expect(lines.filter((l) => l.startsWith("  linkStyle ")).length).toBe(arrows);
    expect(d).toContain("classDef added");
  });

  it("leaves out neighbors once the diagram is full, keeping what changed", () => {
    const small = changeDiagram({ model: after, diff, touched: new Map(), maxBoxes: 1 });
    expect(small).not.toContain("rider");
    expect(small).toContain(":::added");
  });

  it("draws nothing when nothing changed", () => {
    expect(
      changeDiagram({ model: after, diff: diffModels(after, after), touched: new Map() }),
    ).toBe(undefined);
  });
});

describe("journeyDiagram", () => {
  const d =
    journeyDiagram({
      model: after,
      journeyId: "book",
      steps: [1, 2],
      changes: diff.journeys.find((j) => j.id === "book")?.steps,
    }) ?? "";

  it("draws the steps in order, highlighting the affected ones", () => {
    expect(d.split("\n").slice(0, 6)).toEqual([
      "sequenceDiagram",
      "  autonumber",
      "  actor p0 as rider",
      "  participant p1 as app",
      "  participant p2 as api",
      "  participant p3 as db",
    ]);
    expect(d).toContain(
      "  rect rgba(212, 167, 44, 0.18)\n    p0->>p1: Opens the app\n    p1->>p2: Books now, pays later\n  end\n  p2->>p3: 🆕 Saves the booking",
    );
  });

  it("notes removed steps between the participants they had", () => {
    expect(d).toContain("  participant p4 as legacy");
    expect(d).toContain("  Note over p2,p4: Removed step 3: Checks the old system");
  });

  it("wraps long messages and skips unknown journeys", () => {
    const long = model({
      "archdoc.yaml": root(`
        actors: { u: { kind: person, uses: { a: Uses } } }
        elements: { a: { kind: container } }
        journeys:
          j: { actor: u, goal: G, steps: [{ from: u, to: a, action: one two three four five six seven eight nine ten eleven } ] }
        `),
    });
    expect(journeyDiagram({ model: long, journeyId: "j", steps: [] })).toContain(
      "p0->>p1: one two three four five six seven<br/>eight nine ten eleven",
    );
    expect(journeyDiagram({ model: long, journeyId: "nope", steps: [] })).toBeUndefined();
  });
});
