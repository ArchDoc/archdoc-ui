import { describe, expect, it } from "vitest";
import { diffModels, type MarkedFinding, prReport, REPORT_MARKER } from "../src/index.js";
import { model, root } from "./helpers.js";

const before = model({
  "archdoc.yaml": root(`
    actors:
      rider: { kind: person, uses: { app: Books } }
    elements:
      app: { kind: container, code: apps/mobile/**, owners: [mobile-team], uses: { api: Calls } }
      api: { kind: container, code: services/api/** }
      docs: { kind: container, code: docs/** }
    journeys:
      book:
        actor: rider
        goal: Book a ride
        importance: critical
        steps: [{ from: rider, to: app }, { from: app, to: api }]
      browse:
        actor: rider
        goal: Browse
        steps: [{ from: rider, to: app }]
  `),
});
const after = model({
  "archdoc.yaml": root(`
    actors:
      rider: { kind: person, uses: { app: Books } }
      mobile-team: { kind: team }
    elements:
      app: { kind: container, code: apps/mobile/**, owners: [mobile-team], uses: { api: Calls, cache: { description: Caches trips, provenance: { source: suggested, by: agent:test } } } }
      api: { kind: container, code: services/api/** }
      cache: { kind: datastore, code: services/cache/** }
      docs: { kind: container, code: docs/** }
    journeys:
      book:
        actor: rider
        goal: Book a ride
        importance: critical
        steps: [{ from: rider, to: app }, { from: app, to: api }]
      browse:
        actor: rider
        goal: Browse
        steps: [{ from: rider, to: app }]
  `),
});

const finding = (introduced: boolean, code = "drift/undeclared-dependency"): MarkedFinding => ({
  severity: "error",
  code,
  message: introduced ? "app depends on api.secret" : "old drift",
  evidence: ["apps/mobile/x.ts:3"],
  files: ["apps/mobile/x.ts"],
  introduced,
});

describe("prReport", () => {
  const r = prReport({
    model: after,
    changedFiles: ["apps/mobile/screens/home.tsx", "apps/mobile/x.ts", "README.md"],
    diff: diffModels(before, after),
    findings: [finding(true), finding(false)],
    label: "main...feature",
  });

  it("finds what the change touches from files and the model diff", () => {
    expect(r.touched).toEqual([
      { id: "app", files: 2, owners: ["mobile-team"] },
      { id: "cache", files: 0, owners: [] },
    ]);
    expect(r.owners).toEqual(["mobile-team"]);
  });

  it("ranks affected journeys, critical first, and names actors", () => {
    expect(r.journeys.map((j) => [j.id, j.importance, j.steps])).toEqual([
      ["book", "critical", [1, 2]],
      ["browse", "normal", [1]],
    ]);
    expect(r.actors).toEqual([{ id: "rider", kind: "person" }]);
  });

  it("lists suggested facts for review", () => {
    expect(r.suggested).toEqual(["`app` → `cache`: Caches trips"]);
  });

  it("separates drift the change introduced from drift already there", () => {
    expect(r.introduced).toEqual({ errors: 1, warnings: 0 });
    expect(r.markdown.startsWith(REPORT_MARKER)).toBe(true);
    expect(r.markdown).toContain("This change introduces 1 error and 0 warnings.");
    expect(r.markdown).toContain("app depends on api.secret");
    expect(r.markdown).toMatch(
      /<details><summary>1 finding that were already there<\/summary>[\s\S]*old drift/,
    );
    expect(r.markdown).toContain("| book: Book a ride | **critical** | rider | 1, 2 |");
    expect(r.markdown).toContain("for main...feature");
  });

  it("says so when nothing modeled is touched", () => {
    const quiet = prReport({
      model: after,
      changedFiles: ["README.md"],
      diff: diffModels(after, after),
      findings: [],
    });
    expect(quiet.markdown).toContain("doesn't touch any modeled element");
    expect(quiet.markdown).toContain("No new drift or rule problems.");
  });
});
